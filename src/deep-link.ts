/**
 * stripe-audit — restricted-key creation deep link.
 *
 * `buildRestrictedKeyLink` returns the DOCUMENTED, STABLE contract for creating a
 * least-privilege read-only restricted API key (RAK): the dashboard entry URL plus
 * the exact 6 read scopes a base audit needs — Account, Webhook Endpoints,
 * Products, Prices, Customer Portal, Tax — and NOTHING else (zero over-scoping: no
 * Customers, Subscriptions, Charges, PaymentIntents, or write grants).
 *
 * Pure: a string/data builder. No key value, no network call.
 *
 * Design decision: no query-string prefill. Stripe documents per-resource
 * Read/Write/None selection in the create-RAK flow but NO query-param contract for
 * preselecting scopes (see https://docs.stripe.com/keys/restricted-api-keys —
 * no prefill param appears anywhere in §"Create a restricted API
 * key"). Reverse-engineering the live dashboard's unstable prefill is the rejected
 * path — deferred to a future release. The SEAM is the structured `{ url, scopes }`
 * return: a future *verified* prefill can extend the URL (or add a `prefillUrl`
 * field) without changing any caller. The onboarding panel and the
 * plain-language 401 path both render this.
 */

/** The exact 6 read scopes a base audit requires — least privilege, no more. */
export const RESTRICTED_KEY_READ_SCOPES = [
  'Account',
  'Webhook Endpoints',
  'Products',
  'Prices',
  'Customer Portal',
  'Tax',
] as const

/** The documented Stripe Dashboard entry for creating a restricted API key. */
export const DASHBOARD_APIKEYS_URL = 'https://dashboard.stripe.com/apikeys'

/** The restricted-key creation guidance: where to go + which scopes to grant Read. */
export interface RestrictedKeyLink {
  /** The stable dashboard URL (no query-string prefill — see module doc). */
  url: string
  /** The exact read scopes to grant (everything else: None). */
  scopes: readonly string[]
}

/**
 * Build the restricted-key creation link contract.
 *
 * @returns `{ url, scopes }` — the dashboard URL plus exactly the 6 read scopes.
 *   Pure and deterministic; handles no key value and makes no network call.
 */
export function buildRestrictedKeyLink(): RestrictedKeyLink {
  return { url: DASHBOARD_APIKEYS_URL, scopes: [...RESTRICTED_KEY_READ_SCOPES] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep variant (security-sensitive: S1 live-key exposure, S4 over-broad scope)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The Dashboard permission NAMES for the deep (`--deep`) read scopes, on top of
 * the base 6 — the SINGLE source of truth for deep scope naming (extends the
 * base `{url, scopes}` seam; NO query-string prefill — Stripe
 * documents no such contract).
 *
 * PROVISIONAL — pending verification against the live restricted-key builder:
 * the cached `restricted-api-keys.md` / `api-keys.md` do not
 * enumerate the builder's exact permission labels, so each NAME below is our
 * best documented mapping and a correction is a one-line edit here, never a
 * scattered rename. Keys are the engine's deep `RuleScope` ids.
 *
 * Radar is deliberately ABSENT: its verify-gate landed DROPPED
 * (docs/verify-gates/RADAR_SETUP_INTENTS.md) — no radar read exists, so no
 * radar permission is ever requested (least privilege, S4).
 */
export const DEEP_SCOPE_PARAMS = {
  subscriptions: 'Subscriptions',
  meters: 'Billing Meters',
  event_destinations: 'Event Destinations',
  coupons: 'Coupons',
} as const

/** A deep `RuleScope` id that maps to a dashboard permission name. */
export type DeepScopeId = keyof typeof DEEP_SCOPE_PARAMS

/**
 * Build the DEEP restricted-key creation link contract: the same documented
 * dashboard URL plus base-6 AND deep read scope names (a 7th-scope-and-beyond
 * link). Pure — never embeds, logs, or echoes any key material (S1); requests
 * exactly the scopes the deep audit reads and nothing else (S4).
 */
export function buildDeepRestrictedKeyLink(): RestrictedKeyLink {
  return {
    url: DASHBOARD_APIKEYS_URL,
    scopes: [...RESTRICTED_KEY_READ_SCOPES, ...Object.values(DEEP_SCOPE_PARAMS)],
  }
}
