/**
 * stripe-audit — tax / account-configuration rule cluster.
 *
 * Seven pure `(snapshot) => Finding[]` rules over the `tax`, `account`, and
 * `webhook_endpoints` base regions, re-grounded against
 * the v1 rule-readability audit and the Stripe docs (tax Settings and
 * Account API objects; the tax setup and event-destinations guides).
 *
 * `taxSettings` is nullable: null means tax is not enabled (or the scope was
 * denied) — TAX_NOT_ENABLED reads that. `taxSettings.status` is the enum
 * active|pending (never a boolean). The "collecting vs configured" distinction and
 * any tax-registrations dependency are intentionally NOT modelled (a separate
 * resource/scope) — recorded as a non-goal in COVERAGE.md. Every rule's `requires`
 * is a base region, so the cluster derives to base tier.
 */
import { defineRule } from '../define-rule'
import type { Rule } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/** Stripe Tax is not enabled on the account (taxSettings absent/null). */
export const TAX_NOT_ENABLED: Rule = defineRule({
  id: 'TAX_NOT_ENABLED',
  name: 'Stripe Tax is not enabled',
  severity: 'high',
  category: 'configuration',
  requires: ['tax'],
  check: (snapshot) => {
    if (snapshot.taxSettings !== null) return []
    return [
      buildFinding(TAX_NOT_ENABLED, {
        title: 'Stripe Tax is not enabled',
        description:
          'No Stripe Tax settings are present, so automatic tax is not being calculated or collected. Tax owed on sales is silently your liability.',
        remediation: 'Enable and configure Stripe Tax (Settings → Tax) so tax is calculated on charges and invoices.',
        docsUrl: DOCS.tax,
        affectedResourceId: null,
        affectedResourceType: 'tax_settings',
      }),
    ]
  },
})

/** Tax is configured but no default tax behavior is set. */
export const DEFAULT_TAX_BEHAVIOR_UNSET: Rule = defineRule({
  id: 'DEFAULT_TAX_BEHAVIOR_UNSET',
  name: 'No default tax behavior set',
  severity: 'medium',
  category: 'configuration',
  requires: ['tax'],
  check: (snapshot) => {
    const tax = snapshot.taxSettings
    if (tax === null || tax.defaultTaxBehavior !== null) return []
    return [
      buildFinding(DEFAULT_TAX_BEHAVIOR_UNSET, {
        title: 'No default tax behavior configured',
        description:
          'Stripe Tax is set up but has no default tax behavior (inclusive/exclusive). Prices without an explicit tax behavior fall back to ambiguous handling.',
        remediation: "Set a default tax behavior ('inclusive' or 'exclusive') in your Stripe Tax settings.",
        docsUrl: DOCS.taxSetup,
        affectedResourceId: null,
        affectedResourceType: 'tax_settings',
      }),
    ]
  },
})

/** Tax onboarding is incomplete (status === 'pending'). */
export const TAX_SETTINGS_PENDING: Rule = defineRule({
  id: 'TAX_SETTINGS_PENDING',
  name: 'Stripe Tax onboarding incomplete',
  severity: 'medium',
  category: 'configuration',
  requires: ['tax'],
  check: (snapshot) => {
    const tax = snapshot.taxSettings
    if (tax === null || tax.status !== 'pending') return []
    return [
      buildFinding(TAX_SETTINGS_PENDING, {
        title: 'Stripe Tax onboarding is incomplete',
        description:
          'Stripe Tax status is pending — onboarding (origin address, default tax code) is unfinished, so automatic tax is not fully active.',
        remediation: 'Finish Stripe Tax onboarding (origin address + default product tax code) to move status to active.',
        docsUrl: DOCS.taxSetup,
        affectedResourceId: null,
        affectedResourceType: 'tax_settings',
      }),
    ]
  },
})

/** Account branding has neither icon nor logo — receipts and the portal look unbranded. */
export const UNBRANDED_RECEIPTS: Rule = defineRule({
  id: 'UNBRANDED_RECEIPTS',
  name: 'Account branding not configured',
  severity: 'low',
  category: 'configuration',
  requires: ['account'],
  check: (snapshot) => {
    const { icon, logo } = snapshot.account.branding
    if (icon !== null || logo !== null) return []
    return [
      buildFinding(UNBRANDED_RECEIPTS, {
        title: 'Account branding (icon/logo) not configured',
        description:
          'The account has neither a branding icon nor a logo, so receipts, invoices, and the customer portal render unbranded — eroding trust and increasing dispute risk.',
        remediation: 'Upload a branding icon and/or logo in the Stripe Dashboard (Settings → Branding).',
        docsUrl: DOCS.account,
        affectedResourceId: snapshot.account.id || null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** No default account tax IDs set for invoices. */
export const DEFAULT_ACCOUNT_TAX_IDS_MISSING: Rule = defineRule({
  id: 'DEFAULT_ACCOUNT_TAX_IDS_MISSING',
  name: 'No default account tax IDs on invoices',
  severity: 'low',
  category: 'configuration',
  requires: ['account'],
  check: (snapshot) => {
    if (snapshot.account.defaultAccountTaxIdsSet) return []
    return [
      buildFinding(DEFAULT_ACCOUNT_TAX_IDS_MISSING, {
        title: 'No default account tax IDs configured for invoices',
        description:
          'No default account tax IDs are set, so your business tax registration number does not appear on invoices — a compliance gap in many jurisdictions.',
        remediation: 'Set default account tax IDs in your invoice settings so they appear on every invoice.',
        docsUrl: DOCS.account,
        affectedResourceId: snapshot.account.id || null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** No statement descriptor configured — charges show an unrecognizable descriptor. */
export const STATEMENT_DESCRIPTOR_MISSING: Rule = defineRule({
  id: 'STATEMENT_DESCRIPTOR_MISSING',
  name: 'No statement descriptor configured',
  severity: 'medium',
  category: 'configuration',
  requires: ['account'],
  check: (snapshot) => {
    if (snapshot.account.statementDescriptor !== null) return []
    return [
      buildFinding(STATEMENT_DESCRIPTOR_MISSING, {
        title: 'No statement descriptor configured',
        description:
          'No statement descriptor is set, so charges may appear on customer card statements without a recognizable name — a leading cause of "I don’t recognize this charge" disputes and chargebacks.',
        remediation: 'Set a clear statement descriptor in the Stripe Dashboard (Settings → Public details / Payments).',
        docsUrl: DOCS.account,
        affectedResourceId: snapshot.account.id || null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** Classic webhook endpoints exist but v2 event destinations were not audited (info note). */
export const EVENT_DESTINATIONS_NOT_AUDITED: Rule = defineRule({
  id: 'EVENT_DESTINATIONS_NOT_AUDITED',
  name: 'v2 event destinations not audited',
  severity: 'info',
  category: 'configuration',
  requires: ['webhook_endpoints'],
  check: (snapshot) => {
    // base mode never populates thinEventDestinations; surface a coverage note only
    // when classic endpoints exist (so the absence is meaningful, not a clean account).
    if (snapshot.webhookEndpoints.length === 0 || snapshot.thinEventDestinations !== null) return []
    return [
      buildFinding(EVENT_DESTINATIONS_NOT_AUDITED, {
        title: 'v2 event destinations were not audited',
        description:
          'This audit covers classic /v1/webhook_endpoints only. If you also use v2 event destinations ("thin events"), they are not included in this report.',
        remediation: 'Review v2 event destinations separately in the Stripe Dashboard if your integration uses them.',
        docsUrl: DOCS.eventDestinations,
        affectedResourceId: null,
        affectedResourceType: 'event_destination',
      }),
    ]
  },
})

/** The tax/config rule cluster, in stable order. Aggregated into ALL_RULES by `index.ts`. */
export const configurationRules: Rule[] = [
  TAX_NOT_ENABLED,
  DEFAULT_TAX_BEHAVIOR_UNSET,
  TAX_SETTINGS_PENDING,
  UNBRANDED_RECEIPTS,
  DEFAULT_ACCOUNT_TAX_IDS_MISSING,
  STATEMENT_DESCRIPTOR_MISSING,
  EVENT_DESTINATIONS_NOT_AUDITED,
]
