/**
 * stripe-audit — subscription-health rule cluster (deep tier).
 *
 * Every rule here lints the subscription FLEET rather than any single
 * subscription: they read the bounded `subscriptionSummary` aggregates, never a
 * per-subscription list, so a large fleet stays cheap (same discipline as
 * `billing-mode.ts`). `requires: ['subscriptions']` is a deep region, so every
 * rule derives to deep tier: base-mode runs SKIP them rather than pass them.
 *
 * TRIAL_WITHOUT_PAYMENT_COLLECTION was built per the verify-gate verdict READABLE
 * (`docs/verify-gates/TRIAL_END_BEHAVIOR.md`): the trial payment-collection
 * setting IS readable — `trial_settings.end_behavior.missing_payment_method` is a
 * plain enum on the subscription object the deep fetcher already lists. The rule
 * was previously in `src/rules/dropped.ts` claiming the opposite; the catalog
 * re-grounding pass corrected that verdict against the cached schema reference
 * and promoted it.
 */
import { defineRule } from '../define-rule'
import type { Rule } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/**
 * Trials configured to end WITHOUT raising an invoice when no payment method was
 * provided — the subscription is silently canceled or paused instead, so the
 * revenue is never even attempted.
 */
export const TRIAL_WITHOUT_PAYMENT_COLLECTION: Rule = defineRule({
  id: 'TRIAL_WITHOUT_PAYMENT_COLLECTION',
  name: 'Trials end without collecting payment',
  severity: 'medium',
  category: 'billing',
  requires: ['subscriptions'],
  check: (snapshot) => {
    const summary = snapshot.subscriptionSummary
    // null = region unreadable/denied (deep fetch degraded) — never a finding.
    if (summary === null) return []
    const cancelCount = summary.byTrialEndBehavior['cancel'] ?? 0
    const pauseCount = summary.byTrialEndBehavior['pause'] ?? 0
    const atRisk = cancelCount + pauseCount
    // 'create_invoice' (and an unset trial_settings, which buckets there) raises a
    // collectible invoice — that is the healthy path, so it never fires.
    if (atRisk === 0) return []
    // Named locals rather than inline ternaries: the description template stays
    // readable, and the copy is the user-facing half of the finding.
    const breakdown = [
      cancelCount > 0 ? `${cancelCount} set to 'cancel'` : null,
      pauseCount > 0 ? `${pauseCount} set to 'pause'` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' and ')
    let outcome: string
    if (cancelCount > 0 && pauseCount > 0) {
      outcome = 'cancels or pauses'
    } else if (cancelCount > 0) {
      outcome = 'cancels'
    } else {
      outcome = 'pauses'
    }
    const one = atRisk === 1
    return [
      buildFinding(TRIAL_WITHOUT_PAYMENT_COLLECTION, {
        title: `${atRisk} trialing subscription${one ? '' : 's'} will end without an invoice`,
        description:
          `${atRisk} of ${summary.total} subscriptions ${one ? 'is' : 'are'} trialing with ` +
          `trial_settings.end_behavior.missing_payment_method ${breakdown}. When ${one ? 'that trial ends' : 'those trials end'} ` +
          `with no payment method attached, Stripe ${outcome} the subscription instead of raising an ` +
          `invoice — the conversion is lost silently, with no failed payment, no dunning, and nothing ` +
          `in revenue recovery to retry.`,
        remediation:
          "Set trial_settings.end_behavior.missing_payment_method to 'create_invoice' so the trial ends " +
          'with a collectible invoice and enters dunning, or require a payment method up front (Checkout ' +
          'or a SetupIntent at trial signup) so the trial can convert automatically.',
        docsUrl: DOCS.subscriptions,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/**
 * Subscriptions sitting in `past_due` / `unpaid` — billed, unpaid, and still
 * counted as customers. Reads the `byStatus` aggregate the deep fetcher has
 * always computed, zod-validated, and fixtured while no rule read it: the same
 * fetched-but-unlinted gap that `coupon.amount_off` sat in before
 * HIGH_AMOUNT_COUPON shipped. When hunting for the next one, grep the snapshot
 * schema for fields with no rule reader.
 */
export const SUBSCRIPTIONS_PAST_DUE_ACCUMULATING: Rule = defineRule({
  id: 'SUBSCRIPTIONS_PAST_DUE_ACCUMULATING',
  name: 'Subscriptions accumulating in past_due or unpaid',
  severity: 'low',
  category: 'billing',
  requires: ['subscriptions'],
  check: (snapshot) => {
    const summary = snapshot.subscriptionSummary
    // null = region unreadable/denied (deep fetch degraded) — never a finding.
    if (summary === null) return []
    const pastDue = summary.byStatus['past_due'] ?? 0
    const unpaid = summary.byStatus['unpaid'] ?? 0
    const stuck = pastDue + unpaid
    if (stuck === 0) return []
    const breakdown = [
      pastDue > 0 ? `${pastDue} past_due` : null,
      unpaid > 0 ? `${unpaid} unpaid` : null,
    ]
      .filter((part): part is string => part !== null)
      .join(' and ')
    return [
      buildFinding(SUBSCRIPTIONS_PAST_DUE_ACCUMULATING, {
        title: `${stuck} subscription${stuck === 1 ? '' : 's'} ${stuck === 1 ? 'is' : 'are'} past_due or unpaid`,
        // DELIBERATELY ADVISORY: past_due/unpaid is an operational STATE, not proof
        // of a misconfiguration — a healthy account running dunning always carries
        // some. The audit also cannot check whether retries are configured, because
        // the retry policy is Dashboard-only and therefore unreadable (see
        // SMART_RETRIES_DISABLED in src/rules/dropped.ts). So the finding reports the
        // exposure and points at the setting to verify; it never asserts a fault.
        description:
          `${breakdown} of ${summary.total} subscriptions are in a failed-payment state. Stripe moves a ` +
          `subscription to past_due when a payment is required but cannot be collected, then — once the ` +
          `retry attempts are exhausted — to canceled or unpaid depending on your subscription ` +
          `settings. An unpaid subscription stops attempting invoices entirely, so its balance is ` +
          `revenue already earned and no longer being collected. This is a state, not proof of a ` +
          `misconfiguration: some past_due is normal while dunning runs. The retry policy itself is ` +
          `Dashboard-only and not readable by this audit, so verify it rather than assume it is wired.`,
        remediation:
          'Check Billing > Revenue recovery > Retries in the Dashboard: confirm Smart Retries (or a ' +
          'custom schedule) is enabled, that failed-payment emails are on, and that the end-of-retry ' +
          'behavior (cancel / mark unpaid / leave past_due) matches your intent. Enable the customer ' +
          'portal payment-method update so customers can self-serve a fix.',
        docsUrl: DOCS.revenueRecovery,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/**
 * Subscriptions with payment collection paused — active on paper, billing
 * nothing. Uniquely invisible: Stripe leaves `status` unchanged while collection
 * is paused, so neither `byStatus` nor a Dashboard status filter can reveal it
 * (docs/verify-gates/PAUSE_COLLECTION.md).
 */
export const SUBSCRIPTION_COLLECTION_PAUSED: Rule = defineRule({
  id: 'SUBSCRIPTION_COLLECTION_PAUSED',
  name: 'Subscriptions with payment collection paused',
  severity: 'medium',
  category: 'billing',
  requires: ['subscriptions'],
  check: (snapshot) => {
    const summary = snapshot.subscriptionSummary
    // null = region unreadable/denied (deep fetch degraded) — never a finding.
    if (summary === null) return []
    const paused = summary.pausedCollectionCount
    if (paused === 0) return []
    // Named local rather than repeating the comparison inline — same idiom as
    // TRIAL_WITHOUT_PAYMENT_COLLECTION above.
    const one = paused === 1
    return [
      buildFinding(SUBSCRIPTION_COLLECTION_PAUSED, {
        title: `${paused} subscription${one ? '' : 's'} ${one ? 'has' : 'have'} payment collection paused`,
        description:
          `${paused} of ${summary.total} subscriptions ${one ? 'carries' : 'carry'} pause_collection, so ` +
          `Stripe is not collecting payment on ${one ? 'it' : 'them'} — while the subscription status stays ` +
          `unchanged (Stripe does not move a paused subscription to 'paused'). That makes this the one ` +
          `revenue gap no status filter can show you: the subscription still reads active in the ` +
          `Dashboard and in this audit's own status counts. A pause with no resumes_at date lasts until ` +
          `someone unsets it by hand, so a forgotten pause is indefinite, silent non-billing.`,
        remediation:
          'Review each paused subscription: confirm the pause is still intentional and that it has a ' +
          'resumes_at date rather than running open-ended. Resume collection by updating the ' +
          'subscription with pause_collection unset.',
        docsUrl: DOCS.subscriptions,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** The subscription-health cluster (deep tier — skipped in base mode). */
export const subscriptionRules: Rule[] = [
  TRIAL_WITHOUT_PAYMENT_COLLECTION,
  SUBSCRIPTIONS_PAST_DUE_ACCUMULATING,
  SUBSCRIPTION_COLLECTION_PAUSED,
]
