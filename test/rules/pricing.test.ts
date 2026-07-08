import { describe, it, expect } from 'vitest'
import { isDeepRule } from '../../src/engine'
import type { RuleScope, SnapshotPrice, SnapshotProduct, StripeAccountSnapshot } from '../../src/types'
import {
  pricingRules,
  PRICE_NO_LOOKUP_KEY,
  ALL_PRICES_INACTIVE,
  PRICE_ZERO_AMOUNT,
  DEFAULT_PRICE_MISSING_OR_INACTIVE,
  MULTIPLE_ACTIVE_PRICES_PER_PRODUCT,
  PRICE_TAX_BEHAVIOR_UNSPECIFIED,
  CUSTOM_UNIT_AMOUNT_NO_MINIMUM,
  CROSS_CURRENCY_PRICES,
} from '../../src/rules/pricing'

const BASE_REGIONS = new Set<RuleScope>([
  'account',
  'webhook_endpoints',
  'products',
  'prices',
  'billing_portal',
  'tax',
])

function prod(over: Partial<SnapshotProduct> = {}): SnapshotProduct {
  return { id: 'prod_1', name: 'Pro', active: true, defaultPrice: 'price_1', ...over }
}

/** A healthy active recurring price; override to trigger a rule. */
function price(over: Partial<SnapshotPrice> = {}): SnapshotPrice {
  return {
    id: 'price_1',
    active: true,
    taxBehavior: 'exclusive',
    currency: 'usd',
    unitAmount: 1000,
    type: 'recurring',
    recurring: { interval: 'month', intervalCount: 1 },
    nickname: null,
    lookupKey: 'pro_monthly',
    customUnitAmount: null,
    currencyOptions: [],
    product: prod(),
    ...over,
  }
}

function makeSnapshot(prices: SnapshotPrice[]): StripeAccountSnapshot {
  return {
    auditScope: 'base',
    accountMode: 'test',
    livemode: false,
    account: { id: 'acct_1', defaultAccountTaxIds: [], statementDescriptor: null, branding: { icon: null, logo: null }, defaultAccountTaxIdsSet: false, chargesEnabled: true, requirements: null },
    webhookEndpoints: [],
    prices,
    portalConfigurations: [],
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

describe('pricingRules — requires contract', () => {
  it('every rule declares a non-empty requires over base regions ⊆ {products, prices}', () => {
    expect(pricingRules).toHaveLength(8)
    const allowed = new Set<RuleScope>(['products', 'prices'])
    for (const rule of pricingRules) {
      expect(rule.requires.length).toBeGreaterThan(0)
      for (const scope of rule.requires) {
        expect(allowed.has(scope)).toBe(true)
        expect(BASE_REGIONS.has(scope)).toBe(true)
      }
      expect(isDeepRule(rule)).toBe(false)
    }
  })
})

describe('PRICE_NO_LOOKUP_KEY', () => {
  it('fires on an active recurring price with no lookup key', () => {
    expect(PRICE_NO_LOOKUP_KEY.check(makeSnapshot([price({ lookupKey: null })]))).toHaveLength(1)
  })
  it('returns [] when the price has a lookup key', () => {
    expect(PRICE_NO_LOOKUP_KEY.check(makeSnapshot([price({ lookupKey: 'k' })]))).toEqual([])
  })
})

describe('ALL_PRICES_INACTIVE', () => {
  it('fires on an active product whose only price is inactive (reads inactive prices)', () => {
    const findings = ALL_PRICES_INACTIVE.check(makeSnapshot([price({ active: false })]))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
    expect(findings[0].estimatedImpact).toBeTruthy()
  })
  it('returns [] when the product has at least one active price', () => {
    const snap = makeSnapshot([price({ id: 'p_old', active: false }), price({ id: 'p_new', active: true })])
    expect(ALL_PRICES_INACTIVE.check(snap)).toEqual([])
  })
  it('returns [] for an inactive product (only active products are flagged)', () => {
    const snap = makeSnapshot([price({ active: false, product: prod({ active: false }) })])
    expect(ALL_PRICES_INACTIVE.check(snap)).toEqual([])
  })
})

describe('PRICE_ZERO_AMOUNT', () => {
  it('fires on unitAmount === 0', () => {
    expect(PRICE_ZERO_AMOUNT.check(makeSnapshot([price({ unitAmount: 0 })]))).toHaveLength(1)
  })
  it('returns [] on unitAmount === null (tiered/custom, NOT a zero price)', () => {
    expect(PRICE_ZERO_AMOUNT.check(makeSnapshot([price({ unitAmount: null })]))).toEqual([])
  })
})

describe('DEFAULT_PRICE_MISSING_OR_INACTIVE', () => {
  it('fires when the product has no default price', () => {
    expect(
      DEFAULT_PRICE_MISSING_OR_INACTIVE.check(makeSnapshot([price({ product: prod({ defaultPrice: null }) })])),
    ).toHaveLength(1)
  })
  it('fires when default price points at an inactive price in the snapshot', () => {
    const snap = makeSnapshot([
      price({ id: 'price_old', active: false, product: prod({ defaultPrice: 'price_old' }) }),
      price({ id: 'price_new', active: true, product: prod({ defaultPrice: 'price_old' }) }),
    ])
    expect(DEFAULT_PRICE_MISSING_OR_INACTIVE.check(snap)).toHaveLength(1)
  })
  it('returns [] when default price points at an active price', () => {
    expect(
      DEFAULT_PRICE_MISSING_OR_INACTIVE.check(makeSnapshot([price({ id: 'price_1', product: prod({ defaultPrice: 'price_1' }) })])),
    ).toEqual([])
  })
})

describe('MULTIPLE_ACTIVE_PRICES_PER_PRODUCT', () => {
  it('fires on two active prices with the same currency + cadence + amount (true duplicates)', () => {
    const snap = makeSnapshot([price({ id: 'p1' }), price({ id: 'p2' })])
    expect(MULTIPLE_ACTIVE_PRICES_PER_PRODUCT.check(snap)).toHaveLength(1)
  })
  it('returns [] when cadence differs', () => {
    const snap = makeSnapshot([
      price({ id: 'p1', recurring: { interval: 'month', intervalCount: 1 } }),
      price({ id: 'p2', recurring: { interval: 'year', intervalCount: 1 } }),
    ])
    expect(MULTIPLE_ACTIVE_PRICES_PER_PRODUCT.check(snap)).toEqual([])
  })
  it('returns [] for a fixed price + a pay-what-you-want price on the same cadence', () => {
    // Intentionally-distinct offerings — the PWYW false positive this fix closes.
    const snap = makeSnapshot([
      price({ id: 'p_fixed', unitAmount: 1000 }),
      price({ id: 'p_pwyw', unitAmount: null, customUnitAmount: { minimum: 500 } }),
    ])
    expect(MULTIPLE_ACTIVE_PRICES_PER_PRODUCT.check(snap)).toEqual([])
  })
  it('still fires on two pay-what-you-want prices on the same cadence (both amount=custom)', () => {
    const snap = makeSnapshot([
      price({ id: 'p_pwyw1', unitAmount: null, customUnitAmount: { minimum: 500 } }),
      price({ id: 'p_pwyw2', unitAmount: null, customUnitAmount: { minimum: null } }),
    ])
    expect(MULTIPLE_ACTIVE_PRICES_PER_PRODUCT.check(snap)).toHaveLength(1)
  })
  it('returns [] for two FIXED prices with different amounts (accepted trade-off)', () => {
    // Grandfathered/tiered offerings are usually intentional — the new intended
    // semantics; the earlier rule would have flagged these.
    const snap = makeSnapshot([
      price({ id: 'p_10', unitAmount: 1000 }),
      price({ id: 'p_15', unitAmount: 1500 }),
    ])
    expect(MULTIPLE_ACTIVE_PRICES_PER_PRODUCT.check(snap)).toEqual([])
  })
  it('still fires on two amountless (tiered) prices — null stringifies, preserving the original edge', () => {
    const snap = makeSnapshot([
      price({ id: 'p_t1', unitAmount: null }),
      price({ id: 'p_t2', unitAmount: null }),
    ])
    expect(MULTIPLE_ACTIVE_PRICES_PER_PRODUCT.check(snap)).toHaveLength(1)
  })
})

describe('PRICE_TAX_BEHAVIOR_UNSPECIFIED', () => {
  it('fires when tax behavior is null or unspecified', () => {
    expect(PRICE_TAX_BEHAVIOR_UNSPECIFIED.check(makeSnapshot([price({ taxBehavior: null })]))).toHaveLength(1)
    expect(PRICE_TAX_BEHAVIOR_UNSPECIFIED.check(makeSnapshot([price({ taxBehavior: 'unspecified' })]))).toHaveLength(1)
  })
  it('returns [] when tax behavior is exclusive/inclusive', () => {
    expect(PRICE_TAX_BEHAVIOR_UNSPECIFIED.check(makeSnapshot([price({ taxBehavior: 'exclusive' })]))).toEqual([])
  })
})

describe('CUSTOM_UNIT_AMOUNT_NO_MINIMUM', () => {
  it('fires when custom unit amount has no minimum', () => {
    const snap = makeSnapshot([price({ unitAmount: null, customUnitAmount: { minimum: null } })])
    expect(CUSTOM_UNIT_AMOUNT_NO_MINIMUM.check(snap)).toHaveLength(1)
  })
  it('returns [] when a minimum is set, or when there is no custom unit amount', () => {
    expect(
      CUSTOM_UNIT_AMOUNT_NO_MINIMUM.check(makeSnapshot([price({ unitAmount: null, customUnitAmount: { minimum: 500 } })])),
    ).toEqual([])
    expect(CUSTOM_UNIT_AMOUNT_NO_MINIMUM.check(makeSnapshot([price({ customUnitAmount: null })]))).toEqual([])
  })
})

describe('CROSS_CURRENCY_PRICES', () => {
  it('fires when a product mixes multiple base currencies AND currency_options', () => {
    const snap = makeSnapshot([
      price({ id: 'p_usd', currency: 'usd', currencyOptions: ['eur', 'gbp'] }),
      price({ id: 'p_eur', currency: 'eur' }),
    ])
    expect(CROSS_CURRENCY_PRICES.check(snap)).toHaveLength(1)
  })
  it('returns [] for a single base currency (currency_options alone is fine)', () => {
    const snap = makeSnapshot([price({ id: 'p_usd', currency: 'usd', currencyOptions: ['eur', 'gbp'] })])
    expect(CROSS_CURRENCY_PRICES.check(snap)).toEqual([])
  })
})

describe('pricing findings — schema completeness', () => {
  it('every emitted finding is schema-complete', () => {
    const findings = pricingRules.flatMap((r) =>
      r.check(
        makeSnapshot([
          price({ id: 'p1', active: true, lookupKey: null, taxBehavior: null, unitAmount: 0, product: prod({ defaultPrice: null }) }),
          price({ id: 'p2', active: true, taxBehavior: null, product: prod({ defaultPrice: null }) }),
        ]),
      ),
    )
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.ruleId).toBeTruthy()
      expect(f.title).toBeTruthy()
      expect(f.description).toBeTruthy()
      expect(f.remediation).toBeTruthy()
      expect(f.docsUrl).toMatch(/^https:\/\//)
      expect(f.category).toBe('pricing')
    }
  })
})
