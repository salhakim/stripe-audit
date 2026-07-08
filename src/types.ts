/**
 * stripe-audit — core type contract.
 *
 * This file is the single source of truth for the shapes the whole product reads:
 *   1. `StripeAccountSnapshot` — the normalized, read-only view of a Stripe account
 *      that the fetcher produces and every rule consumes.
 *   2. `RuleScope` — the read regions a restricted key may or may not grant
 *      (`scopeProbe` below references it, so it is declared here).
 *   3. The rule/finding contract (`Severity`, `Category`, `Rule`, `Finding`),
 *      appended in the next section.
 *
 * Design rule: the snapshot models ONLY fields a minimal, read-only 6-scope restricted
 * key can actually read. It deliberately contains NONE of the seven phantom fields the
 * original audit flagged as unreadable under a restricted key — see the enumerated list
 * in the v1 rule-readability audit (§Structural fixes).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Scope contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A read region a rule depends on, and a restricted key may or may not grant.
 *
 * The **base-6** are everything a minimal read-only key reads in base mode. The
 * **deep-5** are the v0.2 two-speed (`--deep`) regions — never read in base mode.
 * A rule's base/deep tier is DERIVED (deep ⇔ any required region is a deep-5), so
 * there is no separate stored tier flag.
 */
export type RuleScope =
  // base-6 — readable by a minimal read-only restricted key
  | 'account'
  | 'webhook_endpoints'
  | 'products'
  | 'prices'
  | 'billing_portal'
  | 'tax'
  // deep-5 — `--deep` regions; never read in base mode
  | 'subscriptions'
  | 'radar'
  | 'meters'
  | 'event_destinations'
  // 5th deep region — coupon cluster routed deep by a verify-gate verdict
  // (docs/verify-gates/COUPON_SCOPE.md: coupons need a 7th+ RAK permission)
  | 'coupons'

// ─────────────────────────────────────────────────────────────────────────────
// Base-region snapshot shapes (6-scope readable)
// ─────────────────────────────────────────────────────────────────────────────

/** Account branding — `account.settings.branding` (icon/logo only; the audit reads no more). */
export interface AccountBranding {
  icon: string | null
  logo: string | null
}

/** The account-level fields a 6-scope key can read that the audit cares about. */
export interface SnapshotAccount {
  id: string
  /** `account.settings.invoices.default_account_tax_ids` — the IDs, never a phantom prefix. */
  defaultAccountTaxIds: string[]
  /** `account.settings.payments.statement_descriptor`. */
  statementDescriptor: string | null
  branding: AccountBranding
  /** Derived: `defaultAccountTaxIds.length > 0` (invoice default tax IDs configured). */
  defaultAccountTaxIdsSet: boolean
  /** `account.charges_enabled` — whether the account can currently create charges. */
  chargesEnabled: boolean
  /**
   * `account.requirements` — outstanding onboarding/verification requirements, or
   * null when the account exposes none. `currentlyDue` is the list of fields due
   * now; `disabledReason` is set when capabilities are disabled pending them.
   */
  requirements: { currentlyDue: string[]; disabledReason: string | null } | null
}

/** A configured webhook endpoint (`webhook_endpoints` scope). */
export interface SnapshotWebhookEndpoint {
  id: string
  url: string
  status: 'enabled' | 'disabled'
  enabledEvents: string[]
  /** The endpoint's pinned API version, or null when it tracks the account default. */
  apiVersion: string | null
  description: string | null
}

/** A product, as expanded off its price (`products` scope, via price expansion). */
export interface SnapshotProduct {
  id: string
  name: string
  active: boolean
  /**
   * `product.default_price` — the price id Stripe uses when none is specified
   * (payment links, checkout). null when unset or unresolvable. Stripe requires
   * the default price to be an active price.
   */
  defaultPrice: string | null
}

/**
 * A price (`prices` scope). Both active AND inactive prices are represented —
 * each records its own `active` boolean so catalog rules are never blinded by a
 * default `active:true` filter.
 */
export interface SnapshotPrice {
  id: string
  active: boolean
  /** `price.tax_behavior` — 'inclusive' | 'exclusive' | 'unspecified' | null. */
  taxBehavior: string | null
  currency: string
  unitAmount: number | null
  type: 'one_time' | 'recurring'
  recurring: { interval: string; intervalCount: number } | null
  nickname: string | null
  /** `price.lookup_key` — a stable handle for the price; null when not set. */
  lookupKey: string | null
  /**
   * `price.custom_unit_amount` (pay-what-you-want) — present only when the price
   * lets the customer choose the amount. `minimum` is the floor (null = no floor).
   * null when the price has a fixed `unitAmount`.
   */
  customUnitAmount: { minimum: number | null } | null
  /** Currency codes present in `price.currency_options` (multi-currency on one price). */
  currencyOptions: string[]
  product: SnapshotProduct
}

/** A customer-portal configuration (`billing_portal` scope). Fetched as an array. */
export interface SnapshotPortalConfiguration {
  id: string
  /** Whether this is the account's default configuration (`is_default`). */
  isDefault: boolean
  /** Flattened `features.*.enabled` flags the portal rules read. */
  customerUpdate: boolean
  invoiceHistory: boolean
  paymentMethodUpdate: boolean
  subscriptionCancel: boolean
  subscriptionUpdate: boolean
  /** `features.login_page.enabled` — whether the hosted portal login page is on. */
  loginPage: boolean
  /**
   * `features.subscription_update.proration_behavior` —
   * 'always_invoice' | 'create_prorations' | 'none' (null if not modelled).
   * 'none' while subscription updates are enabled means mid-cycle plan changes
   * skip proration — a revenue leak the portal rules flag.
   */
  subscriptionUpdateProration: string | null
}

/** Stripe Tax settings (`tax` scope). Status is the enum — never a boolean. */
export interface SnapshotTaxSettings {
  status: 'active' | 'pending'
  /** `defaults.tax_behavior` — 'inclusive' | 'exclusive' | null (no default set). */
  defaultTaxBehavior: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep-region seams (`--deep`; null in base mode)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four interfaces below are append-only SEAMS for the v0.2 two-speed
 * audit. The base-mode fetcher always leaves the matching snapshot fields `null`
 * — a minimal 6-scope key never reads these regions. Their internal shapes are the
 * normalized projections the deep fetcher will fill once the deep-scope docs are
 * verified; adding fields to them later is non-breaking.
 */

/** v0.2 — aggregate of the account's subscriptions (drives BILLING_MODE_NOT_MIGRATED). */
export interface SubscriptionSummary {
  total: number
  byStatus: Record<string, number>
  /**
   * Count per `billing_mode.type` ('classic' | 'flexible' — verify-gate verdict,
   * docs/verify-gates/BILLING_MODE.md). Aggregate counts only: rules need "any
   * classic?", never the per-subscription list, so large fleets stay bounded.
   */
  byBillingMode: Record<string, number>
}

/** v0.2 — a Billing Meter (drives METER_ERROR_NOT_MONITORED). */
export interface SnapshotMeter {
  id: string
  displayName: string
  status: string
  eventName: string
}

/** v0.2 — a v2 event destination / "thin event" sink. */
export interface ThinEventDestination {
  id: string
  name: string
  status: string
  enabledEvents: string[]
}

/** v0.2 — Radar configuration projection (drives RADAR_SETUP_INTENTS_NOT_ENABLED). */
export interface RadarSettings {
  setupIntentsProtected: boolean
}

/**
 * v0.2 — a Coupon projection (drives HIGH_PERCENT_COUPON /
 * FOREVER_COUPON_STILL_VALID, the coupon cluster routed deep).
 */
export interface SnapshotCoupon {
  id: string
  name: string | null
  /** `percent_off` — float, null when the coupon is amount-based. */
  percentOff: number | null
  /** `amount_off` — integer minor units, null when the coupon is percent-based. */
  amountOff: number | null
  /** ISO currency for `amount_off`; null for percent coupons. */
  currency: string | null
  /** `duration` enum: 'forever' | 'once' | 'repeating'. */
  duration: string
  valid: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// The snapshot
// ─────────────────────────────────────────────────────────────────────────────

/** A single region's grant signal, derived from caught permission errors during fetch. */
export interface ScopeGrant {
  scope: RuleScope
  granted: boolean
}

/**
 * The complete, normalized, read-only view of a Stripe account the audit operates on.
 *
 * Produced by `fetchAccountSnapshot`, validated by the zod schema,
 * and consumed by `runRules` + every rule's `check()`.
 */
export interface StripeAccountSnapshot {
  /** Which fetch tier produced this snapshot. Base mode sets `'base'`. */
  auditScope: 'base' | 'deep'

  /**
   * Whether the key that produced this snapshot is a TEST or LIVE key, derived
   * LOCALLY from the key prefix (`detectKeyMode`), never from a live API field
   * like `charges_enabled`. Rules that read it (e.g. WEBHOOK_INSECURE_URL) declare
   * `requires: ['account']` — it is key-derived but account-associated.
   */
  accountMode: 'test' | 'live'

  /**
   * The server's livemode signal, captured from a fetched object's `livemode`
   * (the Account object has none). Compared against {@link accountMode} (the key
   * prefix) to detect a test-key-on-live / live-key-on-test mismatch. Falls back to
   * `accountMode === 'live'` when no fetched object carried a livemode (so a missing
   * signal never manufactures a false mismatch).
   */
  livemode: boolean

  // ── base regions (always populated) ──
  account: SnapshotAccount
  webhookEndpoints: SnapshotWebhookEndpoint[]
  prices: SnapshotPrice[]
  portalConfigurations: SnapshotPortalConfiguration[]
  /** Stripe Tax settings, or null when tax is not enabled / the scope was denied. */
  taxSettings: SnapshotTaxSettings | null

  // ── deep-region seams (null in base mode; v0.2 fills them under `--deep`) ──
  subscriptionSummary: SubscriptionSummary | null
  meters: SnapshotMeter[] | null
  thinEventDestinations: ThinEventDestination[] | null
  radarSettings: RadarSettings | null
  /** Coupon cluster — routed deep (docs/verify-gates/COUPON_SCOPE.md). */
  coupons: SnapshotCoupon[] | null

  /** Which scopes the key actually granted, derived from caught fetch errors. */
  scopeProbe: ScopeGrant[]

  /**
   * List regions whose fetch hit the `MAX_LIST_ITEMS` cap and were therefore
   * truncated — the snapshot holds only the first `MAX_LIST_ITEMS` of them. Empty
   * when nothing was capped. Reporters surface this as a PARTIAL-audit signal so a
   * large catalog (e.g. >10k prices) is never silently under-audited. Symmetric
   * with {@link scopeProbe}: a parallel per-region signal derived during fetch.
   */
  truncated: RuleScope[]
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule / Finding contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finding severities, ranked highest → lowest. `info` is a non-actionable note.
 * The VALUE array is the single runtime source of truth (the union type is
 * derived from it), so vocabulary checks can never drift from the type.
 */
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const

/** Finding severity, ranked highest → lowest. `info` is a non-actionable note. */
export type Severity = (typeof SEVERITIES)[number]

/**
 * The audit domains a rule and its findings belong to — the runtime source of
 * truth for the `Category` union, same single-source pattern as {@link SEVERITIES}.
 */
export const CATEGORIES = [
  'webhooks',
  'billing',
  'security',
  'configuration',
  'payments',
  'pricing',
] as const

/** The audit domain a rule and its findings belong to. */
export type Category = (typeof CATEGORIES)[number]

/**
 * Per-rule configuration passed as the optional 2nd arg to `check()`.
 *
 * A v0.2 seam — `resolveRules` merges defaults + user config into this
 * bag and feeds it to every rule. Core rules ignore it (the param is optional),
 * so a `check(snapshot)` literal still satisfies the `Rule` type.
 */
export type RuleOptions = Record<string, unknown>

/**
 * A single audit finding — one misconfiguration on one resource.
 *
 * `affectedResourceId` is null for account-wide findings (and for the synthetic
 * `info` finding the engine emits when a rule's `check()` throws — see the engine).
 */
export interface Finding {
  ruleId: string
  severity: Severity
  category: Category
  title: string
  affectedResourceId: string | null
  affectedResourceType: string
  description: string
  remediation: string
  docsUrl: string
  /** Optional human-readable revenue/impact estimate, e.g. "~$X/mo at risk". */
  estimatedImpact?: string
}

/**
 * An audit rule — a pure predicate over a snapshot that emits zero or more findings.
 *
 * `requires` lists the data regions the rule reads; the base/deep tier is DERIVED
 * (a rule is deep iff any required region is one of the deep-5 `RuleScope`s), so
 * there is NO separate stored tier field. The 2nd `check` param is optional: a
 * `check(snapshot) => Finding[]` literal still satisfies this contract.
 */
export interface Rule {
  id: string
  name: string
  severity: Severity
  category: Category
  requires: RuleScope[]
  check: (snapshot: StripeAccountSnapshot, options?: RuleOptions) => Finding[]
}
