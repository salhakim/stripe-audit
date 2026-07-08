VERDICT: DEEP-SCOPE

# Verify-gate — coupon-cluster scope decision

Decided: 2026-07-02. Routes the deferred coupon cluster
(HIGH_PERCENT_COUPON, FOREVER_COUPON_STILL_VALID).

## Question

Do coupon reads work under one of the base-6 scopes (stay in base mode), need
their own 7th+ restricted-key permission (move to deep mode), or fail entirely
(drop the cluster)?

## Verdict: DEEP-SCOPE — coupons need their own restricted-key permission

Evidence (Stripe documentation, verified 2026-07-02):

1. The Coupon is its own first-class API resource, not a sub-object of any
   base-6 region:

   > "The Coupon object"

   — https://docs.stripe.com/api/coupons/object
   (fields: `percent_off`, `amount_off`, `duration`, `valid`, `name` — exactly
   what the two cluster rules read)

2. The restricted-key model grants per-resource permissions and fails closed on
   a missing one:

   > "If a restricted API key doesn't have the correct permissions to complete
   > an API request, Stripe returns an invalid request error."

   — https://docs.stripe.com/keys/restricted-api-keys

3. Coupons are not among the base-6 read scopes the CLI provisions (Account,
   Webhook Endpoints, Products, Prices, Customer Portal, Tax —
   `src/deep-link.ts:24-31`). A coupon read therefore needs a 7th+ permission →
   the cluster moves to deep mode.

The exact Dashboard permission NAME for coupon read carries a PROVISIONAL
caveat: unverified against the live restricted-key builder; the name lives in
one named map so a correction is one line.

## Consequences (machine-enforced)

- `RuleScope` gains `'coupons'` (the 5th deep region), the snapshot gains a
  nullable `coupons` field + zod schema, and the engine's `DEEP_SCOPES` set
  grows — shipped WITH this verdict.
- The deep fetcher adds `coupons.list()` under the shared
  `Promise.allSettled` (grep-enforced by the test suite).
- `src/rules/coupons.ts` ships HIGH_PERCENT_COUPON +
  FOREVER_COUPON_STILL_VALID with `requires: ['coupons']`
  (grep-enforced by the test suite).
- `COUPON_FOREVER_ON_ALL_PRICES` stays a permanent non-goal in every branch —
  no coupon→price linkage exists in Stripe's model (established by the v1
  rule-readability audit; a repo test enforces the non-goal).
- A coupons deep fixture ships with the rule's test set.
