VERDICT: DROPPED

# Verify-gate — RADAR_SETUP_INTENTS_NOT_ENABLED

Decided: 2026-07-02. Revisit only if Stripe ships an
API-readable Radar settings object.

## Question

Is the "Use Radar on payment methods saved for future use" (SetupIntent screening)
toggle API-readable under a restricted READ-ONLY key (`rk_`)?

## Verdict: DROPPED — the toggle is Dashboard-only

Evidence (Stripe documentation, verified 2026-07-02):

1. The support article places the toggle in the Dashboard, with no API alternative:

   > "To enable Radar for SetupIntents, go to the Radar settings in your Dashboard
   > and toggle **Use Radar on payment methods saved for future use**"

   — https://support.stripe.com/questions/radar-for-setup-intents

2. No Radar-settings API object exists. A live probe of
   `docs.stripe.com/api/radar/settings/object.md` returned Page-not-found
   (verified 2026-07-02). The documented Radar API surface (early fraud
   warnings, value lists, reviews) carries no account-level screening toggle —
   every Radar settings route points at a Dashboard page
   (`dashboard.stripe.com/settings/radar/risk-controls`); no API object is
   named anywhere in the Radar reference.

3. The full account schema (159KB) contains zero radar fields — the
   toggle does not surface on any readable account/settings object either.

Precedent: `SMART_RETRIES_DISABLED` was dropped in the v1 rule-readability
audit for the same Dashboard-only failure mode.

## Consequences (machine-enforced)

- `src/rules/radar-setup-intents.ts` must NOT exist — a repo test asserts the
  file's absence.
- `RADAR_SETUP_INTENTS_NOT_ENABLED` is recorded in `src/rules/dropped.ts`
  (`DROPPED_RULES`) with reason "Radar SetupIntent screening is Dashboard-only /
  unreadable via restricted key" (grep-enforced by the test suite).
- The deep fetcher issues NO radar read: `snapshot.radarSettings` stays
  `null`, and radar gets NO `scopeProbe` entry — never-attempted ≠ denied.
- The dormant `RadarSettings` seam (`src/types.ts`) stays in place; removing it
  was out of scope for the additive release that decided this gate.
- No radar fixture ships — a repo test enforces no leaked expectations.
