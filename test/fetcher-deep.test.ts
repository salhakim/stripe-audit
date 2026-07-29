/**
 * Deep fetcher unit tests.
 *
 * Pins the two-speed contract: `{deep: false}` constructs ZERO deep requests
 * (spy counts); `{deep: true}` fans out over the four gate-approved regions
 * under one Promise.allSettled, degrading rejected-on-permission regions to
 * null + `{scope, granted:false}` with no unhandled rejection; and
 * `isPermissionDenied` covers BOTH error generations (v1 StripePermissionError,
 * v2 raw-403 StripeError). Radar is never fetched — its verify-gate landed
 * DROPPED (docs/verify-gates/RADAR_SETUP_INTENTS.md).
 */
import { describe, it, expect, vi } from 'vitest'
import Stripe from 'stripe'
import { fetchAccountSnapshot, isPermissionDenied } from '../src/fetcher'
import type { FetchOptions } from '../src/fetcher'
import { fakeKey } from './fixtures/fake-keys'

// Placeholder restricted test key — NOT a real credential. Drives accountMode='test'.
// Runtime-assembled so the source never matches a provider key pattern.
const TEST_KEY = fakeKey('rk', 'test')

const SUBSCRIPTION_CLASSIC = {
  id: 'sub_classic',
  status: 'active',
  billing_mode: { type: 'classic' },
}
const SUBSCRIPTION_FLEXIBLE = {
  id: 'sub_flexible',
  status: 'trialing',
  billing_mode: { type: 'flexible' },
}
const METER = { id: 'mtr_1', display_name: 'API calls', status: 'active', event_name: 'api_call' }
const DESTINATION = {
  id: 'ed_1',
  name: 'meter-error sink',
  status: 'enabled',
  enabled_events: ['v1.billing.meter.error_report_triggered'],
}
const COUPON = {
  id: 'co_forever',
  name: 'Launch 25',
  percent_off: 25.5,
  amount_off: null,
  currency: null,
  duration: 'forever',
  valid: true,
}

/** v1-style paginated list stub (same autoPagingToArray contract the SDK enforces). */
const list = (items: unknown[]) => ({
  autoPagingToArray: async (opts?: { limit?: number }) => {
    if (!opts?.limit || opts.limit > 10_000) throw new Error('bad autoPagingToArray limit')
    return items
  },
})
const listError = (err: unknown) => ({
  autoPagingToArray: async () => {
    throw err
  },
})

const v1PermissionError = () =>
  new Stripe.errors.StripePermissionError({ message: 'scope not granted' })
/** The divergent v2 shape: a plain StripeError carrying statusCode 403. */
const v2PermissionError = () =>
  new Stripe.errors.StripeError({ message: 'permission denied (v2)', statusCode: 403 }, 'StripeError')

interface DeepStub {
  subscriptions?: ReturnType<typeof list | typeof listError>
  meters?: ReturnType<typeof list | typeof listError>
  eventDestinations?: ReturnType<typeof list | typeof listError>
  coupons?: ReturnType<typeof list | typeof listError>
}

/** Stub with healthy base regions and spy-wrapped deep list constructors. */
function makeStripe(deep: DeepStub = {}) {
  const spies = {
    subscriptions: vi.fn(() => deep.subscriptions ?? list([SUBSCRIPTION_CLASSIC, SUBSCRIPTION_FLEXIBLE])),
    meters: vi.fn(() => deep.meters ?? list([METER])),
    eventDestinations: vi.fn(() => deep.eventDestinations ?? list([DESTINATION])),
    coupons: vi.fn(() => deep.coupons ?? list([COUPON])),
  }
  const stripe = {
    accounts: { retrieveCurrent: async () => ({ id: 'acct_1', charges_enabled: true, settings: {} }) },
    webhookEndpoints: { list: () => list([]) },
    prices: { list: () => list([]) },
    billingPortal: { configurations: { list: () => list([]) } },
    tax: { settings: { retrieve: async () => ({ status: 'active' }) } },
    subscriptions: { list: spies.subscriptions },
    billing: { meters: { list: spies.meters } },
    v2: { core: { eventDestinations: { list: spies.eventDestinations } } },
    coupons: { list: spies.coupons },
  } as unknown as Stripe
  return { stripe, spies }
}

function fetch(stripe: Stripe, options: FetchOptions = {}) {
  return fetchAccountSnapshot(stripe, TEST_KEY, options)
}

describe('deep fetcher — {deep: false} constructs zero deep requests', () => {
  it('never touches a deep list constructor on the base path', async () => {
    const { stripe, spies } = makeStripe()
    const snap = await fetch(stripe, { deep: false })
    expect(snap.auditScope).toBe('base')
    expect(spies.subscriptions).not.toHaveBeenCalled()
    expect(spies.meters).not.toHaveBeenCalled()
    expect(spies.eventDestinations).not.toHaveBeenCalled()
    expect(spies.coupons).not.toHaveBeenCalled()
  })
})

describe('deep fetcher — {deep: true} fan-out', () => {
  it('populates all four gate-approved regions and aggregates byBillingMode', async () => {
    const { stripe } = makeStripe()
    const snap = await fetch(stripe, { deep: true })
    expect(snap.auditScope).toBe('deep')
    expect(snap.subscriptionSummary).toEqual({
      total: 2,
      byStatus: { active: 1, trialing: 1 },
      byBillingMode: { classic: 1, flexible: 1 },
      // The trialing stub carries no trial_settings → bucketed as the
      // non-at-risk 'create_invoice'; the active one is not counted at all.
      byTrialEndBehavior: { create_invoice: 1 },
      pausedCollectionCount: 0,
    })
    expect(snap.meters).toEqual([
      { id: 'mtr_1', displayName: 'API calls', status: 'active', eventName: 'api_call' },
    ])
    expect(snap.thinEventDestinations).toEqual([
      {
        id: 'ed_1',
        name: 'meter-error sink',
        status: 'enabled',
        enabledEvents: ['v1.billing.meter.error_report_triggered'],
      },
    ])
    expect(snap.coupons).toEqual([
      {
        id: 'co_forever',
        name: 'Launch 25',
        percentOff: 25.5,
        amountOff: null,
        currency: null,
        duration: 'forever',
        valid: true,
        // The stub COUPON has no applies_to property at all — the absent case,
        // which must project to null exactly like an explicit null.
        appliesToProducts: null,
      },
    ])
    for (const scope of ['subscriptions', 'meters', 'event_destinations', 'coupons'] as const) {
      expect(snap.scopeProbe).toContainEqual({ scope, granted: true })
    }
  })

  it('projects applies_to.products, treating an explicit null the same as absent', async () => {
    // The three shapes the API can return. `applies_to` is an OPTIONAL plain
    // object, so no expand slot is spent — a scoped coupon carries its product
    // list inline on the list response.
    const { stripe } = makeStripe({
      coupons: list([
        { ...COUPON, id: 'co_scoped', applies_to: { products: ['prod_a', 'prod_b'] } },
        { ...COUPON, id: 'co_explicit_null', applies_to: null },
        { ...COUPON, id: 'co_absent' },
      ]),
    })
    const snap = await fetch(stripe, { deep: true })
    expect(snap.coupons?.map((c) => [c.id, c.appliesToProducts])).toEqual([
      ['co_scoped', ['prod_a', 'prod_b']],
      ['co_explicit_null', null],
      ['co_absent', null],
    ])
  })

  it('never fetches radar: no radarSettings, no scopeProbe entry (gate DROPPED)', async () => {
    const { stripe } = makeStripe()
    const snap = await fetch(stripe, { deep: true })
    expect(snap.radarSettings).toBeNull()
    expect(snap.scopeProbe.some((g) => g.scope === 'radar')).toBe(false)
  })

  it('one rejected region degrades alone (v1 shape) — siblings still populate', async () => {
    const { stripe } = makeStripe({ subscriptions: listError(v1PermissionError()) })
    const snap = await fetch(stripe, { deep: true })
    expect(snap.subscriptionSummary).toBeNull()
    expect(snap.scopeProbe).toContainEqual({ scope: 'subscriptions', granted: false })
    expect(snap.meters).toHaveLength(1)
    expect(snap.thinEventDestinations).toHaveLength(1)
    expect(snap.coupons).toHaveLength(1)
  })

  it('a v2-shape 403 on event destinations degrades that region alone', async () => {
    const { stripe } = makeStripe({ eventDestinations: listError(v2PermissionError()) })
    const snap = await fetch(stripe, { deep: true })
    expect(snap.thinEventDestinations).toBeNull()
    expect(snap.scopeProbe).toContainEqual({ scope: 'event_destinations', granted: false })
    expect(snap.subscriptionSummary).not.toBeNull()
  })

  it('base-6 key (every deep region denied) yields a clean all-null deep snapshot', async () => {
    const { stripe } = makeStripe({
      subscriptions: listError(v1PermissionError()),
      meters: listError(v1PermissionError()),
      eventDestinations: listError(v2PermissionError()),
      coupons: listError(v1PermissionError()),
    })
    const snap = await fetch(stripe, { deep: true })
    expect(snap.auditScope).toBe('deep') // deep regardless of grants
    expect(snap.subscriptionSummary).toBeNull()
    expect(snap.meters).toBeNull()
    expect(snap.thinEventDestinations).toBeNull()
    expect(snap.coupons).toBeNull()
    for (const scope of ['subscriptions', 'meters', 'event_destinations', 'coupons'] as const) {
      expect(snap.scopeProbe).toContainEqual({ scope, granted: false })
    }
  })

  it('a granted-but-empty region is [] / {total: 0}, distinct from denied null', async () => {
    const { stripe } = makeStripe({ subscriptions: list([]), meters: list([]) })
    const snap = await fetch(stripe, { deep: true })
    expect(snap.subscriptionSummary).toEqual({
      total: 0,
      byStatus: {},
      byBillingMode: {},
      byTrialEndBehavior: {},
      pausedCollectionCount: 0,
    })
    expect(snap.meters).toEqual([])
  })

  it('byTrialEndBehavior buckets TRIALING subscriptions only, defaulting a null trial_settings', async () => {
    // Four subscriptions: one trialing/cancel, one trialing/pause, one trialing
    // with NO trial_settings (→ the non-at-risk create_invoice bucket), and one
    // ACTIVE subscription that still carries trial_settings from a past trial —
    // it must not be counted, because only a trial that is still running can end
    // without a payment method.
    const trialing = (id: string, behavior: string | null) => ({
      id,
      status: 'trialing',
      billing_mode: { type: 'flexible' },
      trial_settings: behavior ? { end_behavior: { missing_payment_method: behavior } } : null,
    })
    const { stripe } = makeStripe({
      subscriptions: list([
        trialing('sub_cancel', 'cancel'),
        trialing('sub_pause', 'pause'),
        trialing('sub_unset', null),
        {
          id: 'sub_converted',
          status: 'active',
          billing_mode: { type: 'flexible' },
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
        },
      ]),
    })
    const snap = await fetch(stripe, { deep: true })
    expect(snap.subscriptionSummary?.byTrialEndBehavior).toEqual({
      cancel: 1,
      pause: 1,
      create_invoice: 1,
    })
    expect(snap.subscriptionSummary?.byStatus).toEqual({ trialing: 3, active: 1 })
  })

  it('pausedCollectionCount counts non-null pause_collection, whatever the status says', async () => {
    // The signal Stripe deliberately does NOT reflect in `status`: both paused
    // subscriptions below still report 'active', so byStatus can never show them.
    const { stripe } = makeStripe({
      subscriptions: list([
        {
          id: 'sub_paused_void',
          status: 'active',
          billing_mode: { type: 'flexible' },
          pause_collection: { behavior: 'void', resumes_at: null },
        },
        {
          id: 'sub_paused_draft',
          status: 'active',
          billing_mode: { type: 'flexible' },
          pause_collection: { behavior: 'keep_as_draft', resumes_at: 1780000000 },
        },
        { id: 'sub_normal', status: 'active', billing_mode: { type: 'flexible' } },
      ]),
    })
    const snap = await fetch(stripe, { deep: true })
    expect(snap.subscriptionSummary?.pausedCollectionCount).toBe(2)
    expect(snap.subscriptionSummary?.byStatus).toEqual({ active: 3 })
  })

  it('propagates a genuine non-permission deep failure (after all regions settle)', async () => {
    const { stripe } = makeStripe({ meters: listError(new Error('boom 500')) })
    await expect(fetch(stripe, { deep: true })).rejects.toThrow('boom 500')
  })
})

describe('deep livemode — deep objects backstop the base-region signal', () => {
  it('sources livemode from a deep object when no base region carries it', async () => {
    // makeStripe's base regions are all empty (no object carries livemode), so before
    // this fix the signal fell back to the key prefix — making the mode-mismatch rules
    // compare the prefix against itself, so a real mismatch could never fire. A deep
    // subscription reporting livemode:true must now reach snapshot.livemode.
    const { stripe } = makeStripe({
      subscriptions: list([{ ...SUBSCRIPTION_FLEXIBLE, livemode: true }]),
    })
    const snap = await fetch(stripe, { deep: true })
    // TEST_KEY is test-prefixed; observing livemode:true is exactly the
    // TEST_KEY_DETECTED_LIVE mismatch condition the security cluster fires on.
    expect(snap.livemode).toBe(true)
  })

  it('base mode is unchanged — deep arrays are [] so livemode stays prefix-derived', async () => {
    const { stripe } = makeStripe()
    const snap = await fetch(stripe, { deep: false })
    expect(snap.livemode).toBe(false)
  })
})

describe('isPermissionDenied — both API generations pinned', () => {
  it('matches the v1 StripePermissionError', () => {
    expect(isPermissionDenied(v1PermissionError())).toBe(true)
  })
  it('matches the v2 raw-403 StripeError shape', () => {
    expect(isPermissionDenied(v2PermissionError())).toBe(true)
  })
  it('rejects non-permission errors (401 auth, plain Error)', () => {
    expect(
      isPermissionDenied(new Stripe.errors.StripeAuthenticationError({ message: 'bad key', statusCode: 401 })),
    ).toBe(false)
    expect(isPermissionDenied(new Error('network'))).toBe(false)
  })
})
