/**
 * stripe-audit — committed clean base snapshot.
 *
 * A require-able CommonJS module (so plain `node -e` and TS tests can both load it)
 * holding a fully-healthy StripeAccountSnapshot that yields ZERO findings from the
 * whole catalog. The golden harness uses it as the clean fixture, and derives the
 * all-issues / edge fixtures by mutation. Keep it clean: if a new rule ships, this
 * base must still produce no finding (extend the base, never weaken the rule).
 */
module.exports = {
  auditScope: 'base',
  accountMode: 'test',
  livemode: false,
  account: {
    id: 'acct_clean',
    defaultAccountTaxIds: ['txi_1'],
    statementDescriptor: 'ACME INC',
    branding: { icon: 'file_icon', logo: 'file_logo' },
    defaultAccountTaxIdsSet: true,
    chargesEnabled: true,
    requirements: null,
  },
  // No webhook endpoints: nothing for the webhook cluster (or the v2-coverage note) to flag.
  webhookEndpoints: [],
  prices: [
    {
      id: 'price_clean',
      active: true,
      taxBehavior: 'exclusive',
      currency: 'usd',
      unitAmount: 1500,
      type: 'recurring',
      recurring: { interval: 'month', intervalCount: 1 },
      nickname: 'Pro monthly',
      lookupKey: 'pro_monthly',
      customUnitAmount: null,
      currencyOptions: [],
      product: { id: 'prod_clean', name: 'Pro', active: true, defaultPrice: 'price_clean' },
    },
  ],
  portalConfigurations: [
    {
      id: 'bpc_clean',
      isDefault: true,
      customerUpdate: true,
      invoiceHistory: true,
      paymentMethodUpdate: true,
      subscriptionCancel: true,
      subscriptionUpdate: true,
      loginPage: true,
      subscriptionUpdateProration: 'create_prorations',
    },
  ],
  taxSettings: { status: 'active', defaultTaxBehavior: 'exclusive' },
  subscriptionSummary: null,
  meters: null,
  thinEventDestinations: null,
  radarSettings: null,
  scopeProbe: [
    { scope: 'account', granted: true },
    { scope: 'webhook_endpoints', granted: true },
    { scope: 'prices', granted: true },
    { scope: 'billing_portal', granted: true },
    { scope: 'tax', granted: true },
  ],
  truncated: [],
}
