VERDICT: READABLE

# Verify-gate — BILLING_MODE_NOT_MIGRATED

Decided: 2026-07-02.

## Question

Is `subscription.billing_mode` API-readable under a Subscriptions-READ restricted
key at the pinned version (`STRIPE_API_VERSION = 2026-06-24.dahlia`, pinned at
`src/stripe-client.ts:29`, re-exported at `src/index.ts:19`)?

## Verdict: READABLE — billing_mode sits on the readable subscription object

Evidence (Stripe documentation, verified 2026-07-02):

1. The field exists on the subscription object with exactly the enum the rule
   needs:

   > "`billing_mode.type` (enum) — Controls how prorations and invoices for
   > subscriptions are calculated and orchestrated. Possible enum values:
   > `classic` — Calculations for subscriptions and invoices are based on legacy
   > defaults. `flexible` — Supports more flexible calculation and orchestration
   > options for subscriptions and invoices."

   — https://docs.stripe.com/api/subscriptions/object

2. Subscriptions are listable under a restricted read key with the Subscriptions
   read permission (see https://docs.stripe.com/keys/restricted-api-keys), so
   the deep fetcher can aggregate `billing_mode.type` per subscription into
   `subscriptionSummary.byBillingMode`.

## Binding constraint — what the rule keys off

The rule MUST key off the real `billing_mode` field sourced from the deep
subscription fetch. It must NEVER read a phantom snapshot version field — an
earlier draft of the detection logic referenced a snapshot field that does not
exist, and the v1 rule-readability audit removed it along with the stale
version string; neither may appear in rule code, fixtures, or this verdict
(grep-enforced by the test suite).

## DEGRADED fallback (not taken — documented for completeness)

If `billing_mode` were not readable, the only coarse signal is the SDK's
response-header echo:

> "Some information about the response which generated a resource is available
> with the `lastResponse` property: `customer.lastResponse.requestId` …
> `customer.lastResponse.statusCode`"

— stripe-node README (github.com/stripe/stripe-node), with
`lastResponse.apiVersion?: string` verified in-repo at
`node_modules/stripe/cjs/lib.d.ts:168` (stripe-node 22.3.0).

The READABLE verdict makes this branch moot: the rule ships in its
per-subscription form.

## Consequences (machine-enforced)

- `src/rules/billing-mode.ts` reads
  `snapshot.subscriptionSummary.byBillingMode` — fires one medium Finding when
  any `classic` count exists; `[]` when all `flexible` or the summary is null.
- The deep fetcher extends `SubscriptionSummary` with
  `byBillingMode: Record<string, number>` sourced from `subscriptions.list`
  items' `billing_mode.type`.
- A trigger fixture (classic fleet) ships with the rule's test set.
