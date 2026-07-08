/**
 * stripe-audit — the DROPPED-rule registry.
 *
 * Every rule the project consciously decided NOT to build, with the reason and the
 * evidence trail. A rule lands here when its readability verify-gate
 * (`docs/verify-gates/<NAME>.md`) or the v1 readability audit proved its data is not
 * API-readable under a restricted read-only key. `--list-rules` renders this registry
 * so "why is rule X missing?" always has a citable answer.
 *
 * Data-only: nothing here registers in `ALL_RULES` or reaches the engine.
 */

/** A consciously-dropped rule: the id that will never ship, and why. */
export interface DroppedRule {
  /** The rule id as originally specced (UPPER_SNAKE; never registered). */
  id: string
  /** One-line reason the rule cannot be built with a restricted read-only key. */
  reason: string
  /** Where the drop was decided (verify-gate decision id or audit doc). */
  decidedIn: string
  /** Evidence pointer: verdict file, audit doc, or cached stack-doc path. */
  evidence: string
}

const V1_AUDIT = 'COVERAGE.md § DROPPED (v1 readability audit, 2026-06-28)'

/** Every consciously-dropped rule, in drop-decision order. */
export const DROPPED_RULES: DroppedRule[] = [
  // ── verify-gate drops (v0.2 deep mode) ──
  {
    id: 'RADAR_SETUP_INTENTS_NOT_ENABLED',
    reason: 'Radar SetupIntent screening is Dashboard-only / unreadable via restricted key',
    decidedIn: 'v0.2 verify-gate',
    evidence: 'docs/verify-gates/RADAR_SETUP_INTENTS.md',
  },

  // ── v1 readability-audit drops (read=no; earlier catalog history) ──
  {
    id: 'WEBHOOK_NO_SIGNING_SECRET',
    reason: 'Signing secret is only returned at endpoint creation; the API exposes no presence flag',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'WEBHOOK_HIGH_FAILURE_RATE',
    reason: 'No delivery metrics in the API (Workbench only); failure-rate fields were phantom',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'WEBHOOK_NO_RETRY_EVIDENCE',
    reason: 'Restricted keys cannot read request logs, so retry/idempotency evidence is unreachable',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'SMART_RETRIES_DISABLED',
    reason: 'Smart Retries is Dashboard-only; the subscriptionSettings object was a phantom fetch',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'TRIAL_WITHOUT_PAYMENT_COLLECTION',
    reason: 'The trial payment-collection setting is not readable via the API',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'SUBSCRIPTION_DEFAULT_INCOMPLETE',
    reason: 'Not an account-level setting; there is no readable default to audit',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'COUPON_FOREVER_ON_ALL_PRICES',
    reason: 'No coupon-to-price linkage exists in Stripe’s model (permanent non-goal in every branch)',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'API_VERSION_OUTDATED',
    reason:
      'Account default API version is not directly readable; re-scoped to the lastResponse.apiVersion echo signal instead of built as specced',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'API_VERSION_NOT_PINNED',
    reason: 'Pinning evidence lives in request logs, which restricted keys cannot read',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'NO_RECEIPT_EMAIL',
    reason: 'No API field exposes receipt-email configuration',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
  {
    id: 'INVOICE_FOOTER_EMPTY',
    reason: 'The referenced Account invoice-footer fields do not exist (phantom fields)',
    decidedIn: 'v1 readability audit',
    evidence: V1_AUDIT,
  },
]
