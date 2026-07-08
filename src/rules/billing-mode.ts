/**
 * stripe-audit — billing-mode rule (deep tier).
 *
 * Built per the verify-gate verdict READABLE
 * (`docs/verify-gates/BILLING_MODE.md`): the rule keys off the REAL
 * `subscription.billing_mode.type` signal ('classic' | 'flexible'), aggregated by
 * the deep fetcher into `subscriptionSummary.byBillingMode` — never off any
 * phantom snapshot version field (the readability audit removed it; a guard test
 * grep-enforces its absence here).
 *
 * `requires: ['subscriptions']` is a deep region, so the rule derives to deep
 * tier: base-mode runs SKIP it (engine `requires-deep`) rather than passing it.
 */
import { defineRule } from '../define-rule'
import type { Rule } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/** Any subscription still on the legacy 'classic' billing mode — an un-migrated fleet. */
export const BILLING_MODE_NOT_MIGRATED: Rule = defineRule({
  id: 'BILLING_MODE_NOT_MIGRATED',
  name: 'Subscriptions not migrated to flexible billing mode',
  severity: 'medium',
  category: 'billing',
  requires: ['subscriptions'],
  check: (snapshot) => {
    const summary = snapshot.subscriptionSummary
    // null = region unreadable/denied (deep fetch degraded) — never a finding.
    if (summary === null) return []
    const classicCount = summary.byBillingMode['classic'] ?? 0
    if (classicCount === 0) return []
    return [
      buildFinding(BILLING_MODE_NOT_MIGRATED, {
        title: `${classicCount} subscription${classicCount === 1 ? '' : 's'} still on classic billing mode`,
        description:
          `${classicCount} of ${summary.total} subscriptions ${classicCount === 1 ? 'runs' : 'run'} billing_mode 'classic' (legacy proration ` +
          `and invoice calculations). Stripe's flexible billing mode supports more accurate proration, ` +
          `discount itemization, and orchestration; a mixed classic/flexible fleet also makes invoice ` +
          `behavior inconsistent across customers.`,
        remediation:
          "Migrate remaining subscriptions to billing_mode 'flexible' (subscription update with " +
          "billing_mode.type='flexible'; the change is one-way). Roll out gradually and verify proration " +
          'behavior on a test subscription first.',
        docsUrl: DOCS.subscriptions,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** The billing-mode cluster (deep tier — skipped in base mode). */
export const billingModeRules: Rule[] = [BILLING_MODE_NOT_MIGRATED]
