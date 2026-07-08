import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runRules, isDeepRule } from '../src/engine'
import { ALL_RULES } from '../src/rules/index'
import type { StripeAccountSnapshot, Rule, Finding, RuleScope, Severity } from '../src/types'

/** The bundled all-issues golden fixture (suffix == STRIPE_API_VERSION). */
const ALL_ISSUES_FIXTURE = 'test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json'

/** Build a minimal valid snapshot; override per test. */
function makeSnapshot(overrides: Partial<StripeAccountSnapshot> = {}): StripeAccountSnapshot {
  return {
    auditScope: 'base',
    accountMode: 'test',
    livemode: false,
    account: {
      id: 'acct_test',
      defaultAccountTaxIds: [],
      statementDescriptor: null,
      branding: { icon: null, logo: null },
      defaultAccountTaxIdsSet: false,
      chargesEnabled: true,
      requirements: null,
    },
    webhookEndpoints: [],
    prices: [],
    portalConfigurations: [],
    taxSettings: { status: 'active', defaultTaxBehavior: null },
    subscriptionSummary: null,
    meters: null,
    thinEventDestinations: null,
    radarSettings: null,
    coupons: null,
    scopeProbe: [],
    truncated: [],
    ...overrides,
  }
}

/** Build a rule with sensible defaults; override per test. */
function makeRule(overrides: Partial<Rule> = {}): Rule {
  return {
    id: 'TEST_RULE',
    name: 'Test rule',
    severity: 'medium',
    category: 'configuration',
    requires: ['account'],
    check: () => [],
    ...overrides,
  }
}

function makeFinding(over: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'TEST_RULE',
    severity: 'high',
    category: 'billing',
    title: 'A finding',
    affectedResourceId: 'res_1',
    affectedResourceType: 'price',
    description: 'desc',
    remediation: 'fix it',
    docsUrl: 'https://example.test/docs',
    ...over,
  }
}

describe('runRules', () => {
  it('returns the breaking {findings, skipped} shape, not a bare array', () => {
    const result = runRules(makeSnapshot(), [])
    expect(Array.isArray(result)).toBe(false)
    expect(result).toEqual({ findings: [], skipped: [] })
  })

  it('aggregates findings from passing base rules', () => {
    const f = makeFinding()
    const rule = makeRule({ check: () => [f] })
    const { findings, skipped } = runRules(makeSnapshot(), [rule])
    expect(findings).toEqual([f])
    expect(skipped).toEqual([])
  })

  it('contains a thrown rule as an info finding and keeps running', () => {
    const boom = makeRule({ id: 'BOOM', name: 'Exploding rule', check: () => { throw new Error('kaboom') } })
    const ok = makeRule({ id: 'OK', check: () => [makeFinding({ ruleId: 'OK' })] })
    const { findings, skipped } = runRules(makeSnapshot(), [boom, ok])

    const info = findings.find((x) => x.ruleId === 'BOOM')
    expect(info).toBeDefined()
    expect(info?.severity).toBe('info')
    expect(info?.description).toContain('kaboom')
    // the run continued — the second rule still produced its finding
    expect(findings.some((x) => x.ruleId === 'OK')).toBe(true)
    expect(skipped).toEqual([])
  })

  it('rejects a malformed plugin finding (spread of null) with a plain-language info finding', () => {
    // A plugin returning {...null} produces {} — before the shape chokepoint this
    // reached scoreFindings as a {ruleId}-only object (NaN score, reporter TypeError).
    const malformed = makeRule({
      id: 'demo/BROKEN',
      name: 'Broken plugin rule',
      check: () => [{ ...(null as unknown as Finding) }],
    })
    const ok = makeRule({ id: 'OK', check: () => [makeFinding({ ruleId: 'OK' })] })
    const { findings, skipped } = runRules(makeSnapshot(), [malformed, ok])

    const guard = findings.find((x) => x.ruleId === 'demo/BROKEN')
    expect(guard).toBeDefined()
    expect(guard?.severity).toBe('info')
    expect(guard?.title).toContain('malformed finding')
    expect(guard?.title).toContain('Broken plugin rule')
    expect(guard?.description).toMatch(/Finding contract/)
    expect(guard?.description).not.toMatch(/\bat .*:\d+:\d+/) // plain language, no stack
    // the malformed object itself never surfaces, and the run continued
    expect(findings.every((x) => typeof x.severity === 'string')).toBe(true)
    expect(findings.some((x) => x.ruleId === 'OK')).toBe(true)
    expect(skipped).toEqual([])
  })

  it('rejects a finding with an out-of-vocabulary severity, naming the field', () => {
    const bad = makeRule({
      id: 'demo/BAD_SEV',
      name: 'Bad severity rule',
      check: () => [makeFinding({ severity: 'catastrophic' as Severity })],
    })
    const { findings } = runRules(makeSnapshot(), [bad])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('info')
    expect(findings[0]?.description).toContain('severity')
  })

  it('a valid finding still passes the chokepoint untouched (severity/fields preserved)', () => {
    const f = makeFinding({ severity: 'critical', estimatedImpact: '~$100/mo at risk' })
    const rule = makeRule({ id: 'VALID', check: () => [f] })
    const { findings } = runRules(makeSnapshot(), [rule])
    expect(findings).toEqual([{ ...f, ruleId: 'VALID' }])
  })

  it('skips a deep rule against a base snapshot (requires-deep), emits no finding', () => {
    const deep = makeRule({
      id: 'DEEP',
      requires: ['subscriptions'] as RuleScope[],
      check: () => [makeFinding({ ruleId: 'DEEP' })],
    })
    const { findings, skipped } = runRules(makeSnapshot({ auditScope: 'base' }), [deep])
    expect(findings).toEqual([])
    expect(skipped).toEqual([{ ruleId: 'DEEP', reason: 'requires-deep' }])
  })

  it('skips a deep rule when its scope was not granted (deep-scope-not-granted)', () => {
    const deep = makeRule({ id: 'DEEP', requires: ['radar'] as RuleScope[], check: () => [makeFinding()] })
    const snapshot = makeSnapshot({
      auditScope: 'deep',
      scopeProbe: [{ scope: 'radar', granted: false }],
    })
    const { findings, skipped } = runRules(snapshot, [deep])
    expect(findings).toEqual([])
    expect(skipped).toEqual([{ ruleId: 'DEEP', reason: 'deep-scope-not-granted' }])
  })

  it('runs a deep rule when in deep mode with the scope granted', () => {
    const f = makeFinding({ ruleId: 'DEEP' })
    const deep = makeRule({ id: 'DEEP', requires: ['meters'] as RuleScope[], check: () => [f] })
    const snapshot = makeSnapshot({
      auditScope: 'deep',
      scopeProbe: [{ scope: 'meters', granted: true }],
    })
    const { findings, skipped } = runRules(snapshot, [deep])
    expect(findings).toEqual([f])
    expect(skipped).toEqual([])
  })

  it('applies severity and category include-filters', () => {
    const high = makeRule({ id: 'HIGH', severity: 'high', category: 'billing', check: () => [makeFinding({ ruleId: 'HIGH' })] })
    const low = makeRule({ id: 'LOW', severity: 'low', category: 'pricing', check: () => [makeFinding({ ruleId: 'LOW' })] })

    const bySeverity = runRules(makeSnapshot(), [high, low], { severity: ['high'] })
    expect(bySeverity.findings.map((x) => x.ruleId)).toEqual(['HIGH'])

    const byCategory = runRules(makeSnapshot(), [high, low], { category: ['pricing'] })
    expect(byCategory.findings.map((x) => x.ruleId)).toEqual(['LOW'])
  })
})

describe('isDeepRule', () => {
  it('is true iff a required region is one of the deep-5', () => {
    expect(isDeepRule({ requires: ['account', 'prices'] } as Rule)).toBe(false)
    expect(isDeepRule({ requires: ['account', 'subscriptions'] } as Rule)).toBe(true)
    expect(isDeepRule({ requires: ['event_destinations'] } as Rule)).toBe(true)
    expect(isDeepRule({ requires: ['coupons'] } as Rule)).toBe(true)
  })
})

describe('engine over the all-issues golden fixture — all severity bands', () => {
  const ALL_BANDS: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

  // The it-name spells the bands in order ("critical, high, medium, low, info") so a
  // verbose run (vitest --reporter=verbose) can confirm coverage from the test name.
  it('fires at least one finding in every severity band (critical, high, medium, low, info)', () => {
    const snap = JSON.parse(readFileSync(ALL_ISSUES_FIXTURE, 'utf8')) as StripeAccountSnapshot
    const present = new Set(runRules(snap, ALL_RULES).findings.map((f) => f.severity))
    const missing = ALL_BANDS.filter((b) => !present.has(b))
    expect(missing).toEqual([])
  })

  it('draws only from the re-grounded base catalog (every fired rule is a known ALL_RULES id)', () => {
    const snap = JSON.parse(readFileSync(ALL_ISSUES_FIXTURE, 'utf8')) as StripeAccountSnapshot
    const known = new Set(ALL_RULES.map((r) => r.id))
    const fired = runRules(snap, ALL_RULES).findings
    expect(fired.length).toBeGreaterThan(0)
    for (const f of fired) expect(known.has(f.ruleId)).toBe(true)
  })
})
