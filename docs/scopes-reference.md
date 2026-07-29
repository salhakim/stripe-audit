# stripe-audit — restricted-key scopes reference

For the skeptical (rightly so — you're handing a tool a key to your billing
account): this page enumerates **every permission stripe-audit ever asks for,
which rules need it, and what is never requested**. The CLI is read-only by
construction — it contains no Stripe write calls (enforced by a guard test) —
and the key model is least-privilege: one purpose, read-only, nothing broad.

Source of truth in code: `RESTRICTED_KEY_READ_SCOPES` + `DEEP_SCOPE_PARAMS` in
[`src/deep-link.ts`](../src/deep-link.ts), and each rule's `requires` in
[`src/rules/`](../src/rules/). This page mirrors those constants; the
`--list-rules` output and `docs/rules.md` are kept in lockstep with the registry.

## Base scopes (every audit) — grant Read, everything else None

Create the key at https://dashboard.stripe.com/apikeys (there is deliberately
no query-string prefill — Stripe documents no such contract, so the CLI links
the stable page and tells you exactly what to click).

| Dashboard permission (Read) | Snapshot region | Consumed by |
|---|---|---|
| Account | `account` | TEST/LIVE key-mode rules, ACCOUNT_CHARGES_DISABLED, ACCOUNT_REQUIREMENTS_DUE, RESTRICTED_KEY_PERMISSION_PROBE, branding/statement/tax-id configuration rules |
| Webhook Endpoints | `webhook_endpoints` | all `WEBHOOK_*` rules |
| Products | `prices` (products expand inline) | pricing rules reading `product` |
| Prices | `prices` | all price rules (PRICE_*, ALL_PRICES_INACTIVE, CROSS_CURRENCY_PRICES, …) |
| Customer Portal | `billing_portal` | all `PORTAL_*` rules + NO_CUSTOMER_PORTAL |
| Tax | `tax` | TAX_NOT_ENABLED, TAX_SETTINGS_PENDING, DEFAULT_TAX_BEHAVIOR_UNSET |

## Deep scopes (`--deep` only) — added on top of the base 6

> **Naming caveat (provisional).** Stripe's docs don't enumerate the key
> builder's exact permission labels, so the names below are our best documented
> mapping, kept in ONE map (`DEEP_SCOPE_PARAMS`) so a correction is a one-line
> edit. If a label in your dashboard differs slightly, grant Read on the
> matching resource.

| Dashboard permission (Read) | Snapshot region | Consumed by |
|---|---|---|
| Subscriptions | `subscriptions` (aggregate counts only — no per-customer data retained) | BILLING_MODE_NOT_MIGRATED, TRIAL_WITHOUT_PAYMENT_COLLECTION, SUBSCRIPTIONS_PAST_DUE_ACCUMULATING, SUBSCRIPTION_COLLECTION_PAUSED |
| Billing Meters | `meters` | METER_ERROR_NOT_MONITORED |
| Event Destinations | `event_destinations` | METER_ERROR_NOT_MONITORED |
| Coupons | `coupons` | HIGH_PERCENT_COUPON, HIGH_AMOUNT_COUPON, FOREVER_COUPON_STILL_VALID |

A `--deep` run with a base-6 key does not error: each ungranted deep region
degrades to null, the affected rules land in the report's **skipped** section
(`deep-scope-not-granted`), and the CLI prints exactly which permissions to add.

## Never requested — in any mode

- **Radar** — the radar rule was consciously dropped: its toggle is
  Dashboard-only, unreadable via any restricted key
  (`docs/verify-gates/RADAR_SETUP_INTENTS.md`). stripe-audit never asks for a
  Radar permission it cannot use (least privilege).
- **Customers, Charges, PaymentIntents, Balance, Payouts** — no rule reads them.
- **Any write permission whatsoever** — the tool issues only list/retrieve
  calls; a guard test fails the build if a write method appears in the fetcher.

## Related

- Rule catalog with per-rule scope column: `npx stripe-audit --list-rules`
  (includes the DROPPED section) and [`docs/rules.md`](rules.md).
- Verify-gate verdicts (why each deep rule exists or was dropped):
  [`docs/verify-gates/`](verify-gates/).
