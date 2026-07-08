/**
 * stripe-audit — read-only account fetcher.
 *
 * Issues ONLY read calls against a minimal 6-scope key and assembles a
 * {@link StripeAccountSnapshot}. It contains NO Stripe write methods (asserted by
 * a guard test). Per-region scope-probing means a partial-scope key
 * reports which regions it could read (via `scopeProbe`) instead of crashing on
 * the first `StripePermissionError`; any non-permission error propagates after
 * the SDK's own network retries.
 *
 * Two-speed: `options.deep` flips `auditScope` to 'deep' and fans out over the
 * gate-approved deep regions under the same allSettled + scope-probe
 * discipline as the base reads. `{deep: false}` constructs ZERO deep requests,
 * so a 6-scope key never triggers a speculative 403.
 */
import Stripe from 'stripe'
import { stripeAccountSnapshotSchema } from './snapshot-schema'
import { detectKeyMode } from './key'
import type {
  StripeAccountSnapshot,
  SnapshotAccount,
  SnapshotWebhookEndpoint,
  SnapshotPrice,
  SnapshotProduct,
  SnapshotPortalConfiguration,
  SnapshotTaxSettings,
  SubscriptionSummary,
  SnapshotMeter,
  ThinEventDestination,
  SnapshotCoupon,
  ScopeGrant,
  RuleScope,
} from './types'

/**
 * Hard ceiling the Stripe SDK enforces on `autoPagingToArray({ limit })` — a
 * `limit > 10000` throws (`node_modules/stripe/.../autoPagination.js`: `if (limit > 10000)`).
 * We request `MAX_LIST_ITEMS + 1` to detect overflow, so the kept cap MUST sit one
 * below this ceiling — otherwise the cap+1 request is illegal and every list region
 * throws against the real SDK (the stub masked this; stripe-mock CI caught it).
 */
const SDK_AUTOPAGE_MAX = 10_000

/** Upper bound on each auto-paginated list (memory guard for large catalogs). */
const MAX_LIST_ITEMS = SDK_AUTOPAGE_MAX - 1

/**
 * Split a fetched list at `cap`, reporting whether it overflowed.
 *
 * Lists are fetched with a limit of `cap + 1` precisely so this can tell a
 * catalog of *exactly* `cap` (complete) apart from one *larger* than `cap`
 * (truncated) — `length > cap` is only possible when at least one item beyond the
 * cap existed. When truncated, only the first `cap` items are kept; the overflow
 * is reported (not silently dropped) so the snapshot can flag a PARTIAL audit.
 */
export function applyBound<T>(items: T[], cap: number): { items: T[]; truncated: boolean } {
  if (items.length > cap) {
    return { items: items.slice(0, cap), truncated: true }
  }
  return { items, truncated: false }
}

/** Options for {@link fetchAccountSnapshot}. `deep` is the v0.2 two-speed opt-in. */
export interface FetchOptions {
  deep?: boolean
}

/**
 * Permission-denied predicate covering BOTH API generations.
 *
 * v1 REST 403s arrive as `StripePermissionError`. v2 endpoints (e.g. the
 * event-destinations list) route through the SDK's `generateV2Error`, which
 * falls back to the v1 mapping for 403s (`node_modules/stripe/cjs/Error.js`) —
 * but the raw-shape guard below also catches a v2 permission miss expressed as
 * a plain `StripeError` with `statusCode` 403, so a divergent v2 error shape
 * degrades the region instead of crashing the deep fan-out. Both branches are
 * pinned by `test/fetcher-deep.test.ts`.
 */
export function isPermissionDenied(err: unknown): boolean {
  if (err instanceof Stripe.errors.StripePermissionError) return true
  return err instanceof Stripe.errors.StripeError && err.statusCode === 403
}

/**
 * Run one region's fetch, recording the grant in `grants`. A permission-denied
 * error (the key lacks that scope — {@link isPermissionDenied}, v1 or v2 shape)
 * is caught and recorded as `{scope, granted:false}`, returning `fallback` so
 * the audit continues with a partial snapshot. Any other error propagates
 * (after the SDK's own network retries).
 */
async function probeRegion<T>(
  scope: RuleScope,
  fetch: () => Promise<T>,
  fallback: T,
  grants: ScopeGrant[],
): Promise<T> {
  try {
    const result = await fetch()
    grants.push({ scope, granted: true })
    return result
  } catch (err) {
    if (isPermissionDenied(err)) {
      grants.push({ scope, granted: false })
      return fallback
    }
    throw err
  }
}

/**
 * Scope-probe a LIST region and bound it to `MAX_LIST_ITEMS`.
 *
 * `fetchList` must request `MAX_LIST_ITEMS + 1` items so {@link applyBound} can
 * detect overflow. A permission-denied region degrades to `[]` (never flagged as
 * truncated — there was nothing to truncate); a region that overflowed the cap
 * records its scope in `truncated`. Returns the bounded (≤ `MAX_LIST_ITEMS`) list.
 */
async function probeListRegion<T>(
  scope: RuleScope,
  fetchList: () => Promise<T[]>,
  grants: ScopeGrant[],
  truncated: RuleScope[],
): Promise<T[]> {
  const all = await probeRegion<T[]>(scope, fetchList, [], grants)
  const bounded = applyBound(all, MAX_LIST_ITEMS)
  if (bounded.truncated) {
    truncated.push(scope)
  }
  return bounded.items
}

function mapAccount(account: Stripe.Account | null): SnapshotAccount {
  if (!account) {
    return {
      id: '',
      defaultAccountTaxIds: [],
      statementDescriptor: null,
      branding: { icon: null, logo: null },
      defaultAccountTaxIdsSet: false,
      chargesEnabled: false,
      requirements: null,
    }
  }
  const settings = account.settings
  const icon = settings?.branding?.icon
  const logo = settings?.branding?.logo
  // default_account_tax_ids is (string | TaxId)[] (expandable); we don't expand,
  // so normalize each entry to its id string.
  const taxIds = (settings?.invoices?.default_account_tax_ids ?? []).map((t) =>
    typeof t === 'string' ? t : t.id,
  )
  return {
    id: account.id,
    defaultAccountTaxIds: taxIds,
    statementDescriptor: settings?.payments?.statement_descriptor ?? null,
    branding: {
      icon: typeof icon === 'string' ? icon : null,
      logo: typeof logo === 'string' ? logo : null,
    },
    defaultAccountTaxIdsSet: taxIds.length > 0,
    chargesEnabled: account.charges_enabled ?? false,
    requirements: account.requirements
      ? {
          currentlyDue: account.requirements.currently_due ?? [],
          disabledReason: account.requirements.disabled_reason ?? null,
        }
      : null,
  }
}

function mapWebhook(endpoint: Stripe.WebhookEndpoint): SnapshotWebhookEndpoint {
  return {
    id: endpoint.id,
    url: endpoint.url,
    status: endpoint.status === 'enabled' ? 'enabled' : 'disabled',
    enabledEvents: endpoint.enabled_events,
    apiVersion: endpoint.api_version ?? null,
    description: endpoint.description ?? null,
  }
}

/** Normalize a `product.default_price` reference (id string, expanded Price, or null) to its id. */
function defaultPriceId(defaultPrice: string | Stripe.Price | Stripe.DeletedPrice | null | undefined): string | null {
  if (defaultPrice == null) return null
  return typeof defaultPrice === 'string' ? defaultPrice : defaultPrice.id
}

function mapProduct(product: string | Stripe.Product | Stripe.DeletedProduct): SnapshotProduct {
  if (typeof product === 'string') {
    return { id: product, name: '', active: false, defaultPrice: null }
  }
  if ('deleted' in product) {
    return { id: product.id, name: '(deleted product)', active: false, defaultPrice: null }
  }
  return {
    id: product.id,
    name: product.name,
    active: product.active,
    defaultPrice: defaultPriceId(product.default_price),
  }
}

function mapPrice(price: Stripe.Price): SnapshotPrice {
  return {
    id: price.id,
    active: price.active,
    taxBehavior: price.tax_behavior ?? null,
    currency: price.currency,
    unitAmount: price.unit_amount ?? null,
    type: price.type,
    recurring: price.recurring
      ? { interval: price.recurring.interval, intervalCount: price.recurring.interval_count }
      : null,
    nickname: price.nickname ?? null,
    lookupKey: price.lookup_key ?? null,
    customUnitAmount: price.custom_unit_amount
      ? { minimum: price.custom_unit_amount.minimum ?? null }
      : null,
    // currency_options is only present when expanded (see the list call below).
    currencyOptions: price.currency_options ? Object.keys(price.currency_options) : [],
    product: mapProduct(price.product),
  }
}

function mapPortal(config: Stripe.BillingPortal.Configuration): SnapshotPortalConfiguration {
  const features = config.features
  return {
    id: config.id,
    isDefault: config.is_default,
    customerUpdate: features.customer_update.enabled,
    invoiceHistory: features.invoice_history.enabled,
    paymentMethodUpdate: features.payment_method_update.enabled,
    subscriptionCancel: features.subscription_cancel.enabled,
    subscriptionUpdate: features.subscription_update.enabled,
    // login_page is a top-level field on the Configuration object, NOT under
    // features (portal_configuration.md:291; SDK Configuration.LoginPage).
    loginPage: config.login_page.enabled,
    subscriptionUpdateProration: features.subscription_update.proration_behavior ?? null,
  }
}

function mapTax(settings: Stripe.Tax.Settings | null): SnapshotTaxSettings | null {
  // null = tax not enabled / scope denied → TAX_NOT_ENABLED reads this as "off".
  if (!settings) return null
  return {
    status: settings.status === 'active' ? 'active' : 'pending',
    defaultTaxBehavior: settings.defaults?.tax_behavior ?? null,
  }
}

// ── deep-region mappers (regions per the verify-gate verdicts, docs/verify-gates/) ──

/** Aggregate counts only (bounded output for large fleets). */
function mapSubscriptionSummary(subs: Stripe.Subscription[]): SubscriptionSummary {
  const byStatus: Record<string, number> = {}
  const byBillingMode: Record<string, number> = {}
  for (const sub of subs) {
    byStatus[sub.status] = (byStatus[sub.status] ?? 0) + 1
    // billing_mode.type: 'classic' | 'flexible' (docs/verify-gates/BILLING_MODE.md).
    const mode = sub.billing_mode?.type ?? 'unknown'
    byBillingMode[mode] = (byBillingMode[mode] ?? 0) + 1
  }
  return { total: subs.length, byStatus, byBillingMode }
}

function mapMeter(meter: Stripe.Billing.Meter): SnapshotMeter {
  return {
    id: meter.id,
    displayName: meter.display_name,
    status: meter.status,
    eventName: meter.event_name,
  }
}

function mapThinDestination(dest: Stripe.V2.Core.EventDestination): ThinEventDestination {
  return {
    id: dest.id,
    name: dest.name,
    status: dest.status,
    enabledEvents: dest.enabled_events,
  }
}

function mapCoupon(coupon: Stripe.Coupon): SnapshotCoupon {
  return {
    id: coupon.id,
    name: coupon.name ?? null,
    percentOff: coupon.percent_off ?? null,
    amountOff: coupon.amount_off ?? null,
    currency: coupon.currency ?? null,
    duration: coupon.duration,
    valid: coupon.valid,
  }
}

/**
 * Fetch a read-only snapshot of the account. Base reads run concurrently; each is
 * scope-probed so a permission-denied region degrades to empty rather than
 * aborting. Prices are fetched WITHOUT an `active` filter so both active and
 * inactive prices appear (each carrying its own `active`), and products are
 * expanded inline.
 */
export async function fetchAccountSnapshot(
  stripe: Stripe,
  key: string,
  options?: FetchOptions,
): Promise<StripeAccountSnapshot> {
  const scopeProbe: ScopeGrant[] = []
  const truncated: RuleScope[] = []
  const auditScope: 'base' | 'deep' = options?.deep ? 'deep' : 'base'

  // accountMode is derived LOCALLY from the key prefix (no network call, no
  // dependence on charges_enabled) — see key.ts (key-exposure threat model).
  const accountMode = detectKeyMode(key).mode

  // Lists are fetched at MAX_LIST_ITEMS + 1 so probeListRegion can distinguish a
  // catalog of exactly the cap (complete) from a larger one (truncated → flagged).
  // This equals SDK_AUTOPAGE_MAX (10_000), the largest limit autoPagingToArray
  // accepts — MAX_LIST_ITEMS is deliberately one below the ceiling so cap+1 is legal.
  const LIST_LIMIT = MAX_LIST_ITEMS + 1

  // allSettled (not all): under a TOTAL failure (e.g. an invalid/expired key → every
  // region 401s) Promise.all surfaces the first rejection but leaves the sibling
  // rejections UNHANDLED, and Node then crashes with an uncaught error + stack trace.
  // allSettled awaits every region; we surface the first genuine error afterwards so
  // the audit still aborts. probeRegion has already swallowed permission errors, so any
  // rejection here is a real non-permission failure (auth/transport/5xx) to propagate.
  const settled = await Promise.allSettled([
    probeRegion<Stripe.Account | null>(
      'account',
      // retrieveCurrent() returns the account the API key belongs to (the plan's
      // `accounts.retrieve()` has no zero-arg overload; this is its current-account form).
      () => stripe.accounts.retrieveCurrent(),
      null,
      scopeProbe,
    ),
    probeListRegion<Stripe.WebhookEndpoint>(
      'webhook_endpoints',
      () => stripe.webhookEndpoints.list().autoPagingToArray({ limit: LIST_LIMIT }),
      scopeProbe,
      truncated,
    ),
    probeListRegion<Stripe.Price>(
      'prices',
      () =>
        stripe.prices
          // expand currency_options so CROSS_CURRENCY_PRICES / currencyOptions
          // have data (currency_options is omitted from list responses by default).
          .list({ expand: ['data.product', 'data.currency_options'] })
          .autoPagingToArray({ limit: LIST_LIMIT }),
      scopeProbe,
      truncated,
    ),
    probeListRegion<Stripe.BillingPortal.Configuration>(
      'billing_portal',
      () => stripe.billingPortal.configurations.list().autoPagingToArray({ limit: LIST_LIMIT }),
      scopeProbe,
      truncated,
    ),
    probeRegion<Stripe.Tax.Settings | null>(
      'tax',
      () => stripe.tax.settings.retrieve(),
      null,
      scopeProbe,
    ),
  ])
  for (const region of settled) {
    if (region.status === 'rejected') throw region.reason
  }
  const [accountR, webhooksR, pricesR, portalR, taxR] = settled
  // Every region is fulfilled here — the loop above re-threw on any rejection.
  const account = accountR.status === 'fulfilled' ? accountR.value : null
  const webhooks = webhooksR.status === 'fulfilled' ? webhooksR.value : []
  const prices = pricesR.status === 'fulfilled' ? pricesR.value : []
  const portalConfigs = portalR.status === 'fulfilled' ? portalR.value : []
  const taxSettings = taxR.status === 'fulfilled' ? taxR.value : null

  // Deep fan-out — ONLY under `{deep: true}`; `{deep: false}` constructs
  // ZERO deep requests (pinned by a spy-count test). Same allSettled discipline as
  // the base reads: every region settles, permission-denied regions were already
  // reduced to their fallback by probeRegion (null field + `{scope, granted:false}`
  // on scopeProbe), and any surviving rejection is a genuine non-permission failure
  // re-thrown after all regions settle — never an unhandled rejection.
  //
  // Radar is deliberately ABSENT from this fan-out: its verify-gate landed DROPPED
  // (docs/verify-gates/RADAR_SETUP_INTENTS.md — no Radar-settings API object
  // exists). No read is constructed, `radarSettings` stays null, and radar gets NO
  // scopeProbe entry: never-attempted ≠ denied.
  let deepSubs: Stripe.Subscription[] = []
  let deepMeters: Stripe.Billing.Meter[] = []
  let deepDestinations: Stripe.V2.Core.EventDestination[] = []
  let deepCoupons: Stripe.Coupon[] = []
  if (options?.deep) {
    const deepSettled = await Promise.allSettled([
      probeListRegion<Stripe.Subscription>(
        'subscriptions',
        // Default list = non-canceled subscriptions: exactly the fleet the
        // billing-mode migration signal reads (docs/verify-gates/BILLING_MODE.md).
        () => stripe.subscriptions.list().autoPagingToArray({ limit: LIST_LIMIT }),
        scopeProbe,
        truncated,
      ),
      probeListRegion<Stripe.Billing.Meter>(
        'meters',
        () => stripe.billing.meters.list().autoPagingToArray({ limit: LIST_LIMIT }),
        scopeProbe,
        truncated,
      ),
      probeListRegion<Stripe.V2.Core.EventDestination>(
        'event_destinations',
        // v2 list surface (docs/verify-gates/METER_ERROR.md): V2ListPromise also
        // exposes autoPagingToArray, so the v1 cap+1 overflow probe applies as-is.
        () => stripe.v2.core.eventDestinations.list().autoPagingToArray({ limit: LIST_LIMIT }),
        scopeProbe,
        truncated,
      ),
      probeListRegion<Stripe.Coupon>(
        'coupons',
        // Coupons routed deep (docs/verify-gates/COUPON_SCOPE.md).
        () => stripe.coupons.list().autoPagingToArray({ limit: LIST_LIMIT }),
        scopeProbe,
        truncated,
      ),
    ])
    for (const region of deepSettled) {
      if (region.status === 'rejected') throw region.reason
    }
    const [subsR, metersR, destsR, couponsR] = deepSettled
    deepSubs = subsR.status === 'fulfilled' ? subsR.value : []
    deepMeters = metersR.status === 'fulfilled' ? metersR.value : []
    deepDestinations = destsR.status === 'fulfilled' ? destsR.value : []
    deepCoupons = couponsR.status === 'fulfilled' ? couponsR.value : []
  }

  // Denied deep regions stay null (probeListRegion's [] fallback is ambiguous with
  // a genuinely-empty region, so consult the recorded grant): null = not readable,
  // [] / {total: 0} = readable and empty.
  const grantedScope = (scope: RuleScope): boolean =>
    scopeProbe.some((grant) => grant.scope === scope && grant.granted)

  // The Account object carries no livemode; source it from the first fetched object
  // that does — base regions first, then the deep-fetched objects. Subscriptions,
  // meters, and coupons all carry `livemode` (the v2 event-destination object does
  // NOT), so a deep-only key with no readable base region still surfaces the real
  // signal to the mode-mismatch security rules (TEST_KEY_DETECTED_LIVE /
  // LIVE_KEY_DETECTED_TEST) instead of falling back to the key prefix — which would
  // compare the prefix against itself and silently never fire. In base mode the deep
  // arrays are [] so their terms are undefined: zero base-mode behavior change.
  // Fall back to the key-prefix mode so a missing signal never fabricates a mismatch.
  const observedLivemode =
    webhooks[0]?.livemode ??
    prices[0]?.livemode ??
    portalConfigs[0]?.livemode ??
    taxSettings?.livemode ??
    deepSubs[0]?.livemode ??
    deepMeters[0]?.livemode ??
    deepCoupons[0]?.livemode
  const livemode = observedLivemode ?? (accountMode === 'live')

  const snapshot: StripeAccountSnapshot = {
    auditScope,
    accountMode,
    livemode,
    account: mapAccount(account),
    webhookEndpoints: webhooks.map(mapWebhook),
    prices: prices.map(mapPrice),
    portalConfigurations: portalConfigs.map(mapPortal),
    taxSettings: mapTax(taxSettings),
    subscriptionSummary:
      options?.deep && grantedScope('subscriptions') ? mapSubscriptionSummary(deepSubs) : null,
    meters: options?.deep && grantedScope('meters') ? deepMeters.map(mapMeter) : null,
    thinEventDestinations:
      options?.deep && grantedScope('event_destinations')
        ? deepDestinations.map(mapThinDestination)
        : null,
    // Never fetched — RADAR verify-gate DROPPED (see the fan-out comment above).
    radarSettings: null,
    coupons: options?.deep && grantedScope('coupons') ? deepCoupons.map(mapCoupon) : null,
    scopeProbe,
    truncated,
  }

  // Single validation chokepoint: a malformed snapshot throws ZodError here
  // rather than reaching the rule engine. (Output type also enforces the
  // schema↔interface mirror at compile time.)
  return stripeAccountSnapshotSchema.parse(snapshot)
}
