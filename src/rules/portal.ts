/**
 * stripe-audit — customer-portal rule cluster.
 *
 * Seven pure `(snapshot) => Finding[]` rules over the `billing_portal` base region,
 * re-grounded against the v1 rule-readability audit and the Stripe docs
 * (the portal Configuration API object; the customer-portal integration guide).
 *
 * All rules read the snapshot's `portalConfigurations[]` ARRAY (the plural
 * field — never a singular `portalConfiguration`). `NO_CUSTOMER_PORTAL` flags the
 * absence of a default configuration; the per-feature rules evaluate the DEFAULT
 * configuration's flattened `features.*.enabled` flags (the config a customer
 * actually gets when no specific configuration is requested). Every rule declares
 * `requires: ['billing_portal']`, so the cluster derives to base tier.
 */
import { defineRule } from '../define-rule'
import type { Rule, SnapshotPortalConfiguration, StripeAccountSnapshot } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/** The account's default portal configuration, or undefined when none is marked default. */
function defaultConfig(snapshot: StripeAccountSnapshot): SnapshotPortalConfiguration | undefined {
  return snapshot.portalConfigurations.find((c) => c.isDefault)
}

/** No default customer portal configured (empty list, or none marked `is_default`). */
export const NO_CUSTOMER_PORTAL: Rule = defineRule({
  id: 'NO_CUSTOMER_PORTAL',
  name: 'No default customer portal configured',
  severity: 'high',
  category: 'billing',
  requires: ['billing_portal'],
  check: (snapshot) => {
    if (defaultConfig(snapshot) !== undefined) return []
    return [
      buildFinding(NO_CUSTOMER_PORTAL, {
        title: `No default customer portal configuration`,
        description:
          snapshot.portalConfigurations.length === 0
            ? 'No customer portal configuration exists. Customers cannot self-serve plan changes, cancellations, invoices, or card updates.'
            : 'No portal configuration is marked as the default (`is_default`). Without a default, the hosted portal falls back to Stripe defaults and your configured options never apply.',
        remediation:
          'Create a billing portal configuration and mark it the default in the Stripe Dashboard (Settings → Billing → Customer portal).',
        docsUrl: DOCS.customerPortal,
        affectedResourceId: null,
        affectedResourceType: 'billing_portal_configuration',
        estimatedImpact:
          'Without self-serve billing, every change becomes a support ticket and expired-card churn goes unrecovered.',
      }),
    ]
  },
})

/**
 * Build a per-feature rule over the DEFAULT portal configuration. Returns [] when
 * there is no default config (NO_CUSTOMER_PORTAL owns that case).
 */
function defaultFeatureRule(
  rule: Rule,
  isDisabled: (config: SnapshotPortalConfiguration) => boolean,
  finding: { title: string; description: string; remediation: string },
): Rule['check'] {
  return (snapshot) => {
    const config = defaultConfig(snapshot)
    if (config === undefined || !isDisabled(config)) return []
    return [
      buildFinding(rule, {
        title: finding.title,
        description: finding.description,
        remediation: finding.remediation,
        docsUrl: DOCS.customerPortal,
        affectedResourceId: config.id,
        affectedResourceType: 'billing_portal_configuration',
      }),
    ]
  }
}

/** The default portal does not let customers update their payment method. */
export const PORTAL_PAYMENT_UPDATE_DISABLED: Rule = defineRule({
  id: 'PORTAL_PAYMENT_UPDATE_DISABLED',
  name: 'Customer portal: payment method update disabled',
  severity: 'high',
  category: 'billing',
  requires: ['billing_portal'],
  check: (snapshot) =>
    defaultFeatureRule(
      PORTAL_PAYMENT_UPDATE_DISABLED,
      (c) => !c.paymentMethodUpdate,
      {
        title: 'Customer portal does not allow payment method updates',
        description:
          'The default portal disables payment-method updates, so customers with an expiring or failing card cannot fix it themselves — a leading cause of involuntary churn.',
        remediation: 'Enable "Customer can update their payment methods" on the default portal configuration.',
      },
    )(snapshot),
})

/** The default portal does not let customers cancel subscriptions. */
export const PORTAL_NO_CANCEL_FLOW: Rule = defineRule({
  id: 'PORTAL_NO_CANCEL_FLOW',
  name: 'Customer portal: no self-serve cancellation',
  severity: 'medium',
  category: 'billing',
  requires: ['billing_portal'],
  check: (snapshot) =>
    defaultFeatureRule(
      PORTAL_NO_CANCEL_FLOW,
      (c) => !c.subscriptionCancel,
      {
        title: 'Customer portal does not offer self-serve cancellation',
        description:
          'The default portal disables subscription cancellation. Forcing cancellations through support frustrates customers and risks chargebacks / disputes.',
        remediation: 'Enable "Customer can cancel subscriptions" on the default portal configuration.',
      },
    )(snapshot),
})

/** The default portal does not expose invoice history. */
export const PORTAL_NO_INVOICE_HISTORY: Rule = defineRule({
  id: 'PORTAL_NO_INVOICE_HISTORY',
  name: 'Customer portal: invoice history hidden',
  severity: 'medium',
  category: 'billing',
  requires: ['billing_portal'],
  check: (snapshot) =>
    defaultFeatureRule(
      PORTAL_NO_INVOICE_HISTORY,
      (c) => !c.invoiceHistory,
      {
        title: 'Customer portal does not show invoice history',
        description:
          'The default portal hides invoice history, so customers cannot self-serve receipts and billing records — a recurring support burden.',
        remediation: 'Enable "Customer can view their invoice history" on the default portal configuration.',
      },
    )(snapshot),
})

/** The default portal does not let customers update their billing details. */
export const PORTAL_NO_CUSTOMER_UPDATE: Rule = defineRule({
  id: 'PORTAL_NO_CUSTOMER_UPDATE',
  name: 'Customer portal: customer detail updates disabled',
  severity: 'medium',
  category: 'billing',
  requires: ['billing_portal'],
  check: (snapshot) =>
    defaultFeatureRule(
      PORTAL_NO_CUSTOMER_UPDATE,
      (c) => !c.customerUpdate,
      {
        title: 'Customer portal does not allow customer detail updates',
        description:
          'The default portal disables customer-detail updates (email, address, tax ID), so customers cannot keep their billing information current.',
        remediation: 'Enable "Customer can update their information" on the default portal configuration.',
      },
    )(snapshot),
})

/** The default portal has the hosted login page disabled. */
export const PORTAL_LOGIN_PAGE_DISABLED: Rule = defineRule({
  id: 'PORTAL_LOGIN_PAGE_DISABLED',
  name: 'Customer portal: hosted login page disabled',
  severity: 'low',
  category: 'billing',
  requires: ['billing_portal'],
  check: (snapshot) =>
    defaultFeatureRule(
      PORTAL_LOGIN_PAGE_DISABLED,
      (c) => !c.loginPage,
      {
        title: 'Customer portal hosted login page is disabled',
        description:
          'The default portal has the hosted login page off, so there is no shareable self-serve URL — every portal visit must be deep-linked from your app.',
        remediation: 'Enable the hosted login page on the default portal configuration if you want a standalone portal URL.',
      },
    )(snapshot),
})

/** Subscription updates are enabled but proration is set to 'none' — a revenue leak. */
export const PORTAL_PRORATION_NONE_ON_UPDATE: Rule = defineRule({
  id: 'PORTAL_PRORATION_NONE_ON_UPDATE',
  name: 'Customer portal: plan changes skip proration',
  severity: 'medium',
  category: 'billing',
  requires: ['billing_portal'],
  check: (snapshot) => {
    const config = defaultConfig(snapshot)
    if (config === undefined) return []
    if (!config.subscriptionUpdate || config.subscriptionUpdateProration !== 'none') return []
    return [
      buildFinding(PORTAL_PRORATION_NONE_ON_UPDATE, {
        title: 'Portal plan changes apply no proration',
        description:
          "The default portal allows subscription updates but sets proration to 'none'. Mid-cycle upgrades are not charged the prorated difference, leaking revenue on every in-portal plan change.",
        remediation:
          "Set the portal's subscription-update proration behavior to 'create_prorations' (or 'always_invoice') so upgrades are billed correctly.",
        docsUrl: DOCS.customerPortal,
        affectedResourceId: config.id,
        affectedResourceType: 'billing_portal_configuration',
      }),
    ]
  },
})

/** The customer-portal rule cluster, in stable order. Aggregated into ALL_RULES by `index.ts`. */
export const portalRules: Rule[] = [
  NO_CUSTOMER_PORTAL,
  PORTAL_PAYMENT_UPDATE_DISABLED,
  PORTAL_NO_CANCEL_FLOW,
  PORTAL_NO_INVOICE_HISTORY,
  PORTAL_NO_CUSTOMER_UPDATE,
  PORTAL_LOGIN_PAGE_DISABLED,
  PORTAL_PRORATION_NONE_ON_UPDATE,
]
