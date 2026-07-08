/**
 * stripe-audit — canonical documentation URLs for findings.
 *
 * Every {@link Finding} carries a `docsUrl` pointing the operator at the Stripe
 * documentation that explains the misconfiguration. Centralizing the URLs here
 * (rather than inlining string literals across every rule) keeps them consistent,
 * greppable, and trivially updatable when Stripe reorganizes its docs. Rules cite
 * `DOCS.<topic>` via {@link buildFinding}; they never hand-write a URL.
 *
 * The set is shared across every rule cluster (webhooks, portal, pricing, tax,
 * security).
 */

/** Canonical Stripe doc URLs, keyed by audit topic. Stable public docs roots. */
export const DOCS = {
  // webhooks
  webhooks: 'https://docs.stripe.com/webhooks',
  webhookEndpoints: 'https://docs.stripe.com/api/webhook_endpoints',
  webhookBestPractices: 'https://docs.stripe.com/webhooks/best-practices',
  // api version
  apiVersions: 'https://docs.stripe.com/upgrades',
  // customer portal
  customerPortal: 'https://docs.stripe.com/customer-management',
  portalConfiguration: 'https://docs.stripe.com/api/customer_portal/configuration',
  // pricing / catalog
  prices: 'https://docs.stripe.com/api/prices',
  products: 'https://docs.stripe.com/api/products',
  managePrices: 'https://docs.stripe.com/products-prices/manage-prices',
  // tax
  tax: 'https://docs.stripe.com/tax',
  taxSettings: 'https://docs.stripe.com/api/tax/settings',
  taxSetup: 'https://docs.stripe.com/tax/set-up',
  // subscriptions (deep region)
  subscriptions: 'https://docs.stripe.com/api/subscriptions',
  // coupons (deep region)
  coupons: 'https://docs.stripe.com/api/coupons',
  // event destinations (v2)
  eventDestinations: 'https://docs.stripe.com/event-destinations',
  // account / security
  account: 'https://docs.stripe.com/api/accounts',
  apiKeys: 'https://docs.stripe.com/keys',
  restrictedKeys: 'https://docs.stripe.com/keys#create-restricted-api-secret-key',
} as const

/** A valid key into the {@link DOCS} map. */
export type DocsTopic = keyof typeof DOCS
