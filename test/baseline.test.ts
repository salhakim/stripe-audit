import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { fingerprintFinding, writeBaseline, compareBaseline, sameFilterScope } from '../src/baseline'
import { baselineSchema } from '../src/baseline-schema'
import type { Finding } from '../src/types'
import type { AuditResult } from '../src/report/result'

/** A minimal Finding factory — only the fields the fingerprint + score read matter. */
function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'WEBHOOK_INSECURE_URL',
    severity: 'high',
    category: 'webhooks',
    title: 'Insecure webhook URL',
    affectedResourceId: 'we_123',
    affectedResourceType: 'webhook_endpoint',
    description: 'desc',
    remediation: 'fix',
    docsUrl: 'https://stripe.com/docs',
    ...overrides,
  }
}

/** A minimal AuditResult carrying only what writeBaseline reads (api version, score/grade, findings). */
function auditResult(findings: Finding[], score = 90, grade: AuditResult['summary']['grade'] = 'A'): AuditResult {
  return {
    version: '0.1.0',
    stripeApiVersion: '2026-06-24.dahlia',
    accountMode: 'test',
    auditDate: '2026-07-01T00:00:00.000Z',
    summary: {
      critical: 0,
      high: findings.filter((f) => f.severity === 'high').length,
      medium: 0,
      low: 0,
      info: 0,
      total: findings.length,
      rulesRun: 10,
      rulesPassed: 9,
      score,
      grade,
      suppressed: 0,
    },
    findings,
    skipped: [],
    truncated: [],
  }
}

describe('fingerprintFinding — stability', () => {
  it('is a hex sha256 (64 hex chars) and stable run-to-run for the same finding', () => {
    const f = finding()
    const a = fingerprintFinding(f)
    const b = fingerprintFinding({ ...f })
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(a).toBe(b)
  })

  it('reads only ruleId + resource fields — cosmetic changes do not move the fingerprint', () => {
    const base = fingerprintFinding(finding())
    const reworded = fingerprintFinding(
      finding({ severity: 'critical', title: 'Reworded', description: 'other', estimatedImpact: '~$9/mo' }),
    )
    expect(reworded).toBe(base)
  })

  it('distinguishes different rules on the same resource', () => {
    const a = fingerprintFinding(finding({ ruleId: 'RULE_A' }))
    const b = fingerprintFinding(finding({ ruleId: 'RULE_B' }))
    expect(a).not.toBe(b)
  })

  it('distinguishes different resources under the same rule', () => {
    const a = fingerprintFinding(finding({ affectedResourceId: 'we_1' }))
    const b = fingerprintFinding(finding({ affectedResourceId: 'we_2' }))
    expect(a).not.toBe(b)
  })
})

describe('fingerprintFinding — pinned compatibility vectors', () => {
  // These digests are the PUBLIC COMPATIBILITY CONTRACT: user-owned baseline files
  // store them verbatim, so any change to the hash algorithm, field set, null
  // sentinel, or FIELD_SEP invalidates every adopter's baseline. Captured from the
  // shipped implementation. If this test fails, you have
  // broken baseline compatibility — that needs a migration story, not a re-pin.
  it('matches the pinned vector for a resource-scoped finding', () => {
    const f = finding({
      ruleId: 'WEBHOOK_MISSING',
      affectedResourceType: 'webhook_endpoint',
      affectedResourceId: 'we_123',
    })
    expect(fingerprintFinding(f)).toBe('ff09daa6536d30ff23e2387086e3d3c5570ec245f5e27b56aaadfbf73b90b5d0')
  })

  it('matches the pinned vector for an account-level finding (null resource id)', () => {
    const f = finding({
      ruleId: 'ACCOUNT_LEVEL_RULE',
      affectedResourceType: 'account',
      affectedResourceId: null,
    })
    expect(fingerprintFinding(f)).toBe('2c454e904158a4c5e86be09446dc098c49d431291e1e40f66d04e63e6f901186')
  })
})

describe('fingerprintFinding — null resource normalisation', () => {
  it('is stable for an account-level finding (null resource fields)', () => {
    const acct = finding({ affectedResourceId: null, affectedResourceType: 'account' })
    expect(fingerprintFinding(acct)).toBe(fingerprintFinding({ ...acct }))
  })

  it('two account-level findings of different rules never collide', () => {
    const a = finding({ ruleId: 'A', affectedResourceId: null, affectedResourceType: 'account' })
    const b = finding({ ruleId: 'B', affectedResourceId: null, affectedResourceType: 'account' })
    expect(fingerprintFinding(a)).not.toBe(fingerprintFinding(b))
  })
})

describe('writeBaseline — shape + schema', () => {
  it('carries apiVersion/createdAt/score/grade/fingerprints and parses clean through the schema', () => {
    const result = auditResult([finding()], 90, 'A')
    const baseline = writeBaseline(result, '2026-07-01T00:00:00.000Z')
    expect(baseline).toEqual({
      apiVersion: '2026-06-24.dahlia',
      createdAt: '2026-07-01T00:00:00.000Z',
      score: 90,
      grade: 'A',
      fingerprints: [fingerprintFinding(finding())],
    })
    expect(() => baselineSchema.parse(baseline)).not.toThrow()
  })

  it('honours the createdAt override (E1) and defaults to an ISO now when omitted', () => {
    const result = auditResult([])
    expect(writeBaseline(result, '2020-01-01T00:00:00.000Z').createdAt).toBe('2020-01-01T00:00:00.000Z')
    expect(writeBaseline(result).createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('sorts fingerprints for a deterministic, diff-friendly baseline file', () => {
    const result = auditResult([
      finding({ affectedResourceId: 'we_9' }),
      finding({ affectedResourceId: 'we_1' }),
      finding({ affectedResourceId: 'we_5' }),
    ])
    const { fingerprints } = writeBaseline(result)
    expect(fingerprints).toEqual([...fingerprints].sort())
  })

  it('builds fingerprints from the ACTIVE findings on the result', () => {
    const result = auditResult([finding({ affectedResourceId: 'we_1' }), finding({ affectedResourceId: 'we_2' })])
    expect(writeBaseline(result).fingerprints).toHaveLength(2)
  })
})

describe('compareBaseline — new / resolved diff', () => {
  it('flags a new finding as a regression and lists a resolved fingerprint', () => {
    const base = writeBaseline(auditResult([finding({ affectedResourceId: 'we_old' })]), '2026-07-01T00:00:00.000Z')
    const active = [finding({ affectedResourceId: 'we_new' })]
    const cmp = compareBaseline(active, base)

    expect(cmp.regression).toBe(true)
    expect(cmp.newFindings.map((f) => f.affectedResourceId)).toEqual(['we_new'])
    expect(cmp.resolvedFindings).toEqual([fingerprintFinding(finding({ affectedResourceId: 'we_old' }))])
  })

  it('an identical run is not a regression and has no new/resolved entries', () => {
    const result = auditResult([finding()])
    const base = writeBaseline(result, '2026-07-01T00:00:00.000Z')
    const cmp = compareBaseline(result.findings, base)

    expect(cmp.regression).toBe(false)
    expect(cmp.newFindings).toEqual([])
    expect(cmp.resolvedFindings).toEqual([])
    expect(cmp.scoreDelta).toBe(0)
  })

  it('a fixed run (baseline finding now gone) is not a regression and reports it resolved', () => {
    const base = writeBaseline(auditResult([finding()], 90, 'A'), '2026-07-01T00:00:00.000Z')
    const cmp = compareBaseline([], base)

    expect(cmp.regression).toBe(false)
    expect(cmp.newFindings).toEqual([])
    expect(cmp.resolvedFindings).toEqual([fingerprintFinding(finding())])
  })
})

describe('compareBaseline — coverage-gate (strictly additive) semantics', () => {
  it('a score drop with NO new finding is NOT a regression', () => {
    // Baseline captured at score 90; the current run scores lower but introduces
    // no new fingerprint (same single finding). scoreDelta is negative, regression false.
    const shared = finding()
    const base: ReturnType<typeof writeBaseline> = {
      ...writeBaseline(auditResult([shared], 90, 'A'), '2026-07-01T00:00:00.000Z'),
      score: 95, // baseline was healthier than the current run
    }
    const cmp = compareBaseline([shared], base)
    expect(cmp.scoreDelta).toBeLessThan(0)
    expect(cmp.regression).toBe(false)
  })

  it('resolvedFindings are returned sorted (E3)', () => {
    const base = writeBaseline(
      auditResult([
        finding({ affectedResourceId: 'we_z' }),
        finding({ affectedResourceId: 'we_a' }),
        finding({ affectedResourceId: 'we_m' }),
      ]),
      '2026-07-01T00:00:00.000Z',
    )
    const cmp = compareBaseline([], base)
    expect(cmp.resolvedFindings).toEqual([...cmp.resolvedFindings].sort())
    expect(cmp.resolvedFindings).toHaveLength(3)
  })
})

describe('writeBaseline + sameFilterScope — filter-scope provenance', () => {
  it('records the capture scope when the result is filtered; key ABSENT unfiltered', () => {
    const unfiltered = writeBaseline(auditResult([finding()]), '2026-07-01T00:00:00.000Z')
    expect(unfiltered).not.toHaveProperty('filter')
    const filtered = writeBaseline(
      { ...auditResult([finding()]), filter: { severity: ['low'] } },
      '2026-07-01T00:00:00.000Z',
    )
    expect(filtered.filter).toEqual({ severity: ['low'] })
    expect(() => baselineSchema.parse(filtered)).not.toThrow()
  })

  it('absent ≡ absent; absent vs any list mismatches (two-sided)', () => {
    expect(sameFilterScope(undefined, undefined)).toBe(true)
    expect(sameFilterScope({ severity: ['low'] }, undefined)).toBe(false)
    expect(sameFilterScope(undefined, { category: ['billing'] })).toBe(false)
  })

  it('equality is order- and duplicate-insensitive per axis; both axes must match', () => {
    expect(sameFilterScope({ severity: ['low', 'high'] }, { severity: ['high', 'low', 'high'] })).toBe(true)
    expect(sameFilterScope({ severity: ['low'] }, { severity: ['high'] })).toBe(false)
    expect(sameFilterScope({ severity: ['low'], category: ['billing'] }, { severity: ['low'] })).toBe(false)
  })

  it('an EMPTY list is a distinct scope, not unfiltered (guards the issue-#9 empty-filter path)', () => {
    expect(sameFilterScope({ severity: [] }, undefined)).toBe(false)
    expect(sameFilterScope(undefined, { severity: [] })).toBe(false)
    expect(sameFilterScope({ severity: [] }, { severity: [] })).toBe(true)
  })
})

describe('baselineSchema — rejects malformed input with a ZodError', () => {
  it('throws ZodError when a required field is the wrong type', () => {
    const bad = { apiVersion: 1, createdAt: '2026-07-01', score: 'x', grade: 'Z', fingerprints: 'nope' }
    expect(() => baselineSchema.parse(bad)).toThrow(ZodError)
  })

  it('throws ZodError on an old-shape baseline missing fingerprints', () => {
    const oldShape = { apiVersion: '2026-06-24.dahlia', createdAt: '2026-07-01', score: 90, grade: 'A' }
    expect(() => baselineSchema.parse(oldShape)).toThrow(ZodError)
  })

  it('parses a legacy baseline (no filter field) and a filtered one; rejects unknown tokens', () => {
    const legacyShape = { apiVersion: '2026-06-24.dahlia', createdAt: '2026-07-01', score: 90, grade: 'A', fingerprints: [] }
    expect(() => baselineSchema.parse(legacyShape)).not.toThrow()
    expect(() => baselineSchema.parse({ ...legacyShape, filter: { severity: ['low'], category: ['billing'] } })).not.toThrow()
    expect(() => baselineSchema.parse({ ...legacyShape, filter: { severity: ['spicy'] } })).toThrow(ZodError)
  })
})
