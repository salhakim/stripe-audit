/**
 * stripe-audit — pricing rule cluster.
 *
 * Eight pure `(snapshot) => Finding[]` rules over the `products` + `prices` base
 * regions, re-grounded against the v1 rule-readability audit and the Stripe
 * docs (manage prices; the Price and Product API objects).
 *
 * The snapshot is price-centric: products are reached via `price.product`, so a
 * product with ZERO prices is invisible here (a named limitation recorded in
 * COVERAGE.md). ALL_PRICES_INACTIVE relies on the fetcher carrying
 * BOTH active and inactive prices (no `active:true` filter). Every rule's
 * `requires` is a subset of {'products','prices'}, so the cluster derives to base tier.
 */
import { defineRule } from '../define-rule'
import type { Finding, Rule, SnapshotPrice, SnapshotProduct, StripeAccountSnapshot } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/** Group the snapshot's prices by their product id. */
function pricesByProduct(snapshot: StripeAccountSnapshot): Map<string, SnapshotPrice[]> {
  const map = new Map<string, SnapshotPrice[]>()
  for (const price of snapshot.prices) {
    const list = map.get(price.product.id) ?? []
    list.push(price)
    map.set(price.product.id, list)
  }
  return map
}

/** Distinct products reached via prices (first occurrence wins; zero-price products are invisible). */
function distinctProducts(snapshot: StripeAccountSnapshot): SnapshotProduct[] {
  const seen = new Map<string, SnapshotProduct>()
  for (const price of snapshot.prices) {
    if (!seen.has(price.product.id)) seen.set(price.product.id, price.product)
  }
  return [...seen.values()]
}

/**
 * A grouping key for "same shape" prices: currency + type + recurring cadence +
 * amount. The amount dimension is `'custom'` for a pay-what-you-want
 * price (`custom_unit_amount` non-null per the Price schema — prices_object.md:113)
 * else the stringified `unitAmount`, so a fixed price and a PWYW price on the
 * same product/currency/cadence are intentionally-distinct offerings, never
 * duplicates — while two same-amount fixed prices, or two PWYW prices, on one
 * cadence still collide. `null` unitAmount stringifies ('null'), so two
 * amountless (tiered) prices still collide — the prior behavior on that edge,
 * kept deliberately. Accepted trade-off:
 * two FIXED prices with different amounts on one cadence no longer flag
 * (grandfathered/tiered offerings are usually intentional).
 */
function priceShapeKey(price: SnapshotPrice): string {
  const cadence = price.recurring ? `${price.recurring.interval}:${price.recurring.intervalCount}` : 'one_time'
  const amount = price.customUnitAmount !== null ? 'custom' : String(price.unitAmount)
  return `${price.currency}|${price.type}|${cadence}|${amount}`
}

/** Active recurring price with no lookup key — brittle references on price recreation. */
export const PRICE_NO_LOOKUP_KEY: Rule = defineRule({
  id: 'PRICE_NO_LOOKUP_KEY',
  name: 'Active recurring price has no lookup key',
  severity: 'low',
  category: 'pricing',
  requires: ['prices'],
  check: (snapshot) =>
    snapshot.prices
      .filter((p) => p.active && p.type === 'recurring' && p.lookupKey === null)
      .map((p) =>
        buildFinding(PRICE_NO_LOOKUP_KEY, {
          title: 'Active recurring price has no lookup key',
          description: `Price ${p.id} is active and recurring but has no lookup_key. Referencing prices by raw id is brittle — a lookup_key lets you swap the underlying price without a code change.`,
          remediation: 'Assign a stable lookup_key to the price so your integration references it by key, not id.',
          docsUrl: DOCS.managePrices,
          affectedResourceId: p.id,
          affectedResourceType: 'price',
        }),
      ),
})

/** An active product whose prices are ALL inactive — it cannot be purchased. */
export const ALL_PRICES_INACTIVE: Rule = defineRule({
  id: 'ALL_PRICES_INACTIVE',
  name: 'Active product has no active price',
  severity: 'high',
  category: 'pricing',
  requires: ['products', 'prices'],
  check: (snapshot) => {
    const byProduct = pricesByProduct(snapshot)
    const findings: Finding[] = []
    for (const product of distinctProducts(snapshot)) {
      if (!product.active) continue
      const prices = byProduct.get(product.id) ?? []
      if (prices.length > 0 && prices.every((p) => !p.active)) {
        findings.push(
          buildFinding(ALL_PRICES_INACTIVE, {
            title: 'Active product has no active price',
            description: `Product ${product.id} (${product.name}) is active but every one of its prices is inactive. The product cannot be purchased — any checkout or payment link for it fails.`,
            remediation: 'Activate a price for the product, or archive the product if it is no longer sold.',
            docsUrl: DOCS.managePrices,
            affectedResourceId: product.id,
            affectedResourceType: 'product',
            estimatedImpact: 'An active, unsellable product silently blocks every purchase attempt for it.',
          }),
        )
      }
    }
    return findings
  },
})

/** An active price explicitly set to 0 — likely an unintended giveaway (distinct from null/tiered). */
export const PRICE_ZERO_AMOUNT: Rule = defineRule({
  id: 'PRICE_ZERO_AMOUNT',
  name: 'Active price set to zero',
  severity: 'medium',
  category: 'pricing',
  requires: ['prices'],
  check: (snapshot) =>
    snapshot.prices
      // unitAmount === 0 ONLY — null means tiered/custom billing (not a zero price).
      .filter((p) => p.active && p.unitAmount === 0)
      .map((p) =>
        buildFinding(PRICE_ZERO_AMOUNT, {
          title: 'Active price is set to zero',
          description: `Price ${p.id} is active with a unit amount of 0 ${p.currency.toUpperCase()}. If this is not an intentional free tier, the product is being given away.`,
          remediation: 'Confirm the zero amount is intentional; otherwise set a non-zero unit amount.',
          docsUrl: DOCS.managePrices,
          affectedResourceId: p.id,
          affectedResourceType: 'price',
        }),
      ),
})

/** A product whose default_price is missing or points at an inactive price. */
export const DEFAULT_PRICE_MISSING_OR_INACTIVE: Rule = defineRule({
  id: 'DEFAULT_PRICE_MISSING_OR_INACTIVE',
  name: 'Product default price missing or inactive',
  severity: 'medium',
  category: 'pricing',
  requires: ['products', 'prices'],
  check: (snapshot) => {
    const activeById = new Map(snapshot.prices.map((p) => [p.id, p.active]))
    const findings: Finding[] = []
    for (const product of distinctProducts(snapshot)) {
      if (!product.active) continue
      const def = product.defaultPrice
      let reason: string | null = null
      if (def === null) {
        reason = 'has no default price set'
      } else if (activeById.get(def) === false) {
        // Found in the snapshot and inactive. (Unknown ids are left indeterminate.)
        reason = `points at inactive price ${def}`
      }
      if (reason !== null) {
        findings.push(
          buildFinding(DEFAULT_PRICE_MISSING_OR_INACTIVE, {
            title: 'Product default price missing or inactive',
            description: `Product ${product.id} (${product.name}) ${reason}. Stripe requires the default price to be an active price; payment links and Checkout that rely on it will misbehave.`,
            remediation: 'Set the product default price to an active price.',
            docsUrl: DOCS.managePrices,
            affectedResourceId: product.id,
            affectedResourceType: 'product',
          }),
        )
      }
    }
    return findings
  },
})

/** More than one active price for the same product + currency + cadence + amount shape — ambiguous canonical price. */
export const MULTIPLE_ACTIVE_PRICES_PER_PRODUCT: Rule = defineRule({
  id: 'MULTIPLE_ACTIVE_PRICES_PER_PRODUCT',
  name: 'Multiple active prices for the same product and cadence',
  severity: 'low',
  category: 'pricing',
  requires: ['products', 'prices'],
  check: (snapshot) => {
    const byProduct = pricesByProduct(snapshot)
    const findings: Finding[] = []
    for (const [productId, prices] of byProduct) {
      const shapes = new Map<string, number>()
      for (const p of prices) {
        if (!p.active) continue
        shapes.set(priceShapeKey(p), (shapes.get(priceShapeKey(p)) ?? 0) + 1)
      }
      if ([...shapes.values()].some((n) => n > 1)) {
        findings.push(
          buildFinding(MULTIPLE_ACTIVE_PRICES_PER_PRODUCT, {
            title: 'Multiple active prices for the same product and cadence',
            description: `Product ${productId} has more than one active price for the same currency, billing cadence, and amount shape. Stripe's convention is exactly one canonical active price per cadence; duplicates make "the price" ambiguous.`,
            remediation: 'Archive the redundant prices, keeping one canonical active price per currency/cadence/amount (grandfathered prices aside).',
            docsUrl: DOCS.managePrices,
            affectedResourceId: productId,
            affectedResourceType: 'product',
          }),
        )
      }
    }
    return findings
  },
})

/** An active price with no explicit tax behavior — tax may be miscalculated. */
export const PRICE_TAX_BEHAVIOR_UNSPECIFIED: Rule = defineRule({
  id: 'PRICE_TAX_BEHAVIOR_UNSPECIFIED',
  name: 'Active price has unspecified tax behavior',
  severity: 'medium',
  category: 'pricing',
  requires: ['prices'],
  check: (snapshot) =>
    snapshot.prices
      .filter((p) => p.active && (p.taxBehavior === null || p.taxBehavior === 'unspecified'))
      .map((p) =>
        buildFinding(PRICE_TAX_BEHAVIOR_UNSPECIFIED, {
          title: 'Active price has unspecified tax behavior',
          description: `Price ${p.id} is active with tax_behavior unspecified. Stripe cannot tell whether the amount is tax-inclusive or exclusive, risking incorrect tax on every charge.`,
          remediation: "Set the price's tax_behavior to 'inclusive' or 'exclusive'.",
          docsUrl: DOCS.tax,
          affectedResourceId: p.id,
          affectedResourceType: 'price',
        }),
      ),
})

/** A pay-what-you-want price with no minimum — customers can pay zero. */
export const CUSTOM_UNIT_AMOUNT_NO_MINIMUM: Rule = defineRule({
  id: 'CUSTOM_UNIT_AMOUNT_NO_MINIMUM',
  name: 'Customer-chosen price has no minimum',
  severity: 'medium',
  category: 'pricing',
  requires: ['prices'],
  check: (snapshot) =>
    snapshot.prices
      .filter((p) => p.active && p.customUnitAmount !== null && p.customUnitAmount.minimum === null)
      .map((p) =>
        buildFinding(CUSTOM_UNIT_AMOUNT_NO_MINIMUM, {
          title: 'Customer-chosen price has no minimum',
          description: `Price ${p.id} lets the customer choose the amount (custom_unit_amount) but sets no minimum. Customers can pay arbitrarily little — including effectively nothing.`,
          remediation: 'Set a minimum on the custom unit amount so pay-what-you-want has a floor.',
          docsUrl: DOCS.managePrices,
          affectedResourceId: p.id,
          affectedResourceType: 'price',
        }),
      ),
})

/** A product that mixes per-currency Price objects AND on-price currency_options. */
export const CROSS_CURRENCY_PRICES: Rule = defineRule({
  id: 'CROSS_CURRENCY_PRICES',
  name: 'Product mixes multi-currency mechanisms',
  severity: 'low',
  category: 'pricing',
  requires: ['products', 'prices'],
  check: (snapshot) => {
    const byProduct = pricesByProduct(snapshot)
    const findings: Finding[] = []
    for (const [productId, prices] of byProduct) {
      const active = prices.filter((p) => p.active)
      const baseCurrencies = new Set(active.map((p) => p.currency))
      const hasCurrencyOptions = active.some((p) => p.currencyOptions.length > 0)
      if (hasCurrencyOptions && baseCurrencies.size > 1) {
        findings.push(
          buildFinding(CROSS_CURRENCY_PRICES, {
            title: 'Product mixes multi-currency mechanisms',
            description: `Product ${productId} has active prices in multiple base currencies AND prices using currency_options. Mixing per-currency Price objects with on-price currency_options makes "which price applies" ambiguous and easy to misconfigure.`,
            remediation: 'Pick one multi-currency mechanism per product — either separate Price objects per currency, or a single price with currency_options.',
            docsUrl: DOCS.managePrices,
            affectedResourceId: productId,
            affectedResourceType: 'product',
          }),
        )
      }
    }
    return findings
  },
})

/** The pricing rule cluster, in stable order. Aggregated into ALL_RULES by `index.ts`. */
export const pricingRules: Rule[] = [
  PRICE_NO_LOOKUP_KEY,
  ALL_PRICES_INACTIVE,
  PRICE_ZERO_AMOUNT,
  DEFAULT_PRICE_MISSING_OR_INACTIVE,
  MULTIPLE_ACTIVE_PRICES_PER_PRODUCT,
  PRICE_TAX_BEHAVIOR_UNSPECIFIED,
  CUSTOM_UNIT_AMOUNT_NO_MINIMUM,
  CROSS_CURRENCY_PRICES,
]
