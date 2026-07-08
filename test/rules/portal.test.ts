import { describe, it, expect } from 'vitest'
import { isDeepRule } from '../../src/engine'
import type { RuleScope, SnapshotPortalConfiguration, StripeAccountSnapshot } from '../../src/types'
import {
  portalRules,
  NO_CUSTOMER_PORTAL,
  PORTAL_PAYMENT_UPDATE_DISABLED,
  PORTAL_NO_CANCEL_FLOW,
  PORTAL_NO_INVOICE_HISTORY,
  PORTAL_NO_CUSTOMER_UPDATE,
  PORTAL_LOGIN_PAGE_DISABLED,
  PORTAL_PRORATION_NONE_ON_UPDATE,
} from '../../src/rules/portal'

/** A fully-healthy DEFAULT portal config; override one flag to trigger a rule. */
function pc(over: Partial<SnapshotPortalConfiguration> = {}): SnapshotPortalConfiguration {
  return {
    id: 'bpc_1',
    isDefault: true,
    customerUpdate: true,
    invoiceHistory: true,
    paymentMethodUpdate: true,
    subscriptionCancel: true,
    subscriptionUpdate: true,
    loginPage: true,
    subscriptionUpdateProration: 'create_prorations',
    ...over,
  }
}

function makeSnapshot(configs: SnapshotPortalConfiguration[]): StripeAccountSnapshot {
  return {
    auditScope: 'base',
    accountMode: 'test',
    livemode: false,
    account: {
      id: 'acct_1',
      defaultAccountTaxIds: [],
      statementDescriptor: null,
      branding: { icon: null, logo: null },
      defaultAccountTaxIdsSet: false,
      chargesEnabled: true,
      requirements: null,
    },
    webhookEndpoints: [],
    prices: [],
    portalConfigurations: configs,
    taxSettings: { status: 'active', defaultTaxBehavior: null },
    subscriptionSummary: null,
    meters: null,
    thinEventDestinations: null,
    radarSettings: null,
    coupons: null,
    scopeProbe: [],
    truncated: [],
  }
}

const BASE_REGIONS = new Set<RuleScope>([
  'account',
  'webhook_endpoints',
  'products',
  'prices',
  'billing_portal',
  'tax',
])

describe('portalRules — requires contract', () => {
  it('every rule declares requires: [billing_portal] (a base region, non-empty)', () => {
    expect(portalRules).toHaveLength(7)
    for (const rule of portalRules) {
      expect(rule.requires).toEqual(['billing_portal'])
      expect(BASE_REGIONS.has('billing_portal')).toBe(true)
      expect(isDeepRule(rule)).toBe(false)
    }
  })
})

describe('NO_CUSTOMER_PORTAL', () => {
  it('fires once on an empty portalConfigurations array', () => {
    expect(NO_CUSTOMER_PORTAL.check(makeSnapshot([]))).toHaveLength(1)
  })

  it('fires once when no entry is the default (isDefault all false)', () => {
    expect(NO_CUSTOMER_PORTAL.check(makeSnapshot([pc({ isDefault: false })]))).toHaveLength(1)
  })

  it('returns [] when a default config exists, and carries an estimatedImpact when it fires', () => {
    expect(NO_CUSTOMER_PORTAL.check(makeSnapshot([pc({ isDefault: true })]))).toEqual([])
    const fired = NO_CUSTOMER_PORTAL.check(makeSnapshot([]))
    expect(fired[0].estimatedImpact).toBeTruthy()
    expect(fired[0].severity).toBe('high')
  })
})

describe('per-feature portal rules (evaluate the default config)', () => {
  const cases: Array<[typeof PORTAL_PAYMENT_UPDATE_DISABLED, Partial<SnapshotPortalConfiguration>, string]> = [
    [PORTAL_PAYMENT_UPDATE_DISABLED, { paymentMethodUpdate: false }, 'high'],
    [PORTAL_NO_CANCEL_FLOW, { subscriptionCancel: false }, 'medium'],
    [PORTAL_NO_INVOICE_HISTORY, { invoiceHistory: false }, 'medium'],
    [PORTAL_NO_CUSTOMER_UPDATE, { customerUpdate: false }, 'medium'],
    [PORTAL_LOGIN_PAGE_DISABLED, { loginPage: false }, 'low'],
  ]

  for (const [rule, disabledFlag, severity] of cases) {
    it(`${rule.id} fires on a default config with the feature off (severity ${severity})`, () => {
      const findings = rule.check(makeSnapshot([pc(disabledFlag)]))
      expect(findings).toHaveLength(1)
      expect(findings[0].severity).toBe(severity)
      expect(findings[0].affectedResourceId).toBe('bpc_1')
    })

    it(`${rule.id} returns [] on a fully-enabled default config`, () => {
      expect(rule.check(makeSnapshot([pc()]))).toEqual([])
    })

    it(`${rule.id} returns [] when there is no default config (NO_CUSTOMER_PORTAL owns that)`, () => {
      expect(rule.check(makeSnapshot([pc({ isDefault: false, ...disabledFlag })]))).toEqual([])
    })
  }
})

describe('PORTAL_PRORATION_NONE_ON_UPDATE', () => {
  it("fires when subscription updates are enabled but proration is 'none'", () => {
    const snap = makeSnapshot([pc({ subscriptionUpdate: true, subscriptionUpdateProration: 'none' })])
    expect(PORTAL_PRORATION_NONE_ON_UPDATE.check(snap)).toHaveLength(1)
  })

  it("returns [] when proration is 'create_prorations', or when updates are disabled", () => {
    expect(
      PORTAL_PRORATION_NONE_ON_UPDATE.check(makeSnapshot([pc({ subscriptionUpdate: true, subscriptionUpdateProration: 'create_prorations' })])),
    ).toEqual([])
    expect(
      PORTAL_PRORATION_NONE_ON_UPDATE.check(makeSnapshot([pc({ subscriptionUpdate: false, subscriptionUpdateProration: 'none' })])),
    ).toEqual([])
  })
})

describe('portal findings — schema completeness', () => {
  it('every emitted finding is schema-complete', () => {
    const allOff = makeSnapshot([
      pc({
        paymentMethodUpdate: false,
        subscriptionCancel: false,
        invoiceHistory: false,
        customerUpdate: false,
        loginPage: false,
        subscriptionUpdate: true,
        subscriptionUpdateProration: 'none',
      }),
    ])
    const findings = portalRules.flatMap((r) => r.check(allOff))
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.ruleId).toBeTruthy()
      expect(f.title).toBeTruthy()
      expect(f.description).toBeTruthy()
      expect(f.remediation).toBeTruthy()
      expect(f.docsUrl).toMatch(/^https:\/\//)
      expect(f.category).toBe('billing')
    }
  })
})
