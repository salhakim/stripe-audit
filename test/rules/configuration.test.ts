import { describe, it, expect } from 'vitest'
import { isDeepRule } from '../../src/engine'
import type {
  RuleScope,
  SnapshotAccount,
  SnapshotWebhookEndpoint,
  StripeAccountSnapshot,
} from '../../src/types'
import {
  configurationRules,
  TAX_NOT_ENABLED,
  DEFAULT_TAX_BEHAVIOR_UNSET,
  TAX_SETTINGS_PENDING,
  UNBRANDED_RECEIPTS,
  DEFAULT_ACCOUNT_TAX_IDS_MISSING,
  STATEMENT_DESCRIPTOR_MISSING,
  EVENT_DESTINATIONS_NOT_AUDITED,
} from '../../src/rules/configuration'

const BASE_REGIONS = new Set<RuleScope>([
  'account',
  'webhook_endpoints',
  'products',
  'prices',
  'billing_portal',
  'tax',
])

/** A fully-configured account (no config rule fires); override to trigger one. */
function acct(over: Partial<SnapshotAccount> = {}): SnapshotAccount {
  return {
    id: 'acct_1',
    defaultAccountTaxIds: ['txi_1'],
    statementDescriptor: 'ACME',
    branding: { icon: 'file_icon', logo: 'file_logo' },
    defaultAccountTaxIdsSet: true,
    chargesEnabled: true,
    requirements: null,
    ...over,
  }
}

function endpoint(): SnapshotWebhookEndpoint {
  return {
    id: 'we_1',
    url: 'https://example.com/hook',
    status: 'enabled',
    enabledEvents: ['*'],
    apiVersion: null,
    description: null,
  }
}

function makeSnapshot(over: Partial<StripeAccountSnapshot> = {}): StripeAccountSnapshot {
  return {
    auditScope: 'base',
    accountMode: 'test',
    livemode: false,
    account: acct(),
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

describe('configurationRules — requires contract', () => {
  it('every rule declares a non-empty requires over base regions ⊆ {account, tax, webhook_endpoints}', () => {
    expect(configurationRules).toHaveLength(7)
    const allowed = new Set<RuleScope>(['account', 'tax', 'webhook_endpoints'])
    for (const rule of configurationRules) {
      expect(rule.requires.length).toBeGreaterThan(0)
      for (const scope of rule.requires) {
        expect(allowed.has(scope)).toBe(true)
        expect(BASE_REGIONS.has(scope)).toBe(true)
      }
      expect(isDeepRule(rule)).toBe(false)
    }
  })
})

describe('TAX 3-state (null / pending / active are mutually exclusive)', () => {
  it('taxSettings null fires TAX_NOT_ENABLED exactly once and NOT TAX_SETTINGS_PENDING', () => {
    const snap = makeSnapshot({ taxSettings: null })
    expect(TAX_NOT_ENABLED.check(snap)).toHaveLength(1)
    expect(TAX_SETTINGS_PENDING.check(snap)).toEqual([])
  })

  it("status 'pending' fires TAX_SETTINGS_PENDING exactly once and NOT TAX_NOT_ENABLED", () => {
    const snap = makeSnapshot({ taxSettings: { status: 'pending', defaultTaxBehavior: 'exclusive' } })
    expect(TAX_SETTINGS_PENDING.check(snap)).toHaveLength(1)
    expect(TAX_NOT_ENABLED.check(snap)).toEqual([])
  })

  it("status 'active' fires neither TAX_NOT_ENABLED nor TAX_SETTINGS_PENDING", () => {
    const snap = makeSnapshot({ taxSettings: { status: 'active', defaultTaxBehavior: 'exclusive' } })
    expect(TAX_NOT_ENABLED.check(snap)).toEqual([])
    expect(TAX_SETTINGS_PENDING.check(snap)).toEqual([])
  })
})

describe('DEFAULT_TAX_BEHAVIOR_UNSET', () => {
  it('fires when tax is configured but defaultTaxBehavior is null', () => {
    expect(
      DEFAULT_TAX_BEHAVIOR_UNSET.check(makeSnapshot({ taxSettings: { status: 'active', defaultTaxBehavior: null } })),
    ).toHaveLength(1)
  })
  it('returns [] when a default tax behavior is set, or when tax is not enabled', () => {
    expect(
      DEFAULT_TAX_BEHAVIOR_UNSET.check(makeSnapshot({ taxSettings: { status: 'active', defaultTaxBehavior: 'inclusive' } })),
    ).toEqual([])
    expect(DEFAULT_TAX_BEHAVIOR_UNSET.check(makeSnapshot({ taxSettings: null }))).toEqual([])
  })
})

describe('UNBRANDED_RECEIPTS', () => {
  it('fires when both icon and logo are null', () => {
    expect(UNBRANDED_RECEIPTS.check(makeSnapshot({ account: acct({ branding: { icon: null, logo: null } }) }))).toHaveLength(1)
  })
  it('returns [] when either icon or logo is set', () => {
    expect(UNBRANDED_RECEIPTS.check(makeSnapshot({ account: acct({ branding: { icon: 'x', logo: null } }) }))).toEqual([])
  })
})

describe('DEFAULT_ACCOUNT_TAX_IDS_MISSING', () => {
  it('fires when defaultAccountTaxIdsSet is false', () => {
    expect(
      DEFAULT_ACCOUNT_TAX_IDS_MISSING.check(makeSnapshot({ account: acct({ defaultAccountTaxIdsSet: false }) })),
    ).toHaveLength(1)
  })
  it('returns [] when default account tax IDs are set', () => {
    expect(DEFAULT_ACCOUNT_TAX_IDS_MISSING.check(makeSnapshot({ account: acct({ defaultAccountTaxIdsSet: true }) }))).toEqual([])
  })
})

describe('STATEMENT_DESCRIPTOR_MISSING', () => {
  it('fires when statementDescriptor is null', () => {
    expect(
      STATEMENT_DESCRIPTOR_MISSING.check(makeSnapshot({ account: acct({ statementDescriptor: null }) })),
    ).toHaveLength(1)
  })
  it('returns [] when a statement descriptor is set', () => {
    expect(STATEMENT_DESCRIPTOR_MISSING.check(makeSnapshot({ account: acct({ statementDescriptor: 'ACME' }) }))).toEqual([])
  })
})

describe('EVENT_DESTINATIONS_NOT_AUDITED', () => {
  it('fires (info) when classic endpoints exist and v2 destinations are unaudited', () => {
    const findings = EVENT_DESTINATIONS_NOT_AUDITED.check(makeSnapshot({ webhookEndpoints: [endpoint()] }))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('info')
  })
  it('returns [] when there are no classic webhook endpoints', () => {
    expect(EVENT_DESTINATIONS_NOT_AUDITED.check(makeSnapshot({ webhookEndpoints: [] }))).toEqual([])
  })
})

describe('configuration findings — schema completeness', () => {
  it('every emitted finding is schema-complete', () => {
    const snap = makeSnapshot({
      account: acct({ statementDescriptor: null, branding: { icon: null, logo: null }, defaultAccountTaxIdsSet: false }),
      taxSettings: null,
      webhookEndpoints: [endpoint()],
    })
    const findings = configurationRules.flatMap((r) => r.check(snap))
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.ruleId).toBeTruthy()
      expect(f.title).toBeTruthy()
      expect(f.description).toBeTruthy()
      expect(f.remediation).toBeTruthy()
      expect(f.docsUrl).toMatch(/^https:\/\//)
      expect(f.category).toBe('configuration')
    }
  })
})
