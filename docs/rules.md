# stripe-audit rule catalog

Every rule stripe-audit ships, grouped by category. Each entry follows the same
shape as a good linter: **What** the rule detects, **Why** it costs you money or
risk, and how to **fix** it — plus a link to the relevant Stripe documentation.

**Scope.** Each rule is either `base` or `deep`:

- **base** — reads only the six default read regions (account, webhook endpoints,
  products, prices, customer portal, tax settings) and runs on every audit.
- **deep** — reads subscriptions, meters, event destinations, or coupons and runs
  only under `npx stripe-audit --deep`. (Radar is never read — see the Dropped
  rules section.)

The base catalog runs on every audit; `deep` rules (introduced in v0.2, starting
with `BILLING_MODE_NOT_MIGRATED`) run only under `--deep` and are otherwise
listed in the report's skipped section. This catalog is kept in lockstep with the
shipped registry — the exact list below is the output of
`npx stripe-audit --list-rules`:

```text
ID                                   SCOPE  CATEGORY       SEVERITY
WEBHOOK_SELECT_ALL                   base   webhooks       critical
WEBHOOK_ENDPOINT_DISABLED            base   webhooks       high
WEBHOOK_TOO_MANY_ENDPOINTS           base   webhooks       medium
WEBHOOK_DUPLICATE_URL                base   webhooks       medium
WEBHOOK_INSECURE_URL                 base   webhooks       high
WEBHOOK_SELECTION_REQUIRED_MISSED    base   webhooks       high
WEBHOOK_TEST_ENDPOINT_IN_LIVE        base   webhooks       high
WEBHOOK_API_VERSION_MISMATCH         base   webhooks       medium
NO_CUSTOMER_PORTAL                   base   billing        high
PORTAL_PAYMENT_UPDATE_DISABLED       base   billing        high
PORTAL_NO_CANCEL_FLOW                base   billing        medium
PORTAL_NO_INVOICE_HISTORY            base   billing        medium
PORTAL_NO_CUSTOMER_UPDATE            base   billing        medium
PORTAL_LOGIN_PAGE_DISABLED           base   billing        low
PORTAL_PRORATION_NONE_ON_UPDATE      base   billing        medium
PRICE_NO_LOOKUP_KEY                  base   pricing        low
ALL_PRICES_INACTIVE                  base   pricing        high
PRICE_ZERO_AMOUNT                    base   pricing        medium
DEFAULT_PRICE_MISSING_OR_INACTIVE    base   pricing        medium
MULTIPLE_ACTIVE_PRICES_PER_PRODUCT   base   pricing        low
PRICE_TAX_BEHAVIOR_UNSPECIFIED       base   pricing        medium
CUSTOM_UNIT_AMOUNT_NO_MINIMUM        base   pricing        medium
CROSS_CURRENCY_PRICES                base   pricing        low
TAX_NOT_ENABLED                      base   configuration  high
DEFAULT_TAX_BEHAVIOR_UNSET           base   configuration  medium
TAX_SETTINGS_PENDING                 base   configuration  medium
UNBRANDED_RECEIPTS                   base   configuration  low
DEFAULT_ACCOUNT_TAX_IDS_MISSING      base   configuration  low
STATEMENT_DESCRIPTOR_MISSING         base   configuration  medium
EVENT_DESTINATIONS_NOT_AUDITED       base   configuration  info
TEST_KEY_DETECTED_LIVE               base   security       critical
LIVE_KEY_DETECTED_TEST               base   security       high
RESTRICTED_KEY_PERMISSION_PROBE      base   security       info
ACCOUNT_CHARGES_DISABLED             base   security       high
ACCOUNT_REQUIREMENTS_DUE             base   security       high
BILLING_MODE_NOT_MIGRATED            deep   billing        medium
TRIAL_WITHOUT_PAYMENT_COLLECTION     deep   billing        medium
SUBSCRIPTIONS_PAST_DUE_ACCUMULATING  deep   billing        low
SUBSCRIPTION_COLLECTION_PAUSED       deep   billing        medium
METER_ERROR_NOT_MONITORED            deep   billing        high
HIGH_PERCENT_COUPON                  deep   pricing        medium
HIGH_AMOUNT_COUPON                   deep   pricing        medium
FOREVER_COUPON_STILL_VALID           deep   pricing        medium

DROPPED (consciously not built — evidence in the repo per entry)
RADAR_SETUP_INTENTS_NOT_ENABLED      api-gap      Radar SetupIntent screening is a Dashboard toggle with no API object to read
WEBHOOK_NO_SIGNING_SECRET            api-gap      The endpoint object carries `secret`, but it is populated only at creation — later reads omit it, so presence cannot be checked
WEBHOOK_HIGH_FAILURE_RATE            api-gap      No delivery metrics exist on any readable object; the v2 destination reports only status_details.disabled.reason, whose enum has no delivery-failure value
WEBHOOK_NO_RETRY_EVIDENCE            api-gap      Retry and idempotency evidence lives in request logs, which no restricted key can read
SMART_RETRIES_DISABLED               api-gap      The retry schedule is configured only in the Dashboard (Billing > Revenue recovery > Retries); no object exposes it
SUBSCRIPTION_DEFAULT_INCOMPLETE      api-gap      There is no account-level subscription default to audit — the behavior is chosen per subscription at creation
NO_RECEIPT_EMAIL                     api-gap      account.settings.invoices exposes only default_account_tax_ids and hosted_payment_method_save — no receipt-email configuration
INVOICE_FOOTER_EMPTY                 api-gap      account.settings.invoices has no footer field; the fields the original spec named do not exist on the object
API_VERSION_OUTDATED                 api-gap      Starting in v12 stripe-node always sends a Stripe-Version header, so the account's own default version is never observable through this client
API_VERSION_NOT_PINNED               api-gap      Whether other integrations pin a version is visible only in request logs
STRIPE_VERSION_ECHO                  low-value    lastResponse.apiVersion only echoes the version this audit itself pinned, so a check on it can never fail
COUPON_FOREVER_ON_ALL_PRICES         low-value    Coupon scoping is product-level via applies_to.products (there is no price-level linkage), and FOREVER_COUPON_STILL_VALID already reports that blast radius on every forever coupon
CUSTOMER_DEFAULT_CURRENCY_MISSING    low-value    account.default_currency is a non-nullable string, so it is always present — the condition the rule would flag cannot occur
INVOICE_WINDOW_NOT_USED              scope-gated  Invoice-level settings are readable, but the audit fetches no invoices region (base: account, webhooks, prices, portal, tax; deep: subscriptions, meters, event destinations, coupons)
```

## Contents

- [Webhooks](#webhooks)
- [Billing & customer portal](#billing--customer-portal)
- [Pricing](#pricing)
- [Tax & account configuration](#tax--account-configuration)
- [Security & account health](#security--account-health)

## Rules at a glance

| Rule | Scope | Category | Severity |
|---|---|---|---|
| `WEBHOOK_SELECT_ALL` | base | webhooks | critical |
| `WEBHOOK_ENDPOINT_DISABLED` | base | webhooks | high |
| `WEBHOOK_TOO_MANY_ENDPOINTS` | base | webhooks | medium |
| `WEBHOOK_DUPLICATE_URL` | base | webhooks | medium |
| `WEBHOOK_INSECURE_URL` | base | webhooks | high |
| `WEBHOOK_SELECTION_REQUIRED_MISSED` | base | webhooks | high |
| `WEBHOOK_TEST_ENDPOINT_IN_LIVE` | base | webhooks | high |
| `WEBHOOK_API_VERSION_MISMATCH` | base | webhooks | medium |
| `NO_CUSTOMER_PORTAL` | base | billing | high |
| `PORTAL_PAYMENT_UPDATE_DISABLED` | base | billing | high |
| `PORTAL_NO_CANCEL_FLOW` | base | billing | medium |
| `PORTAL_NO_INVOICE_HISTORY` | base | billing | medium |
| `PORTAL_NO_CUSTOMER_UPDATE` | base | billing | medium |
| `PORTAL_LOGIN_PAGE_DISABLED` | base | billing | low |
| `PORTAL_PRORATION_NONE_ON_UPDATE` | base | billing | medium |
| `PRICE_NO_LOOKUP_KEY` | base | pricing | low |
| `ALL_PRICES_INACTIVE` | base | pricing | high |
| `PRICE_ZERO_AMOUNT` | base | pricing | medium |
| `DEFAULT_PRICE_MISSING_OR_INACTIVE` | base | pricing | medium |
| `MULTIPLE_ACTIVE_PRICES_PER_PRODUCT` | base | pricing | low |
| `PRICE_TAX_BEHAVIOR_UNSPECIFIED` | base | pricing | medium |
| `CUSTOM_UNIT_AMOUNT_NO_MINIMUM` | base | pricing | medium |
| `CROSS_CURRENCY_PRICES` | base | pricing | low |
| `TAX_NOT_ENABLED` | base | configuration | high |
| `DEFAULT_TAX_BEHAVIOR_UNSET` | base | configuration | medium |
| `TAX_SETTINGS_PENDING` | base | configuration | medium |
| `UNBRANDED_RECEIPTS` | base | configuration | low |
| `DEFAULT_ACCOUNT_TAX_IDS_MISSING` | base | configuration | low |
| `STATEMENT_DESCRIPTOR_MISSING` | base | configuration | medium |
| `EVENT_DESTINATIONS_NOT_AUDITED` | base | configuration | info |
| `TEST_KEY_DETECTED_LIVE` | base | security | critical |
| `LIVE_KEY_DETECTED_TEST` | base | security | high |
| `RESTRICTED_KEY_PERMISSION_PROBE` | base | security | info |
| `ACCOUNT_CHARGES_DISABLED` | base | security | high |
| `ACCOUNT_REQUIREMENTS_DUE` | base | security | high |
| `BILLING_MODE_NOT_MIGRATED` | deep | billing | medium |
| `TRIAL_WITHOUT_PAYMENT_COLLECTION` | deep | billing | medium |
| `SUBSCRIPTIONS_PAST_DUE_ACCUMULATING` | deep | billing | low |
| `SUBSCRIPTION_COLLECTION_PAUSED` | deep | billing | medium |
| `METER_ERROR_NOT_MONITORED` | deep | billing | high |
| `HIGH_PERCENT_COUPON` | deep | pricing | medium |
| `HIGH_AMOUNT_COUPON` | deep | pricing | medium |
| `FOREVER_COUPON_STILL_VALID` | deep | pricing | medium |

---

## Webhooks

### WEBHOOK_SELECT_ALL
Webhook endpoint subscribes to all events · `critical` · `base`

- **What:** An enabled endpoint subscribes to all event types (`*`).
- **Why it matters:** A blanket subscription hides which revenue-critical events
  are actually consumed, so a silently dropped `invoice.payment_failed` looks
  identical to an event you never wanted.
- **How to fix:** Subscribe each endpoint to the explicit list of events it
  handles. Reserve `*` for debugging, never production billing.
- **Docs:** https://docs.stripe.com/webhooks

### WEBHOOK_ENDPOINT_DISABLED
Webhook endpoint is disabled · `high` · `base`

- **What:** An endpoint is in the `disabled` state.
- **Why it matters:** Every event it subscribes to is currently dropped. Stripe
  disables endpoints automatically after repeated delivery failures.
- **How to fix:** Re-enable the endpoint once the receiver is healthy, or delete
  it if it is obsolete so it no longer reads as a coverage gap.
- **Docs:** https://docs.stripe.com/webhooks/best-practices

### WEBHOOK_TOO_MANY_ENDPOINTS
Unusually many enabled webhook endpoints · `medium` · `base`

- **What:** The number of enabled endpoints exceeds an advisory threshold
  (default 10; tune with `options.threshold`).
- **Why it matters:** A sprawl of endpoints is hard to keep version-consistent and
  often signals stale test or integration endpoints left in place.
- **How to fix:** Audit the endpoint list and remove any that are no longer
  needed. Set `options.threshold` to tune this advisory for your integration.
- **Docs:** https://docs.stripe.com/api/webhook_endpoints

### WEBHOOK_DUPLICATE_URL
Duplicate webhook endpoint URL · `medium` · `base`

- **What:** Two or more enabled endpoints deliver to the same URL.
- **Why it matters:** Duplicate endpoints double-deliver every event and usually
  mean a forgotten copy is still live.
- **How to fix:** Consolidate to a single endpoint per URL and delete the
  duplicates, or give each a distinct URL if duplication is intentional.
- **Docs:** https://docs.stripe.com/api/webhook_endpoints

### WEBHOOK_INSECURE_URL
Insecure (non-https) webhook URL in live mode · `high` · `base`

- **What:** A live-mode endpoint uses a non-`https://` scheme.
- **Why it matters:** Event payloads (including signing material) travel
  unencrypted and can be intercepted or tampered with.
- **How to fix:** Serve the receiver over https and update the endpoint URL to an
  `https://` origin.
- **Docs:** https://docs.stripe.com/webhooks/best-practices

### WEBHOOK_SELECTION_REQUIRED_MISSED
Billing-critical webhook events are not subscribed · `high` · `base`

- **What:** No enabled endpoint subscribes to the billing-critical events
  (`invoice.payment_failed`, `invoice.payment_action_required`,
  `customer.subscription.deleted`).
- **Why it matters:** Without these, failed payments and cancellations never reach
  your systems, so churn and dunning go unhandled.
- **How to fix:** Subscribe at least one enabled endpoint to each billing-critical
  event.
- **Docs:** https://docs.stripe.com/webhooks

### WEBHOOK_TEST_ENDPOINT_IN_LIVE
Test/local webhook endpoint on a live account · `high` · `base`

- **What:** A live-account endpoint targets a local or tunnel host (e.g.
  `localhost`, `ngrok`, `*.test`).
- **Why it matters:** Live events are being routed to a development target — they
  will be lost in production.
- **How to fix:** Point live endpoints at a production https origin. Use test-mode
  keys and local tunnels for development, never the live account.
- **Docs:** https://docs.stripe.com/webhooks/best-practices

### WEBHOOK_API_VERSION_MISMATCH
Webhook endpoint pinned to an outdated API version · `medium` · `base`

- **What:** An enabled endpoint is pinned to an API version older than the latest
  Stripe release the audit knows.
- **Why it matters:** Pinned endpoints receive event shapes from an older release,
  which drift from newer integration code.
- **How to fix:** Upgrade the endpoint to the latest API version after confirming
  your handler tolerates the newer event shapes, or intentionally re-pin it.
- **Docs:** https://docs.stripe.com/upgrades

## Billing & customer portal

### NO_CUSTOMER_PORTAL
No default customer portal configured · `high` · `base`

- **What:** No portal configuration exists, or none is marked `is_default`.
- **Why it matters:** Customers cannot self-serve plan changes, cancellations,
  invoices, or card updates — every change becomes a support ticket and
  expired-card churn goes unrecovered.
- **How to fix:** Create a billing portal configuration and mark it the default in
  the Stripe Dashboard (Settings → Billing → Customer portal).
- **Docs:** https://docs.stripe.com/customer-management

### PORTAL_PAYMENT_UPDATE_DISABLED
Customer portal: payment method update disabled · `high` · `base`

- **What:** The default portal disables payment-method updates.
- **Why it matters:** Customers with an expiring or failing card cannot fix it
  themselves — a leading cause of involuntary churn.
- **How to fix:** Enable "Customer can update their payment methods" on the
  default portal configuration.
- **Docs:** https://docs.stripe.com/customer-management

### PORTAL_NO_CANCEL_FLOW
Customer portal: no self-serve cancellation · `medium` · `base`

- **What:** The default portal disables subscription cancellation.
- **Why it matters:** Forcing cancellations through support frustrates customers
  and risks chargebacks and disputes.
- **How to fix:** Enable "Customer can cancel subscriptions" on the default portal
  configuration.
- **Docs:** https://docs.stripe.com/customer-management

### PORTAL_NO_INVOICE_HISTORY
Customer portal: invoice history hidden · `medium` · `base`

- **What:** The default portal hides invoice history.
- **Why it matters:** Customers cannot self-serve receipts and billing records — a
  recurring support burden.
- **How to fix:** Enable "Customer can view their invoice history" on the default
  portal configuration.
- **Docs:** https://docs.stripe.com/customer-management

### PORTAL_NO_CUSTOMER_UPDATE
Customer portal: customer detail updates disabled · `medium` · `base`

- **What:** The default portal disables customer-detail updates (email, address,
  tax id).
- **Why it matters:** Customers cannot keep their billing information current.
- **How to fix:** Enable "Customer can update their information" on the default
  portal configuration.
- **Docs:** https://docs.stripe.com/customer-management

### PORTAL_LOGIN_PAGE_DISABLED
Customer portal: hosted login page disabled · `low` · `base`

- **What:** The default portal has the hosted login page turned off.
- **Why it matters:** There is no shareable self-serve URL — every portal visit
  must be deep-linked from your app.
- **How to fix:** Enable the hosted login page on the default portal configuration
  if you want a standalone portal URL.
- **Docs:** https://docs.stripe.com/customer-management

### PORTAL_PRORATION_NONE_ON_UPDATE
Customer portal: plan changes skip proration · `medium` · `base`

- **What:** The default portal allows subscription updates but sets proration to
  `none`.
- **Why it matters:** Mid-cycle upgrades are not charged the prorated difference,
  leaking revenue on every in-portal plan change.
- **How to fix:** Set the portal's subscription-update proration behavior to
  `create_prorations` (or `always_invoice`) so upgrades are billed correctly.
- **Docs:** https://docs.stripe.com/customer-management

## Pricing

### PRICE_NO_LOOKUP_KEY
Active recurring price has no lookup key · `low` · `base`

- **What:** An active recurring price has no `lookup_key`.
- **Why it matters:** Referencing prices by raw id is brittle — a `lookup_key`
  lets you swap the underlying price without a code change.
- **How to fix:** Assign a stable `lookup_key` to the price so your integration
  references it by key, not id.
- **Docs:** https://docs.stripe.com/products-prices/manage-prices

### ALL_PRICES_INACTIVE
Active product has no active price · `high` · `base`

- **What:** An active product has prices, but every one of them is inactive.
- **Why it matters:** The product cannot be purchased — any checkout or payment
  link for it fails.
- **How to fix:** Activate a price for the product, or archive the product if it
  is no longer sold.
- **Docs:** https://docs.stripe.com/products-prices/manage-prices

### PRICE_ZERO_AMOUNT
Active price set to zero · `medium` · `base`

- **What:** An active price has a unit amount of exactly `0` (distinct from a
  `null`/tiered amount).
- **Why it matters:** If this is not an intentional free tier, the product is
  being given away.
- **How to fix:** Confirm the zero amount is intentional; otherwise set a non-zero
  unit amount.
- **Docs:** https://docs.stripe.com/products-prices/manage-prices

### DEFAULT_PRICE_MISSING_OR_INACTIVE
Product default price missing or inactive · `medium` · `base`

- **What:** An active product has no `default_price`, or points at an inactive
  price.
- **Why it matters:** Stripe requires the default price to be active; payment
  links and Checkout that rely on it will misbehave.
- **How to fix:** Set the product default price to an active price.
- **Docs:** https://docs.stripe.com/products-prices/manage-prices

### MULTIPLE_ACTIVE_PRICES_PER_PRODUCT
Multiple active prices for the same product and cadence · `low` · `base`

- **What:** More than one active price exists for the same product, currency,
  billing cadence, and amount shape (a fixed price and a pay-what-you-want price
  are intentionally-distinct offerings, not duplicates).
- **Why it matters:** Stripe's convention is exactly one canonical active price
  per cadence; duplicates make "the price" ambiguous.
- **How to fix:** Archive the redundant prices, keeping one canonical active price
  per currency/cadence/amount (grandfathered prices aside).
- **Docs:** https://docs.stripe.com/products-prices/manage-prices

### PRICE_TAX_BEHAVIOR_UNSPECIFIED
Active price has unspecified tax behavior · `medium` · `base`

- **What:** An active price has `tax_behavior` unspecified.
- **Why it matters:** Stripe cannot tell whether the amount is tax-inclusive or
  exclusive, risking incorrect tax on every charge.
- **How to fix:** Set the price's `tax_behavior` to `inclusive` or `exclusive`.
- **Docs:** https://docs.stripe.com/tax

### CUSTOM_UNIT_AMOUNT_NO_MINIMUM
Customer-chosen price has no minimum · `medium` · `base`

- **What:** A customer-chosen (`custom_unit_amount`) price sets no minimum.
- **Why it matters:** Customers can pay arbitrarily little — including effectively
  nothing.
- **How to fix:** Set a minimum on the custom unit amount so pay-what-you-want has
  a floor.
- **Docs:** https://docs.stripe.com/products-prices/manage-prices

### CROSS_CURRENCY_PRICES
Product mixes multi-currency mechanisms · `low` · `base`

- **What:** A product has active prices in multiple base currencies and also uses
  `currency_options`.
- **Why it matters:** Mixing per-currency Price objects with on-price
  `currency_options` makes "which price applies" ambiguous and easy to
  misconfigure.
- **How to fix:** Pick one multi-currency mechanism per product — either separate
  Price objects per currency, or a single price with `currency_options`.
- **Docs:** https://docs.stripe.com/products-prices/manage-prices

## Tax & account configuration

### TAX_NOT_ENABLED
Stripe Tax is not enabled · `high` · `base`

- **What:** No Stripe Tax settings are present on the account.
- **Why it matters:** Automatic tax is not being calculated or collected. Tax owed
  on sales is silently your liability.
- **How to fix:** Enable and configure Stripe Tax (Settings → Tax) so tax is
  calculated on charges and invoices.
- **Docs:** https://docs.stripe.com/tax

### DEFAULT_TAX_BEHAVIOR_UNSET
No default tax behavior set · `medium` · `base`

- **What:** Stripe Tax is set up but has no default tax behavior
  (inclusive/exclusive).
- **Why it matters:** Prices without an explicit tax behavior fall back to
  ambiguous handling.
- **How to fix:** Set a default tax behavior (`inclusive` or `exclusive`) in your
  Stripe Tax settings.
- **Docs:** https://docs.stripe.com/tax/set-up

### TAX_SETTINGS_PENDING
Stripe Tax onboarding incomplete · `medium` · `base`

- **What:** Stripe Tax status is `pending` — onboarding (origin address, default
  tax code) is unfinished.
- **Why it matters:** Automatic tax is not fully active until onboarding
  completes.
- **How to fix:** Finish Stripe Tax onboarding (origin address + default product
  tax code) to move status to active.
- **Docs:** https://docs.stripe.com/tax/set-up

### UNBRANDED_RECEIPTS
Account branding not configured · `low` · `base`

- **What:** The account has neither a branding icon nor a logo.
- **Why it matters:** Receipts, invoices, and the customer portal render
  unbranded — eroding trust and increasing dispute risk.
- **How to fix:** Upload a branding icon and/or logo in the Stripe Dashboard
  (Settings → Branding).
- **Docs:** https://docs.stripe.com/api/accounts

### DEFAULT_ACCOUNT_TAX_IDS_MISSING
No default account tax ids on invoices · `low` · `base`

- **What:** No default account tax ids are set.
- **Why it matters:** Your business tax registration number does not appear on
  invoices — a compliance gap in many jurisdictions.
- **How to fix:** Set default account tax ids in your invoice settings so they
  appear on every invoice.
- **Docs:** https://docs.stripe.com/api/accounts

### STATEMENT_DESCRIPTOR_MISSING
No statement descriptor configured · `medium` · `base`

- **What:** No statement descriptor is set on the account.
- **Why it matters:** Charges may appear on customer card statements without a
  recognizable name — a leading cause of "I don't recognize this charge" disputes
  and chargebacks.
- **How to fix:** Set a clear statement descriptor in the Stripe Dashboard
  (Settings → Public details / Payments).
- **Docs:** https://docs.stripe.com/api/accounts

### EVENT_DESTINATIONS_NOT_AUDITED
v2 event destinations not audited · `info` · `base`

- **What:** This audit covers classic `/v1/webhook_endpoints` only; v2 event
  destinations ("thin events") were not included.
- **Why it matters:** If you also use v2 event destinations, they are outside this
  report's coverage — a visibility note, not a misconfiguration.
- **How to fix:** Review v2 event destinations separately in the Stripe Dashboard
  if your integration uses them.
- **Docs:** https://docs.stripe.com/event-destinations

## Security & account health

### TEST_KEY_DETECTED_LIVE
Test-mode key against live data · `critical` · `base`

- **What:** The audit key has a test prefix but account responses report
  `livemode=true`.
- **Why it matters:** The key/environment is misconfigured — test tooling may be
  operating on real production data.
- **How to fix:** Confirm which environment you intend to audit and use a key whose
  prefix matches it.
- **Docs:** https://docs.stripe.com/keys

### LIVE_KEY_DETECTED_TEST
Live-mode key against test data · `high` · `base`

- **What:** The audit key has a live prefix but account responses report
  `livemode=false`.
- **Why it matters:** The key/environment is mismatched — results will not reflect
  your production configuration.
- **How to fix:** Use a key whose prefix matches the environment you intend to
  audit.
- **Docs:** https://docs.stripe.com/keys

### RESTRICTED_KEY_PERMISSION_PROBE
Restricted key is missing read scopes · `info` · `base`

- **What:** The audit key could not read one or more of the six default read
  regions, so those rules were skipped.
- **Why it matters:** The audit is partial. (This is expected if you intentionally
  scoped the key narrower than the six read regions.)
- **How to fix:** Grant the key read access to the missing regions for a complete
  audit, or accept the reduced coverage.
- **Docs:** https://docs.stripe.com/keys#create-restricted-api-secret-key

### ACCOUNT_CHARGES_DISABLED
Account cannot create charges · `high` · `base`

- **What:** The account reports it cannot currently create charges.
- **Why it matters:** Every payment attempt will fail until this is resolved —
  usually an onboarding or verification gap.
- **How to fix:** Complete account onboarding / verification in the Stripe
  Dashboard so charges are enabled.
- **Docs:** https://docs.stripe.com/api/accounts

### ACCOUNT_REQUIREMENTS_DUE
Account has outstanding requirements · `high` · `base`

- **What:** Stripe reports outstanding account requirements (currently due, or a
  disabled reason).
- **Why it matters:** Unmet requirements can disable charges or payouts,
  interrupting revenue.
- **How to fix:** Submit the outstanding requirements in the Stripe Dashboard
  before they disable the account.
- **Docs:** https://docs.stripe.com/api/accounts

## Deep rules (`--deep`)

Deep rules read regions beyond the base 6 and run only under
`npx stripe-audit --deep` with the matching read permissions granted (see the
[scopes reference](scopes-reference.md)). In base mode they are listed in the
report's skipped section — never silently counted as passed. Each shipped deep
rule was admitted by a readability verify-gate in
[`docs/verify-gates/`](verify-gates/).

### BILLING_MODE_NOT_MIGRATED
Subscriptions not migrated to flexible billing mode · `medium` · `deep`

- **What:** One or more subscriptions still run `billing_mode` `'classic'`.
- **Why it matters:** Flexible billing mode has more accurate proration and
  discount itemization; a mixed classic/flexible fleet makes invoice behavior
  inconsistent across customers.
- **How to fix:** Migrate remaining subscriptions to `billing_mode 'flexible'`
  (one-way change); verify proration behavior on a test subscription first.
- **Docs:** https://docs.stripe.com/api/subscriptions

### TRIAL_WITHOUT_PAYMENT_COLLECTION
Trials end without collecting payment · `medium` · `deep`

- **What:** One or more trialing subscriptions have
  `trial_settings.end_behavior.missing_payment_method` set to `cancel` or
  `pause`.
- **Why it matters:** When such a trial ends with no payment method attached,
  Stripe cancels or pauses the subscription instead of raising an invoice. The
  conversion is lost silently — there is no failed payment, no dunning, and
  nothing for revenue recovery to retry.
- **How to fix:** Set `missing_payment_method` to `create_invoice` so the trial
  ends with a collectible invoice, or require a payment method up front
  (Checkout or a SetupIntent at trial signup).
- **Docs:** https://docs.stripe.com/api/subscriptions

### SUBSCRIPTIONS_PAST_DUE_ACCUMULATING
Subscriptions accumulating in past_due or unpaid · `low` · `deep`

- **What:** Subscriptions are sitting in `past_due` (an invoice payment failed)
  or `unpaid` (the retry schedule ran out).
- **Why it matters:** An unpaid balance is revenue you already earned and have
  not collected. This is a state, not proof of a misconfiguration — some
  `past_due` is normal while dunning runs — so the finding is advisory and asks
  you to verify the settings behind it rather than asserting a fault. The retry
  policy itself is Dashboard-only and not readable by this audit (see
  `SMART_RETRIES_DISABLED` under Dropped rules).
- **How to fix:** In the Dashboard, check Billing → Revenue recovery → Retries:
  confirm Smart Retries (or a custom schedule) is on, failed-payment emails are
  enabled, and the end-of-retry behavior matches your intent. Enable customer
  portal payment-method updates so customers can self-serve a fix.
- **Docs:** https://docs.stripe.com/billing/revenue-recovery

### SUBSCRIPTION_COLLECTION_PAUSED
Subscriptions with payment collection paused · `medium` · `deep`

- **What:** Subscriptions carry `pause_collection`, so Stripe is not collecting
  payment on them.
- **Why it matters:** This is the one revenue gap no status filter can show you.
  Stripe leaves the subscription's status unchanged while collection is paused —
  it never becomes `paused` — so the subscription still reads active in the
  Dashboard and in this audit's own status counts. A pause set with no
  `resumes_at` date runs until someone unsets it by hand, which makes a forgotten
  pause indefinite, silent non-billing.
- **How to fix:** Review each paused subscription: confirm the pause is still
  intentional and has a `resumes_at` date rather than running open-ended. Resume
  by updating the subscription with `pause_collection` unset.
- **Docs:** https://docs.stripe.com/api/subscriptions

### METER_ERROR_NOT_MONITORED
Meter error reports are not monitored · `high` · `deep`

- **What:** Active billing meters exist but no enabled event destination listens
  for `v1.billing.meter.error_report_triggered` (or `*`).
- **Why it matters:** Meter events that fail validation are silently dropped —
  unrecorded usage is unbilled revenue, and nothing alerts you.
- **How to fix:** Create an event destination subscribed to the meter-error
  thin event and wire it to your alerting.
- **Docs:** https://docs.stripe.com/event-destinations

### HIGH_PERCENT_COUPON
Valid coupon with a giveaway-level percent discount · `medium` · `deep`

- **What:** A still-redeemable coupon takes ≥90% off (threshold tunable via
  rule options).
- **Why it matters:** A leaked or forgotten giveaway-grade coupon silently
  erases revenue on every invoice it touches.
- **How to fix:** Delete or bound it (`redeem_by` / `max_redemptions`); keep
  steep discounts on short-lived promotion codes.
- **Docs:** https://docs.stripe.com/api/coupons

### HIGH_AMOUNT_COUPON
Valid coupon with a giveaway-level fixed discount · `medium` · `deep`

- **What:** A still-redeemable coupon takes a large fixed `amount_off` (default
  ≥ 50 000 minor units ≈ 500.00; threshold tunable via rule options).
- **Why it matters:** A leaked or forgotten large fixed discount silently erases
  revenue on every invoice it touches. The threshold is absolute and
  currency-naive — Stripe has no coupon→price linkage to size it against, so tune
  it to your pricing.
- **How to fix:** Delete or bound it (`redeem_by` / `max_redemptions`); keep
  steep discounts on short-lived, single-use promotion codes.
- **Docs:** https://docs.stripe.com/api/coupons

### FOREVER_COUPON_STILL_VALID
Forever-duration coupon is still valid · `medium` · `deep`

- **What:** A coupon with `duration 'forever'` is still redeemable.
- **Why it matters:** Once applied it discounts every invoice for that customer
  indefinitely — each new redemption is a permanent revenue reduction. The
  finding also states the coupon's blast radius from `applies_to.products`:
  either "applies to ALL products in the catalog" (unscoped, the default) or
  "scoped to N products". The linkage is product-level only — Stripe has no
  coupon→price linkage, which is why `COUPON_FOREVER_ON_ALL_PRICES` is a
  permanent non-goal.
- **How to fix:** Confirm it's intentional; otherwise delete or bound it, and
  prefer `once`/`repeating` durations for promotions.
- **Docs:** https://docs.stripe.com/api/coupons

## Dropped rules

Rules stripe-audit **consciously does not build**, because a readability
verify-gate or the v1 readability audit proved the data is not API-readable
under a restricted read-only key. The full registry with reasons ships in the
CLI (`npx stripe-audit --list-rules`, DROPPED section) and in code at
[`src/rules/dropped.ts`](../src/rules/dropped.ts); highlights:

Each entry carries a **category** — the lever that would change the verdict, not a
synonym for "no":

- `api-gap` — the data does not exist in the API under any key. Only a Stripe
  API change moves it.
- `scope-gated` — the data is readable but sits in a region this audit does not
  fetch. Adding the region moves it — a decision we control.
- `low-value` — readable and in scope, but the rule would not earn its place
  (redundant with a shipping rule, or the condition cannot occur).

| Rule | Category | Why it is not built |
|---|---|---|
| `RADAR_SETUP_INTENTS_NOT_ENABLED` | api-gap | Radar SetupIntent screening is a Dashboard toggle with no API object to read ([verdict](verify-gates/RADAR_SETUP_INTENTS.md)) |
| `SMART_RETRIES_DISABLED` | api-gap | The retry schedule is configured only in the Dashboard; no object exposes it |
| `WEBHOOK_HIGH_FAILURE_RATE` | api-gap | No delivery metrics on any readable object — the v2 destination's disabled-reason enum has no delivery-failure value |
| `COUPON_FOREVER_ON_ALL_PRICES` | low-value | Coupon scoping is product-level via `applies_to.products`; `FOREVER_COUPON_STILL_VALID` already reports that blast radius |
| `CUSTOMER_DEFAULT_CURRENCY_MISSING` | low-value | `account.default_currency` is non-nullable, so the condition cannot occur |
| `INVOICE_WINDOW_NOT_USED` | scope-gated | Readable, but the audit fetches no invoices region |
| …and the rest | — | `stripe-audit --list-rules` prints the complete registry with categories, reasons, and evidence |

> One entry here was wrong for a month: `TRIAL_WITHOUT_PAYMENT_COLLECTION` claimed
> its setting was "not readable via the API" when the field is a plain enum on an
> object the audit already fetched. It now **ships** as an active rule. Every
> remaining reason was re-verified against the cached Stripe schema pages in v0.3,
> and each entry's `evidence` field points at the specific document that backs it.

## Related documentation

- [README](../README.md) — install, 30-second quickstart, restricted-key setup, and CI usage.
- [Scopes reference](scopes-reference.md) — every permission the tool ever asks for, which rules need it, and what is never requested.
- [Coverage census](../COVERAGE.md) — every rule in one table with category, severity, scope, and the Stripe API version it targets.
- [Changelog](../CHANGELOG.md) — releases and the Stripe API compatibility notes.
