VERDICT: READABLE

# Verify-gate — TRIAL_WITHOUT_PAYMENT_COLLECTION

Decided: 2026-07-29. **Overturns a prior DROPPED verdict** — see "What changed".

## Question

Is the trial payment-collection setting
(`subscription.trial_settings.end_behavior.missing_payment_method`) API-readable
under a Subscriptions-READ restricted key at the pinned version
(`STRIPE_API_VERSION = 2026-06-24.dahlia`, pinned at `src/stripe-client.ts:29`,
re-exported at `src/index.ts:19`)?

## Verdict: READABLE — it is a plain enum on the subscription object

Evidence (cached Stripe documentation + the pinned SDK declarations):

1. The field exists on the subscription object with exactly the enum the rule
   needs:

   > "`trial_settings` (object, nullable) — Settings related to subscription
   > trials. … `trial_settings.end_behavior.missing_payment_method` (enum)
   > Indicates how the subscription should change when the trial ends if the user
   > did not provide a payment method." — enum values `cancel`, `create_invoice`,
   > `pause`

   — [`learnings/stack-documentation/stripe/api/subscriptions_object.md:1926-1932`](../../learnings/stack-documentation/stripe/api/subscriptions_object.md)

2. The pinned SDK types it as a first-class (nullable) property of the
   subscription — no expansion, no separate request:

   > `trial_settings: Subscription.TrialSettings | null;`
   > `interface EndBehavior { missing_payment_method: EndBehavior.MissingPaymentMethod }`
   > `type MissingPaymentMethod = 'cancel' | 'create_invoice' | 'pause';`

   — `node_modules/stripe/cjs/resources/Subscriptions.d.ts:278,484-489,851-861`
   (stripe 22.3.0)

3. No new key scope is required. The deep fetcher **already** lists subscriptions
   under the existing `subscriptions` deep region (`src/fetcher.ts`, the
   `probeListRegion<Stripe.Subscription>('subscriptions', …)` call), so the
   aggregate is derived from a read the audit was already performing.

4. What the setting means when a trial ends with no payment method is documented
   behavior, not inference:

   > "The subscription moves to the `canceled` status … after a free trial ends
   > without a payment method, and if the subscription's
   > `missing_payment_method` end behavior is set to `cancel`."
   > "The subscription moves to the `paused` status … The subscription remains
   > `paused` until explicitly resumed."

   — [`learnings/stack-documentation/stripe/subscription-trials.md:368,370`](../../learnings/stack-documentation/stripe/subscription-trials.md)

## What changed — why this overturns the prior drop

`src/rules/dropped.ts` carried this rule with the reason *"The trial
payment-collection setting is not readable via the API"*, sourced from the v1
readability audit (2026-06-28). The shipped CLI printed that reason to users
through `--list-rules`. Re-grounding the claim against the cached schema
reference (evidence 1) showed it is false: the setting is a readable enum, and
the subscription list that carries it was already being fetched. The rule is
therefore **promoted to the active catalog**, and the false reason is removed
from the dropped registry rather than reworded.

The lesson this gate records: a "not readable" verdict must cite the schema page
for the exact field, not a summary of a neighbouring capability. A drop reason
that ships to users is a user-facing claim and carries the same evidence burden
as a finding.

## Binding constraint — what the rule keys off

- The rule reads **only** `subscriptionSummary.byTrialEndBehavior`, the bounded
  aggregate. It must never read a per-subscription list: fleets are unbounded and
  the finding is account-level.
- The aggregate counts **trialing subscriptions only**. A non-trialing
  subscription may still carry `trial_settings` from a past trial; counting it
  would report risk that cannot occur.
- A trialing subscription whose `trial_settings` is `null` is bucketed as
  `create_invoice` — the non-at-risk behavior — so an unset setting can never
  manufacture a finding. Only an explicit `cancel` or `pause` fires.

## Consequences (machine-enforced)

- `src/rules/subscriptions.ts` fires one medium `billing` Finding when
  `byTrialEndBehavior.cancel + byTrialEndBehavior.pause > 0`; `[]` when the
  summary is null (region denied / base mode) or every trial ends with an invoice.
- The deep fetcher extends `SubscriptionSummary` with
  `byTrialEndBehavior: Record<string, number>` — a REQUIRED field in both
  `src/types.ts` and its `src/snapshot-schema.ts` mirror, so a fetcher that
  silently stopped populating it fails validation instead of silently disabling
  the rule.
- A trigger fixture
  (`test/fixtures/snapshots/trial-missing-payment-method@2026-06-24.dahlia.json`)
  ships with the rule, and `TRIAL_WITHOUT_PAYMENT_COLLECTION` is removed from the
  `DROPPED_IDS` guard in `test/integration/catalog-invariants.test.ts`.
