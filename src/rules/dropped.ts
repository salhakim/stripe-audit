/**
 * stripe-audit — the DROPPED-rule registry.
 *
 * Every rule the project consciously decided NOT to build, with the reason, the
 * lever that would change the verdict, and a pointer to the evidence. A rule lands
 * here when its readability verify-gate (`docs/verify-gates/<NAME>.md`) or a
 * re-grounding pass proved the rule cannot be built — or is not worth building —
 * against a restricted read-only key. `--list-rules` renders this registry so
 * "why is rule X missing?" always has a citable answer.
 *
 * Data-only: nothing here registers in `ALL_RULES` or reaches the engine.
 *
 * EVIDENCE DISCIPLINE (v0.3). Every `reason` in this file is a claim the CLI
 * prints to users, so it carries the same evidence burden as a finding. Each
 * entry's `evidence` therefore points at a specific cached documentation file or
 * verdict, never a generic "see the audit" string. This rule was learned the hard
 * way: TRIAL_WITHOUT_PAYMENT_COLLECTION sat here for a month asserting its setting
 * could not be read, when the field is a plain enum on an object the
 * audit already fetched. It now ships as an active rule
 * (`docs/verify-gates/TRIAL_END_BEHAVIOR.md`). Before adding an entry, read the
 * schema page for the exact field — not a summary of a neighbouring capability.
 */

/**
 * Why a rule is not built — the LEVER that would change the verdict, not a
 * synonym for "no". Naming the lever is what makes the registry re-auditable:
 * each category has a different trigger for revisiting.
 *
 * - `api-gap` — the data does not exist in the API at all under any key. Only a
 *   Stripe API change moves this.
 * - `scope-gated` — the data is readable, but sits in a region this audit does
 *   not fetch. Adding the region moves this — a decision we control.
 * - `low-value` — the data is readable and in scope, but the rule would not earn
 *   its place (redundant with a shipping rule, or the condition is not a problem).
 */
export type DroppedCategory = 'api-gap' | 'scope-gated' | 'low-value'

/** A consciously-dropped rule: the id that will never ship, and why. */
export interface DroppedRule {
  /** The rule id as originally specced (UPPER_SNAKE; never registered). */
  id: string
  /** Which lever would change this verdict — see {@link DroppedCategory}. */
  category: DroppedCategory
  /** One-line reason the rule is not built. Printed to users by `--list-rules`. */
  reason: string
  /** Where the drop was decided (verify-gate decision id or re-grounding pass). */
  decidedIn: string
  /** Evidence pointer: a cached stack-doc path or a verify-gate verdict file. */
  evidence: string
  /** What would have to become true for this to be worth revisiting. */
  revisitCondition?: string
}

const DOCS_ROOT = 'learnings/stack-documentation/stripe'

/** Every consciously-dropped rule, in drop-decision order. */
export const DROPPED_RULES: DroppedRule[] = [
  // ── verify-gate drops (v0.2 deep mode) ──
  {
    id: 'RADAR_SETUP_INTENTS_NOT_ENABLED',
    category: 'api-gap',
    reason: 'Radar SetupIntent screening is a Dashboard toggle with no API object to read',
    decidedIn: 'v0.2 verify-gate',
    evidence: 'docs/verify-gates/RADAR_SETUP_INTENTS.md',
    revisitCondition: 'Stripe exposes a Radar settings resource on the API',
  },

  // ── webhook / event-delivery drops ──
  {
    id: 'WEBHOOK_NO_SIGNING_SECRET',
    category: 'api-gap',
    reason:
      'The endpoint object carries `secret`, but it is populated only at creation — later reads omit it, so presence cannot be checked',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/webhook_endpoint_object.md`,
    revisitCondition: 'Stripe adds a has_secret / secret_set style presence flag',
  },
  {
    id: 'WEBHOOK_HIGH_FAILURE_RATE',
    category: 'api-gap',
    reason:
      'No delivery metrics exist on any readable object; the v2 destination reports only status_details.disabled.reason, whose enum has no delivery-failure value',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/v2_event_destinations_object.md`,
    revisitCondition: 'a delivery-attempt or failure-rate field appears on the destination object',
  },
  {
    id: 'WEBHOOK_NO_RETRY_EVIDENCE',
    category: 'api-gap',
    reason:
      'Retry and idempotency evidence lives in request logs, which no restricted key can read',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/v2_event_destinations_object.md`,
    revisitCondition: 'Stripe exposes delivery-attempt history through the API',
  },

  // ── billing-settings drops (Dashboard-only surfaces) ──
  {
    id: 'SMART_RETRIES_DISABLED',
    category: 'api-gap',
    reason:
      'The retry schedule is configured only in the Dashboard (Billing > Revenue recovery > Retries); no object exposes it',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/smart-retries.md`,
    revisitCondition: 'retry policy becomes readable on the account or a billing-settings object',
  },
  {
    id: 'SUBSCRIPTION_DEFAULT_INCOMPLETE',
    category: 'api-gap',
    reason:
      'There is no account-level subscription default to audit — the behavior is chosen per subscription at creation',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/subscriptions_object.md`,
  },
  {
    id: 'NO_RECEIPT_EMAIL',
    category: 'api-gap',
    reason:
      'account.settings.invoices exposes only default_account_tax_ids and hosted_payment_method_save — no receipt-email configuration',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/accounts_object.md`,
  },
  {
    id: 'INVOICE_FOOTER_EMPTY',
    category: 'api-gap',
    reason:
      'account.settings.invoices has no footer field; the fields the original spec named do not exist on the object',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/accounts_object.md`,
  },

  // ── API-version drops (the SDK always pins, so the account default is unobservable) ──
  {
    id: 'API_VERSION_OUTDATED',
    category: 'api-gap',
    reason:
      "Starting in v12 stripe-node always sends a Stripe-Version header, so the account's own default version is never observable through this client",
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/stripe-node-sdk.md`,
  },
  {
    id: 'API_VERSION_NOT_PINNED',
    category: 'api-gap',
    reason: 'Whether other integrations pin a version is visible only in request logs',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/stripe-node-sdk.md`,
  },
  {
    id: 'STRIPE_VERSION_ECHO',
    category: 'low-value',
    reason:
      'lastResponse.apiVersion only echoes the version this audit itself pinned, so a check on it can never fail',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/stripe-node-sdk.md`,
  },

  // ── readable, but the rule would not earn its place ──
  {
    id: 'COUPON_FOREVER_ON_ALL_PRICES',
    category: 'low-value',
    reason:
      'Coupon scoping is product-level via applies_to.products (there is no price-level linkage), and FOREVER_COUPON_STILL_VALID already reports that blast radius on every forever coupon',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/coupons_object.md`,
    revisitCondition: 'Stripe adds price-level coupon scoping',
  },
  {
    id: 'CUSTOMER_DEFAULT_CURRENCY_MISSING',
    category: 'low-value',
    reason:
      'account.default_currency is a non-nullable string, so it is always present — the condition the rule would flag cannot occur',
    decidedIn: 'v0.3 re-grounding',
    evidence: `${DOCS_ROOT}/api/accounts_object.md`,
  },

  // ── readable, but outside the regions this audit fetches ──
  {
    id: 'INVOICE_WINDOW_NOT_USED',
    category: 'scope-gated',
    reason:
      'Invoice-level settings are readable, but the audit fetches no invoices region (base: account, webhooks, prices, portal, tax; deep: subscriptions, meters, event destinations, coupons)',
    decidedIn: 'v0.3 re-grounding',
    evidence: 'docs/scopes-reference.md',
    revisitCondition: 'an invoices region is added to the fetcher',
  },
]
