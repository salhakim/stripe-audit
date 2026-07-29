VERDICT: READABLE

# Verify-gate — SUBSCRIPTION_COLLECTION_PAUSED

Decided: 2026-07-29.

## Question

Is `subscription.pause_collection` API-readable under a Subscriptions-READ
restricted key at the pinned version (`STRIPE_API_VERSION = 2026-06-24.dahlia`,
pinned at `src/stripe-client.ts:29`, re-exported at `src/index.ts:19`) — and is
the signal it carries reachable any other way?

## Verdict: READABLE — and reachable NO other way

Evidence (cached Stripe documentation + the pinned SDK declarations):

1. The field is a nullable object on the subscription the deep fetcher already
   lists, and the SDK states plainly that the status does not move:

   > "If specified, payment collection for this subscription will be paused.
   > **Note that the subscription status will be unchanged and will not be
   > updated to `paused`.**"
   > `pause_collection: Subscription.PauseCollection | null;`

   — `node_modules/stripe/cjs/resources/Subscriptions.d.ts:221-223` (stripe 22.3.0)

2. Its shape is a plain object — no expansion, no second request:

   > `interface PauseCollection { behavior: PauseCollection.Behavior; resumes_at: number | null }`

   — `node_modules/stripe/cjs/resources/Subscriptions.d.ts:399-408`

3. The documentation confirms the same invisibility from the product side, for
   each of the three pause behaviors:

   > "you can void invoices that your subscription creates to make sure that your
   > customers aren't charged and **the subscription remains `status=active`**"
   > "All invoices created before the `resumes_at` date remain in `draft` status
   > and `auto_advance` is set to `false`. … **the subscription's status remains
   > unchanged**."

   — [`learnings/stack-documentation/stripe/subscription-pause-payment.md:41,63,79`](../../learnings/stack-documentation/stripe/subscription-pause-payment.md)

4. And that a pause without an end date is open-ended:

   > "If you don't set a `resumes_at` date, the subscription remains paused until
   > you unset `pause_collection`."

   — [`learnings/stack-documentation/stripe/subscription-pause-payment.md:51,65,91`](../../learnings/stack-documentation/stripe/subscription-pause-payment.md)

5. No new key scope is required: the deep fetcher already lists subscriptions
   under the existing `subscriptions` deep region.

## Why this rule earns its place

Most audit findings restate something an operator could also have found with a
Dashboard filter. This one cannot be found that way. Because Stripe leaves
`status` untouched, a subscription with collection paused is indistinguishable
from a healthy one in every status-derived view — including this audit's own
`byStatus` aggregate. Combined with evidence 4, a pause someone set during a
support conversation and never revisited is indefinite, silent non-billing, and
nothing surfaces it.

## Binding constraint — what the rule keys off

- The rule reads **only** `subscriptionSummary.pausedCollectionCount`. It must
  never be re-expressed as a `byStatus` lookup — no status value corresponds to
  it, so such a check would always read zero and pass vacuously.
- The aggregate is a bounded count, not a subscription list: the finding is
  account-level and fleets are unbounded.
- Presence of the object is the signal. `behavior` and `resumes_at` are read for
  neither counting nor findings today — see "Deferred" below.

## Deferred (recorded, not built)

`resumes_at: null` marks a pause with no scheduled end — strictly sharper than
presence alone, and available at zero extra fetch cost. It is deliberately NOT
built here: the approved plan for this mission specifies a single
`pausedCollectionCount` aggregate, and widening the projection is a maintainer
decision rather than an implementation detail. A future mission that wants it
adds a second bounded count (e.g. `pausedIndefinitelyCount`) next to this one.

## Consequences (machine-enforced)

- `src/rules/subscriptions.ts` fires one medium `billing` Finding when
  `pausedCollectionCount > 0`; `[]` when it is 0 or the summary is null (region
  denied / base mode).
- The deep fetcher extends `SubscriptionSummary` with
  `pausedCollectionCount: number` — REQUIRED in both `src/types.ts` and its
  `src/snapshot-schema.ts` mirror, so a fetcher that stopped populating it fails
  validation instead of silently disabling the rule.
- A trigger fixture
  (`test/fixtures/snapshots/subscription-collection-paused@2026-06-24.dahlia.json`)
  ships with the rule, and a unit test asserts the fleet it fires on has **no**
  non-active status — pinning the "invisible to byStatus" property itself.
