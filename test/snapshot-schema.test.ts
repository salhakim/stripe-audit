import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ZodError } from 'zod'
import { stripeAccountSnapshotSchema } from '../src/snapshot-schema'

const validBase = {
  auditScope: 'base',
  accountMode: 'test',
  livemode: false,
  account: {
    id: 'acct_1',
    defaultAccountTaxIds: ['txi_1'],
    statementDescriptor: 'ACME',
    branding: { icon: null, logo: null },
    defaultAccountTaxIdsSet: true,
    chargesEnabled: true,
    requirements: null,
  },
  webhookEndpoints: [
    {
      id: 'we_1',
      url: 'https://example.test/hook',
      status: 'enabled',
      enabledEvents: ['charge.succeeded'],
      apiVersion: null,
      description: null,
    },
  ],
  prices: [
    {
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
      product: { id: 'prod_1', name: 'Pro', active: true, defaultPrice: 'price_1' },
    },
  ],
  portalConfigurations: [
    {
      id: 'bpc_1',
      isDefault: true,
      customerUpdate: true,
      invoiceHistory: true,
      paymentMethodUpdate: false,
      subscriptionCancel: true,
      subscriptionUpdate: false,
      loginPage: true,
      subscriptionUpdateProration: 'none',
    },
  ],
  taxSettings: { status: 'active', defaultTaxBehavior: 'exclusive' },
  subscriptionSummary: null,
  meters: null,
  thinEventDestinations: null,
  radarSettings: null,
  coupons: null,
  scopeProbe: [{ scope: 'account', granted: true }],
  truncated: [],
}

describe('stripeAccountSnapshotSchema', () => {
  it('parses a well-formed base snapshot (all five deep fields null) clean', () => {
    const parsed = stripeAccountSnapshotSchema.parse(validBase)
    expect(parsed.auditScope).toBe('base')
    expect(parsed.subscriptionSummary).toBeNull()
    expect(parsed.meters).toBeNull()
    expect(parsed.thinEventDestinations).toBeNull()
    expect(parsed.radarSettings).toBeNull()
    expect(parsed.coupons).toBeNull()
    expect(parsed.prices[0].active).toBe(true)
  })

  it('parses a deep snapshot with populated deep regions (forward-compat seam)', () => {
    const deep = {
      ...validBase,
      auditScope: 'deep',
      subscriptionSummary: {
        total: 3,
        byStatus: { active: 2, canceled: 1 },
        byBillingMode: { classic: 1, flexible: 2 },
      },
      meters: [{ id: 'mtr_1', displayName: 'API calls', status: 'active', eventName: 'api_call' }],
      thinEventDestinations: [{ id: 'ed_1', name: 'sink', status: 'enabled', enabledEvents: ['*'] }],
      radarSettings: { setupIntentsProtected: true },
      coupons: [
        {
          id: 'co_1',
          name: null,
          percentOff: 25.5,
          amountOff: null,
          currency: null,
          duration: 'forever',
          valid: true,
        },
      ],
    }
    expect(() => stripeAccountSnapshotSchema.parse(deep)).not.toThrow()
  })

  it('parses a snapshot flagging a truncated list region', () => {
    const parsed = stripeAccountSnapshotSchema.parse({ ...validBase, truncated: ['prices'] })
    expect(parsed.truncated).toEqual(['prices'])
  })

  it('throws ZodError on a non-RuleScope value in truncated', () => {
    const bad = { ...validBase, truncated: ['not_a_scope'] }
    expect(() => stripeAccountSnapshotSchema.parse(bad)).toThrow(ZodError)
  })

  it('throws ZodError on a bad taxSettings.status enum', () => {
    const bad = { ...validBase, taxSettings: { status: 'enabled' } }
    expect(() => stripeAccountSnapshotSchema.parse(bad)).toThrow(ZodError)
  })

  it('parses the accountMode seam field', () => {
    const parsed = stripeAccountSnapshotSchema.parse(validBase)
    expect(parsed.accountMode).toBe('test')
  })

  it('throws ZodError on a non-test/live accountMode', () => {
    const bad = { ...validBase, accountMode: 'sandbox' }
    expect(() => stripeAccountSnapshotSchema.parse(bad)).toThrow(ZodError)
  })

  it('throws ZodError on a missing required field', () => {
    const { scopeProbe: _omit, ...withoutScopeProbe } = validBase
    void _omit
    expect(() => stripeAccountSnapshotSchema.parse(withoutScopeProbe)).toThrow(ZodError)
  })
})

describe('read-only fetcher invariant', () => {
  it('src/fetcher.ts contains no Stripe write-method calls', () => {
    const source = readFileSync('src/fetcher.ts', 'utf8')
    expect(/\.(create|update|del|cancel)\(/.test(source)).toBe(false)
  })
})
