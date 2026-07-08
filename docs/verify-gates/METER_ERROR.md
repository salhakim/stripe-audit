VERDICT: READABLE

# Verify-gate — METER_ERROR_NOT_MONITORED

Decided: 2026-07-02.

## Question

Are BOTH data regions the rule needs API-readable under a restricted read-only
key: (1) billing meters (`billing.meters.list` — id / event_name / status) and
(2) v2 event destinations (enabled_events + status, to detect a listener for
`v1.billing.meter.error_report_triggered`)?

## Verdict: READABLE — both regions are documented readable schemas

Evidence (Stripe documentation, verified 2026-07-02):

### Region 1 — Billing meters

> "`event_name` (string) — The name of the meter event to record usage for.
> Corresponds with the `event_name` field on meter events."

— https://docs.stripe.com/api/billing/meter/object

> "`status` (enum) — The meter's status. Possible enum values: `active` …"

— https://docs.stripe.com/api/billing/meter/object

The LIST endpoint was verified against its own schema page (per-endpoint
cross-check, not just the object overview):
https://docs.stripe.com/api/billing/meter/list
(SDK surface `stripe.billing.meters.list`, in-repo
`node_modules/stripe/cjs/resources/Billing/Meters.d.ts`).

### Region 2 — v2 event destinations

> "`enabled_events` (array of strings) — The list of events to enable for this
> endpoint."

— https://docs.stripe.com/api/v2/core/event-destinations/object

> "`status` (enum) — Status. It can be set to either enabled or disabled."

— https://docs.stripe.com/api/v2/core/event-destinations/object

LIST endpoint verified per-endpoint:
https://docs.stripe.com/api/v2/core/event-destinations/list
(SDK surface `stripe.v2.core.eventDestinations.list`, in-repo
`node_modules/stripe/cjs/resources/V2/Core/EventDestinations.d.ts:10`).

### The thin event the rule listens for is a documented type

> "`v1.billing.meter.error_report_triggered`"

— https://docs.stripe.com/api/v2/core/events/event-types

## Consequences (machine-enforced)

- `src/rules/meter-error.ts`: `[]` when `snapshot.meters` is null
  or no meter has `status === 'active'`; with active meters, fires ONE high
  Finding unless some enabled destination (`status === 'enabled'`) has
  `enabledEvents` including `'*'` or `'v1.billing.meter.error_report_triggered'`.
- The deep fetcher wires both regions (`billing.meters.list` +
  `stripe.v2.core.eventDestinations.list`) under the shared `Promise.allSettled`;
  the v2 error shape is covered by the centralized `isPermissionDenied()`
  predicate, pinned by unit test.
- A trigger fixture (active meter, no listener) ships with the rule's test set.
