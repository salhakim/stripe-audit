import { describe, it, expect } from 'vitest'
import { isDeepRule } from '../../src/engine'
import type { ScopeGrant, StripeAccountSnapshot } from '../../src/types'
import {
  securityRules,
  TEST_KEY_DETECTED_LIVE,
  LIVE_KEY_DETECTED_TEST,
  RESTRICTED_KEY_PERMISSION_PROBE,
  ACCOUNT_CHARGES_DISABLED,
  ACCOUNT_REQUIREMENTS_DUE,
} from '../../src/rules/security'

type AccountOver = Partial<StripeAccountSnapshot['account']>

function makeSnapshot(
  over: Partial<StripeAccountSnapshot> = {},
  accountOver: AccountOver = {},
): StripeAccountSnapshot {
  return {
    auditScope: 'base',
    accountMode: 'test',
    livemode: false,
    account: {
      id: 'acct_1',
      defaultAccountTaxIds: [],
      statementDescriptor: 'ACME',
      branding: { icon: 'ic', logo: 'lg' },
      defaultAccountTaxIdsSet: true,
      chargesEnabled: true,
      requirements: null,
      ...accountOver,
    },
    webhookEndpoints: [],
    prices: [],
    portalConfigurations: [],
    taxSettings: { status: 'active', defaultTaxBehavior: 'exclusive' },
    subscriptionSummary: null,
    meters: null,
    thinEventDestinations: null,
    radarSettings: null,
    coupons: null,
    scopeProbe: [],
    truncated: [],
    ...over,
  }
}

describe('securityRules — requires contract', () => {
  it("every rule declares requires: ['account'] (a base region)", () => {
    expect(securityRules).toHaveLength(5)
    for (const rule of securityRules) {
      expect(rule.requires).toEqual(['account'])
      expect(isDeepRule(rule)).toBe(false)
    }
  })
})

describe('TEST_KEY_DETECTED_LIVE / LIVE_KEY_DETECTED_TEST (prefix vs livemode)', () => {
  it('TEST_KEY_DETECTED_LIVE fires on a test prefix + livemode true', () => {
    const findings = TEST_KEY_DETECTED_LIVE.check(makeSnapshot({ accountMode: 'test', livemode: true }))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('critical')
  })
  it('LIVE_KEY_DETECTED_TEST fires on a live prefix + livemode false', () => {
    const findings = LIVE_KEY_DETECTED_TEST.check(makeSnapshot({ accountMode: 'live', livemode: false }))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
  })
  it('neither fires when prefix and livemode agree', () => {
    expect(TEST_KEY_DETECTED_LIVE.check(makeSnapshot({ accountMode: 'test', livemode: false }))).toEqual([])
    expect(LIVE_KEY_DETECTED_TEST.check(makeSnapshot({ accountMode: 'live', livemode: true }))).toEqual([])
  })
})

describe('RESTRICTED_KEY_PERMISSION_PROBE', () => {
  it('emits an info finding enumerating exactly the not-granted scopes', () => {
    const scopeProbe: ScopeGrant[] = [
      { scope: 'account', granted: true },
      { scope: 'tax', granted: false },
      { scope: 'prices', granted: false },
    ]
    const findings = RESTRICTED_KEY_PERMISSION_PROBE.check(makeSnapshot({ scopeProbe }))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('info')
    expect(findings[0].description).toContain('tax')
    expect(findings[0].description).toContain('prices')
  })
  it('returns [] when all scopes are granted, or when scopeProbe is empty', () => {
    expect(
      RESTRICTED_KEY_PERMISSION_PROBE.check(makeSnapshot({ scopeProbe: [{ scope: 'account', granted: true }] })),
    ).toEqual([])
    expect(RESTRICTED_KEY_PERMISSION_PROBE.check(makeSnapshot({ scopeProbe: [] }))).toEqual([])
  })
})

describe('ACCOUNT_CHARGES_DISABLED', () => {
  it('fires when the account cannot create charges', () => {
    const findings = ACCOUNT_CHARGES_DISABLED.check(makeSnapshot({}, { chargesEnabled: false }))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
    expect(findings[0].estimatedImpact).toBeTruthy()
  })
  it('returns [] when charges are enabled', () => {
    expect(ACCOUNT_CHARGES_DISABLED.check(makeSnapshot({}, { chargesEnabled: true }))).toEqual([])
  })
})

describe('ACCOUNT_REQUIREMENTS_DUE', () => {
  it('fires when currentlyDue is non-empty', () => {
    const snap = makeSnapshot({}, { requirements: { currentlyDue: ['business_profile.url'], disabledReason: null } })
    expect(ACCOUNT_REQUIREMENTS_DUE.check(snap)).toHaveLength(1)
  })
  it('fires when a disabled reason is set', () => {
    const snap = makeSnapshot({}, { requirements: { currentlyDue: [], disabledReason: 'requirements.past_due' } })
    expect(ACCOUNT_REQUIREMENTS_DUE.check(snap)).toHaveLength(1)
  })
  it('returns [] when requirements is null or empty', () => {
    expect(ACCOUNT_REQUIREMENTS_DUE.check(makeSnapshot({}, { requirements: null }))).toEqual([])
    expect(
      ACCOUNT_REQUIREMENTS_DUE.check(makeSnapshot({}, { requirements: { currentlyDue: [], disabledReason: null } })),
    ).toEqual([])
  })
})

describe('security findings — no key leakage (S1)', () => {
  it('no finding embeds an API key prefix', () => {
    const snap = makeSnapshot(
      { accountMode: 'test', livemode: true, scopeProbe: [{ scope: 'tax', granted: false }] },
      { chargesEnabled: false, requirements: { currentlyDue: ['x'], disabledReason: 'y' } },
    )
    const findings = securityRules.flatMap((r) => r.check(snap))
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      const blob = `${f.title} ${f.description} ${f.remediation}`
      expect(/\b[rs]k_(test|live)_/.test(blob)).toBe(false)
      expect(f.category).toBe('security')
      expect(f.docsUrl).toMatch(/^https:\/\//)
      expect(f.ruleId).toBeTruthy()
      expect(f.title).toBeTruthy()
      expect(f.description).toBeTruthy()
      expect(f.remediation).toBeTruthy()
    }
  })
})
