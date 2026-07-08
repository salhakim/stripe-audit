import { describe, it, expect, beforeAll, vi } from 'vitest'
import { connect } from 'node:net'
import Stripe from 'stripe'
import { fetchAccountSnapshot, applyBound } from '../src/fetcher'
import type { FetchOptions } from '../src/fetcher'
import { STRIPE_API_VERSION } from '../src/stripe-client'
import { stripeAccountSnapshotSchema } from '../src/snapshot-schema'

/** The Stripe SDK's autoPagingToArray ceiling — a `limit` above this throws (stripe@22). */
const SDK_AUTOPAGE_MAX = 10_000
/** Mirrors the fetcher's private MAX_LIST_ITEMS (one below the SDK ceiling so cap+1 is a
 *  legal limit) — a list of this+1 overflows the cap. */
const MAX_LIST_ITEMS = SDK_AUTOPAGE_MAX - 1

// Placeholder restricted test key — NOT a real credential. Drives accountMode='test'.
const TEST_KEY = 'rk_test_EXAMPLEonly0123456789abcd' // gitleaks:allow

/** Call the fetcher with the test key; merge any extra options. */
function fetch(stripe: Stripe, options: FetchOptions = {}) {
  return fetchAccountSnapshot(stripe, TEST_KEY, options)
}

// ── Fixtures (plain objects; the stripe stub is cast as Stripe, so the SDK types
//    are not enforced on these — only the fields the mappers read need to exist). ──
const ACCOUNT = {
  id: 'acct_1',
  charges_enabled: true,
  settings: {
    invoices: { default_account_tax_ids: ['txi_1'] },
    payments: { statement_descriptor: 'ACME' },
    branding: { icon: 'file_icon', logo: null },
  },
}
const WEBHOOK = {
  id: 'we_1',
  url: 'https://example.test/hook',
  status: 'enabled',
  enabled_events: ['charge.succeeded'],
  api_version: null,
  description: null,
}
const PRICE_ACTIVE = {
  id: 'price_active',
  active: true,
  tax_behavior: 'exclusive',
  currency: 'usd',
  unit_amount: 1000,
  type: 'recurring',
  recurring: { interval: 'month', interval_count: 1 },
  nickname: null,
  product: { id: 'prod_1', name: 'Pro', active: true },
}
const PRICE_INACTIVE = {
  id: 'price_inactive',
  active: false,
  tax_behavior: null,
  currency: 'usd',
  unit_amount: null,
  type: 'one_time',
  recurring: null,
  nickname: 'legacy',
  product: 'prod_2', // unexpanded id string
}
const PORTAL = {
  id: 'bpc_1',
  is_default: true,
  // login_page is a top-level field on the Configuration (sibling of features).
  login_page: { enabled: true },
  features: {
    customer_update: { enabled: true },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: false },
    subscription_cancel: { enabled: true },
    subscription_update: { enabled: false, proration_behavior: 'none' },
  },
}
const TAX = { status: 'active' }

interface StubParts {
  account?: unknown
  accountError?: unknown
  webhooks?: unknown[]
  prices?: unknown[]
  pricesError?: unknown
  portals?: unknown[]
  tax?: unknown
  taxError?: unknown
  /**
   * Deep-region overrides. When ABSENT the stub simulates a base-6
   * key: every deep list rejects permission-denied (v1 `StripePermissionError`
   * for the v1 surfaces; a raw 403 `StripeError` for the v2 event-destinations
   * surface, pinning `isPermissionDenied`'s v2 branch).
   */
  subscriptions?: unknown[]
  meters?: unknown[]
  eventDestinations?: unknown[]
  coupons?: unknown[]
}

function makeStripe(parts: StubParts = {}): Stripe {
  // Model the SDK's autoPagingToArray contract so the stub can't mask a bad limit:
  // a missing limit, or one above the 10,000 ceiling, throws exactly like stripe@22
  // (node_modules/stripe/.../autoPagination.js: `if (limit > 10000)`). Without this
  // the stub silently accepted limit=10_001 while the real SDK rejected it — the
  // exact gap that let the fetcher's cap+1 overflow probe ship broken to CI.
  const list = (items: unknown[]) => ({
    autoPagingToArray: async (opts?: { limit?: number }) => {
      if (!opts?.limit) {
        throw new Error(
          'You must pass a `limit` option to autoPagingToArray, e.g., `autoPagingToArray({limit: 1000});`.',
        )
      }
      if (opts.limit > SDK_AUTOPAGE_MAX) {
        throw new Error(
          'You cannot specify a limit of more than 10,000 items to fetch in `autoPagingToArray`; use `autoPagingEach` to iterate through longer lists.',
        )
      }
      return items
    },
  })
  // A list whose pagination rejects — used to simulate a permission-denied region.
  const listError = (err: unknown) => ({
    autoPagingToArray: async () => {
      throw err
    },
  })
  // Deep regions: provided items → fulfilled list; absent → permission-denied
  // (v1 error shape; the v2 event-destinations surface uses a raw 403 StripeError).
  const v1Denied = () =>
    listError(new Stripe.errors.StripePermissionError({ message: 'scope not granted' }))
  const v2Denied = () =>
    listError(
      new Stripe.errors.StripeError(
        { message: 'permission denied (v2 shape)', statusCode: 403 },
        'StripeError',
      ),
    )
  return {
    accounts: {
      retrieveCurrent: async () => {
        if (parts.accountError) throw parts.accountError
        return parts.account ?? ACCOUNT
      },
    },
    webhookEndpoints: { list: () => list(parts.webhooks ?? [WEBHOOK]) },
    prices: {
      list: () =>
        parts.pricesError ? listError(parts.pricesError) : list(parts.prices ?? [PRICE_ACTIVE, PRICE_INACTIVE]),
    },
    billingPortal: { configurations: { list: () => list(parts.portals ?? [PORTAL]) } },
    tax: {
      settings: {
        retrieve: async () => {
          if (parts.taxError) throw parts.taxError
          return parts.tax ?? TAX
        },
      },
    },
    subscriptions: { list: () => (parts.subscriptions ? list(parts.subscriptions) : v1Denied()) },
    billing: { meters: { list: () => (parts.meters ? list(parts.meters) : v1Denied()) } },
    v2: {
      core: {
        eventDestinations: {
          list: () => (parts.eventDestinations ? list(parts.eventDestinations) : v2Denied()),
        },
      },
    },
    coupons: { list: () => (parts.coupons ? list(parts.coupons) : v1Denied()) },
  } as unknown as Stripe
}

describe('fetchAccountSnapshot — base path', () => {
  it('returns a base snapshot with all five deep fields null', async () => {
    const snap = await fetch(makeStripe())
    expect(snap.auditScope).toBe('base')
    expect(snap.subscriptionSummary).toBeNull()
    expect(snap.meters).toBeNull()
    expect(snap.thinEventDestinations).toBeNull()
    expect(snap.radarSettings).toBeNull()
    expect(snap.coupons).toBeNull()
  })

  it('reports no truncation when every list is within the cap', async () => {
    const snap = await fetch(makeStripe())
    expect(snap.truncated).toEqual([])
  })

  it('populates scopeProbe with all five base regions granted', async () => {
    const snap = await fetch(makeStripe())
    const granted = snap.scopeProbe.filter((g) => g.granted).map((g) => g.scope).sort()
    expect(granted).toEqual(
      ['account', 'billing_portal', 'prices', 'tax', 'webhook_endpoints'].sort(),
    )
  })

  it('lifts account branding, statementDescriptor, and defaultAccountTaxIds', async () => {
    const snap = await fetch(makeStripe())
    expect(snap.account.id).toBe('acct_1')
    expect(snap.account.defaultAccountTaxIds).toEqual(['txi_1'])
    expect(snap.account.statementDescriptor).toBe('ACME')
    expect(snap.account.branding).toEqual({ icon: 'file_icon', logo: null })
  })

  it('includes BOTH active and inactive prices, each with its active flag', async () => {
    const snap = await fetch(makeStripe())
    expect(snap.prices.map((p) => p.id)).toEqual(['price_active', 'price_inactive'])
    expect(snap.prices.find((p) => p.id === 'price_active')?.active).toBe(true)
    expect(snap.prices.find((p) => p.id === 'price_inactive')?.active).toBe(false)
    // expanded product mapped; unexpanded id-string product tolerated
    expect(snap.prices[0].product).toEqual({ id: 'prod_1', name: 'Pro', active: true, defaultPrice: null })
    expect(snap.prices[1].product.id).toBe('prod_2')
  })

  it('maps portal configurations as an array with isDefault + feature flags', async () => {
    const snap = await fetch(makeStripe())
    expect(snap.portalConfigurations).toHaveLength(1)
    expect(snap.portalConfigurations[0].isDefault).toBe(true)
    expect(snap.portalConfigurations[0].paymentMethodUpdate).toBe(false)
    expect(snap.portalConfigurations[0].customerUpdate).toBe(true)
    expect(snap.portalConfigurations[0].loginPage).toBe(true)
    expect(snap.portalConfigurations[0].subscriptionUpdateProration).toBe('none')
  })
})

describe('fetchAccountSnapshot — accountMode seam', () => {
  it('derives accountMode locally from the key prefix (test)', async () => {
    const snap = await fetch(makeStripe())
    expect(snap.accountMode).toBe('test')
  })

  it('derives accountMode=live from a live key prefix', async () => {
    const snap = await fetchAccountSnapshot(
      makeStripe(),
      'rk_live_EXAMPLEonly0123456789abcd', // gitleaks:allow
    )
    expect(snap.accountMode).toBe('live')
  })
})

describe('fetchAccountSnapshot — two-speed (base-6 key + deep:true)', () => {
  it('degrades every deep region to null with granted:false probes, no rejection', async () => {
    // makeStripe's deep defaults reject permission-denied (v1 + v2 shapes) —
    // the base-6-key scenario: clean snapshot, nothing thrown.
    const snap = await fetch(makeStripe(), { deep: true })
    expect(snap.auditScope).toBe('deep')
    expect(snap.subscriptionSummary).toBeNull()
    expect(snap.meters).toBeNull()
    expect(snap.thinEventDestinations).toBeNull()
    expect(snap.radarSettings).toBeNull()
    expect(snap.coupons).toBeNull()
    for (const scope of ['subscriptions', 'meters', 'event_destinations', 'coupons'] as const) {
      expect(snap.scopeProbe).toContainEqual({ scope, granted: false })
    }
    // Radar was never attempted (verify-gate DROPPED): no probe entry at all.
    expect(snap.scopeProbe.some((g) => g.scope === 'radar')).toBe(false)
  })
})

describe('fetchAccountSnapshot — list truncation signal', () => {
  it('flags a region in `truncated` and keeps only MAX_LIST_ITEMS when a list overflows', async () => {
    // The fetcher requests MAX_LIST_ITEMS + 1 (= the legal SDK ceiling); a catalog
    // larger than the cap overflows. (The stub validates the limit like the SDK but
    // returns the array as-is, so applyBound — not the mock — enforces the bound here.)
    const overflowing = Array.from({ length: MAX_LIST_ITEMS + 1 }, (_, i) => ({
      id: `price_${i}`,
      active: true,
      currency: 'usd',
      type: 'one_time',
      product: 'prod_x',
    }))
    const snap = await fetch(makeStripe({ prices: overflowing }))
    expect(snap.truncated).toContain('prices')
    expect(snap.prices).toHaveLength(MAX_LIST_ITEMS)
  })

  it('does not flag a denied region as truncated (nothing was read to truncate)', async () => {
    const denied = new Stripe.errors.StripePermissionError({
      type: 'invalid_request_error',
      message: 'restricted key lacks prices scope',
    })
    const snap = await fetch(makeStripe({ pricesError: denied }))
    expect(snap.truncated).not.toContain('prices')
    expect(snap.prices).toEqual([])
  })
})

describe('applyBound', () => {
  it('keeps the list intact and reports not-truncated when at or under the cap', () => {
    expect(applyBound([1, 2], 2)).toEqual({ items: [1, 2], truncated: false })
    expect(applyBound([1], 2)).toEqual({ items: [1], truncated: false })
    expect(applyBound([], 2)).toEqual({ items: [], truncated: false })
  })

  it('slices to the cap and reports truncated when over', () => {
    expect(applyBound([1, 2, 3], 2)).toEqual({ items: [1, 2], truncated: true })
  })
})

describe('fetchAccountSnapshot — autoPagingToArray limit stays within the SDK ceiling', () => {
  // Regression guard for the cap+1 overflow probe: the fetcher requests MAX_LIST_ITEMS+1
  // so it can tell a complete catalog from a truncated one — but the SDK rejects any
  // limit > 10,000. If the cap is ever bumped TO the ceiling, cap+1 exceeds it and the
  // REAL SDK throws (stripe-mock CI caught exactly this once). Assert every list region's
  // limit lands at or below the ceiling.
  it('passes a limit <= the SDK ceiling to every list region', async () => {
    const limits: number[] = []
    const recording = (items: unknown[]) => ({
      autoPagingToArray: async (opts?: { limit?: number }) => {
        limits.push(opts?.limit ?? Number.NaN)
        return items
      },
    })
    const stripe = {
      accounts: { retrieveCurrent: async () => ACCOUNT },
      webhookEndpoints: { list: () => recording([WEBHOOK]) },
      prices: { list: () => recording([PRICE_ACTIVE]) },
      billingPortal: { configurations: { list: () => recording([PORTAL]) } },
      tax: { settings: { retrieve: async () => TAX } },
    } as unknown as Stripe

    await fetchAccountSnapshot(stripe, TEST_KEY)

    // One per list region (webhooks, prices, billing_portal); none exceed the ceiling.
    expect(limits.length).toBe(3)
    for (const limit of limits) expect(limit).toBeLessThanOrEqual(SDK_AUTOPAGE_MAX)
  })
})

describe('fetchAccountSnapshot — scope probing', () => {
  it('records granted:false on a StripePermissionError and does not crash', async () => {
    const denied = new Stripe.errors.StripePermissionError({
      type: 'invalid_request_error',
      message: 'restricted key lacks tax scope',
    })
    const snap = await fetch(makeStripe({ taxError: denied }))
    const taxGrant = snap.scopeProbe.find((g) => g.scope === 'tax')
    expect(taxGrant).toEqual({ scope: 'tax', granted: false })
    // tax region degrades to null (not enabled / scope denied) rather than crashing
    expect(snap.taxSettings).toBeNull()
    // other regions still read fine
    expect(snap.account.id).toBe('acct_1')
  })

  it('propagates a non-permission error rather than swallowing it as a scope signal', async () => {
    await expect(
      fetch(makeStripe({ taxError: new Error('500 server error') })),
    ).rejects.toThrow('500 server error')
  })
})

// ── stripe-mock integration ───────────────────────────────────────────────────
//
// Runs the REAL fetcher against a live stripe-mock (HTTP on localhost:12111, the
// default port — stripe-mock.md:93-94) instead of the hand-rolled stub above. It
// asserts only the SHAPE of the calls the fetcher makes — which endpoints fire,
// that prices.list carries no `active` filter (so inactive prices are read), and
// that NO subscriptions/customers calls happen (the locked 6-scope base key
// excludes them) — and that the assembled snapshot parses against the zod schema.
// It NEVER treats stripe-mock's canned content as ground truth (stripe-mock returns
// generic OpenAPI fixtures; stripe-mock.md:65-69 warns it can't model specific
// responses), so no field VALUE is asserted — only the schema and the call graph.
//
// Skips (exit 0, never fails) when stripe-mock is unreachable: STRIPE_MOCK=skip
// forces the skip (the docker-absent verification branch sets it), and a
// TCP reachability probe covers a bare `npm test` run with no container up.
const STRIPE_MOCK_HOST = '127.0.0.1'
const STRIPE_MOCK_PORT = 12111
// STRIPE_MOCK modes: 'skip' force-skips (the docker-absent checklist branch);
// 'require' turns an unreachable mock into a FAILURE instead of a skip (used by
// `npm run test:integration` and the CI stripe-mock job) so the integration block
// can never silently no-op; unset → skip when unreachable (a bare `npm test` with
// no container running).
const STRIPE_MOCK_SKIP = process.env.STRIPE_MOCK === 'skip'
const STRIPE_MOCK_REQUIRE = process.env.STRIPE_MOCK === 'require'

/** Resolve true iff a TCP connection to host:port opens within `timeoutMs`. */
function canConnect(host: string, port: number, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

describe.skipIf(STRIPE_MOCK_SKIP)('fetchAccountSnapshot — stripe-mock integration', () => {
  let reachable = false

  beforeAll(async () => {
    reachable = await canConnect(STRIPE_MOCK_HOST, STRIPE_MOCK_PORT)
    if (STRIPE_MOCK_REQUIRE && !reachable) {
      throw new Error(
        `STRIPE_MOCK=require but stripe-mock is unreachable on ${STRIPE_MOCK_HOST}:${STRIPE_MOCK_PORT}. ` +
          'Start it first: `npm run stripe-mock:up`.',
      )
    }
  })

  /** A real Stripe client pinned to STRIPE_API_VERSION, pointed at stripe-mock over HTTP. */
  function mockClient(): Stripe {
    return new Stripe(TEST_KEY, {
      host: STRIPE_MOCK_HOST,
      protocol: 'http',
      port: STRIPE_MOCK_PORT,
      apiVersion: STRIPE_API_VERSION,
    })
  }

  it('issues exactly the 6-scope base read calls and no subscriptions/customers calls', async (ctx) => {
    if (!reachable) ctx.skip()
    const stripe = mockClient()

    // Positive call-shape spies (call through to stripe-mock; vi.spyOn keeps the impl).
    const accountSpy = vi.spyOn(stripe.accounts, 'retrieveCurrent')
    const webhookSpy = vi.spyOn(stripe.webhookEndpoints, 'list')
    const priceSpy = vi.spyOn(stripe.prices, 'list')
    const portalSpy = vi.spyOn(stripe.billingPortal.configurations, 'list')
    const taxSpy = vi.spyOn(stripe.tax.settings, 'retrieve')
    // Negative spies: the base key excludes these regions — they must never fire.
    const subscriptionsListSpy = vi.spyOn(stripe.subscriptions, 'list')
    const customersListSpy = vi.spyOn(stripe.customers, 'list')

    const snap = await fetchAccountSnapshot(stripe, TEST_KEY)

    // Each base region was read exactly via its read endpoint.
    expect(accountSpy).toHaveBeenCalledTimes(1)
    expect(webhookSpy).toHaveBeenCalledTimes(1)
    expect(priceSpy).toHaveBeenCalledTimes(1)
    expect(portalSpy).toHaveBeenCalledTimes(1)
    expect(taxSpy).toHaveBeenCalledTimes(1)

    // prices.list carries NO `active` filter — both active and inactive prices read.
    const priceListArg = priceSpy.mock.calls[0]?.[0] as { active?: unknown } | undefined
    expect(priceListArg?.active).toBeUndefined()

    // The base snapshot never reaches into subscriptions/customers (deep/excluded).
    expect(subscriptionsListSpy).not.toHaveBeenCalled()
    expect(customersListSpy).not.toHaveBeenCalled()

    // Shape-only: the snapshot conforms to the zod schema. Never assert mock VALUES —
    // stripe-mock content is generic OpenAPI fixture data, not behavioral truth.
    expect(() => stripeAccountSnapshotSchema.parse(snap)).not.toThrow()
    expect(snap.auditScope).toBe('base')
    expect(snap.subscriptionSummary).toBeNull()
  })

  it('assembles a schema-valid snapshot from real stripe-mock responses', async (ctx) => {
    if (!reachable) ctx.skip()
    const snap = await fetchAccountSnapshot(mockClient(), TEST_KEY)
    // Validation is the fetcher's internal chokepoint; re-parse here makes the
    // schema contract explicit without asserting any stripe-mock field value.
    expect(() => stripeAccountSnapshotSchema.parse(snap)).not.toThrow()
    expect(Array.isArray(snap.scopeProbe)).toBe(true)
  })
})
