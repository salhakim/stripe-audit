import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runRules } from '../../src/engine'
import { ALL_RULES } from '../../src/rules/index'
import { buildAuditResult, renderJson, renderReport } from '../../src/report'
import type { BuildAuditResultOptions } from '../../src/report'
import type { Finding, StripeAccountSnapshot } from '../../src/types'

const FIXTURE = 'test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json'
const loadSnap = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as StripeAccountSnapshot

/** Build a demo AuditResult with a fixed auditDate for stable assertions. */
function demoResult(opts: Partial<BuildAuditResultOptions> = {}) {
  const snap = loadSnap()
  const run = runRules(snap, ALL_RULES)
  return buildAuditResult(snap, run, {
    rulesTotal: ALL_RULES.length,
    auditDate: '2026-06-24T00:00:00.000Z',
    ...opts,
  })
}

const SUMMARY_KEYS = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
  'total',
  'rulesRun',
  'rulesPassed',
  'score',
  'grade',
  'suppressed',
] as const

describe('renderJson — canonical machine shape', () => {
  it('emits parseable JSON with the documented top-level keys', () => {
    const parsed = JSON.parse(renderJson(demoResult()))
    expect(parsed).toMatchObject({
      version: expect.any(String),
      stripeApiVersion: '2026-06-24.dahlia',
      accountMode: expect.stringMatching(/^(test|live)$/),
      auditDate: expect.any(String),
    })
    expect(parsed.summary).toBeDefined()
    expect(Array.isArray(parsed.findings)).toBe(true)
    expect(Array.isArray(parsed.skipped)).toBe(true)
  })

  it('summary carries every tally + score key; suppressed is a non-negative int; total reconciles', () => {
    const { summary } = demoResult()
    for (const key of SUMMARY_KEYS) expect(summary).toHaveProperty(key)
    expect(Number.isInteger(summary.suppressed)).toBe(true)
    expect(summary.suppressed).toBe(0)
    expect(summary.total).toBe(
      summary.critical + summary.high + summary.medium + summary.low + summary.info,
    )
    // rulesRun = catalog − skipped (deep rules skip on this base fixture);
    // rulesPassed never exceeds rulesRun.
    const { skipped } = demoResult()
    expect(skipped.length).toBeGreaterThan(0)
    expect(summary.rulesRun).toBe(ALL_RULES.length - skipped.length)
    expect(summary.rulesPassed).toBeLessThanOrEqual(summary.rulesRun)
  })

  it('findings are active and schema-complete (remediation + https docsUrl)', () => {
    const result = demoResult()
    expect(result.findings.length).toBeGreaterThan(0)
    for (const finding of result.findings) {
      expect(finding.remediation).toBeTruthy()
      expect(finding.docsUrl).toMatch(/^https:\/\//)
    }
  })

  it('skipped[] is structurally present (empty in v0.1.0 base mode — zero deep rules)', () => {
    const result = demoResult()
    expect(Array.isArray(result.skipped)).toBe(true)
    for (const entry of result.skipped) {
      expect(entry).toHaveProperty('ruleId')
      expect(entry).toHaveProperty('reason')
    }
  })

  it('carries truncated[] (the PARTIAL-audit signal): empty by default, round-trips a capped region', () => {
    const result = demoResult()
    expect(Array.isArray(result.truncated)).toBe(true)
    expect(result.truncated).toEqual([])
    const snap = loadSnap()
    snap.truncated = ['prices']
    const run = runRules(snap, ALL_RULES)
    const capped = JSON.parse(
      renderJson(buildAuditResult(snap, run, { rulesTotal: ALL_RULES.length, auditDate: '2026-06-24T00:00:00.000Z' })),
    )
    expect(capped.truncated).toEqual(['prices'])
  })

  it('omits the baseline block when none supplied; includes it verbatim when supplied', () => {
    expect(demoResult()).not.toHaveProperty('baseline')
    const baseline = {
      newFindings: [{ ruleId: 'X' } as Finding],
      resolvedFindings: [] as string[],
      scoreDelta: -5,
      regression: true,
    }
    expect(demoResult({ baseline }).baseline).toEqual(baseline)
  })

  it('omits the filter key on an unfiltered run; carries it verbatim when filtered', () => {
    expect(demoResult()).not.toHaveProperty('filter')
    const filtered = JSON.parse(renderJson(demoResult({ filter: { severity: ['low'] } })))
    expect(filtered.filter).toEqual({ severity: ['low'] })
    const both = JSON.parse(
      renderJson(demoResult({ filter: { severity: ['low'], category: ['billing'] } })),
    )
    expect(both.filter).toEqual({ severity: ['low'], category: ['billing'] })
  })

  it('renders no Stripe key substring', () => {
    expect(renderJson(demoResult())).not.toMatch(/sk_(live|test)_|rk_(live|test)_/)
  })

  it('renderReport routes the json format to renderJson', () => {
    const result = demoResult()
    expect(renderReport(result, 'json')).toBe(renderJson(result))
  })
})

describe('buildAuditResult — suppressed-but-firing rule is neither passed nor active', () => {
  const AUDIT_DATE = '2026-06-24T00:00:00.000Z'

  /** Result with every finding of `ruleIds` moved to the suppressed seam (full suppression). */
  function withSuppressed(ruleIds: string[], keepOne = false) {
    const snap = loadSnap()
    const run = runRules(snap, ALL_RULES)
    const match = run.findings.filter((f) => ruleIds.includes(f.ruleId))
    const suppressed = keepOne ? match.slice(1) : match
    const active = run.findings.filter((f) => !suppressed.includes(f))
    const result = buildAuditResult(
      snap,
      { findings: active, skipped: run.skipped },
      { rulesTotal: ALL_RULES.length, auditDate: AUDIT_DATE, suppressed },
    )
    return { result, suppressed, full: demoResult() }
  }

  it('fully suppressing WEBHOOK_SELECT_ALL (a firing critical) does NOT bump rulesPassed', () => {
    const { result, suppressed, full } = withSuppressed(['WEBHOOK_SELECT_ALL'])
    expect(suppressed.length).toBeGreaterThan(0) // the rule genuinely fired
    expect(result.summary.rulesPassed).toBe(full.summary.rulesPassed) // stable — NOT passed
    expect(result.summary.suppressed).toBe(suppressed.length) // surfaced ONLY here
    expect(result.summary.total).toBe(full.summary.total - suppressed.length) // not active
    expect(result.findings.some((f) => f.ruleId === 'WEBHOOK_SELECT_ALL')).toBe(false)
  })

  it('a partially-suppressed rule is unaffected (still fired via its active findings)', () => {
    // DEFAULT_PRICE_MISSING_OR_INACTIVE fires twice on the demo fixture; suppress one.
    const { result, suppressed, full } = withSuppressed(['DEFAULT_PRICE_MISSING_OR_INACTIVE'], true)
    expect(suppressed).toHaveLength(1)
    expect(result.findings.some((f) => f.ruleId === 'DEFAULT_PRICE_MISSING_OR_INACTIVE')).toBe(true)
    expect(result.summary.rulesPassed).toBe(full.summary.rulesPassed)
  })

  it('suppressing findings of SEVERAL rules keeps rulesPassed stable (scoring.md invariant)', () => {
    const { result, full } = withSuppressed(['WEBHOOK_SELECT_ALL', 'PRICE_ZERO_AMOUNT'])
    expect(result.summary.rulesPassed).toBe(full.summary.rulesPassed)
    // rulesRun is skip-derived and untouched by suppression.
    expect(result.summary.rulesRun).toBe(full.summary.rulesRun)
  })
})
