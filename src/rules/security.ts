/**
 * stripe-audit — security / account rule cluster (security-sensitive).
 *
 * Five pure `(snapshot) => Finding[]` rules over the `account` base region.
 * Re-grounded against the v1 rule-readability audit and the Stripe docs
 * (API keys; the Account API object).
 *
 * SECURITY (live-key exposure / over-broad scope): these rules NEVER touch the raw API key — they read
 * only the prefix-derived {@link StripeAccountSnapshot.accountMode}, the server
 * `livemode` signal, the `scopeProbe`, and account status. No key value is logged,
 * printed, or stored, and no finding embeds a key. Test/live detection comes from
 * the key prefix cross-checked against `livemode` — never from account status.
 *
 * Every rule declares `requires: ['account']`, so the cluster derives to base tier.
 * (API_VERSION_OUTDATED was dropped — the account's true default API version
 * is unobservable through stripe-node; see COVERAGE.md.)
 */
import { defineRule } from '../define-rule'
import type { Rule } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/** A test-prefixed key whose server livemode signal says live — a dangerous mode mismatch. */
export const TEST_KEY_DETECTED_LIVE: Rule = defineRule({
  id: 'TEST_KEY_DETECTED_LIVE',
  name: 'Test-mode key against live data',
  severity: 'critical',
  category: 'security',
  requires: ['account'],
  check: (snapshot) => {
    // Mode = key prefix (accountMode) cross-checked against the server livemode.
    if (!(snapshot.accountMode === 'test' && snapshot.livemode === true)) return []
    return [
      buildFinding(TEST_KEY_DETECTED_LIVE, {
        title: 'Test-mode key is seeing live data',
        description:
          'The audit key has a test prefix but the account responses report livemode=true. The key/environment is misconfigured — test tooling may be operating on real production data.',
        remediation: 'Confirm which environment you intend to audit and use a key whose prefix matches it.',
        docsUrl: DOCS.apiKeys,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** A live-prefixed key whose server livemode signal says test. */
export const LIVE_KEY_DETECTED_TEST: Rule = defineRule({
  id: 'LIVE_KEY_DETECTED_TEST',
  name: 'Live-mode key against test data',
  severity: 'high',
  category: 'security',
  requires: ['account'],
  check: (snapshot) => {
    if (!(snapshot.accountMode === 'live' && snapshot.livemode === false)) return []
    return [
      buildFinding(LIVE_KEY_DETECTED_TEST, {
        title: 'Live-mode key is seeing test data',
        description:
          'The audit key has a live prefix but the account responses report livemode=false. The key/environment is mismatched — results will not reflect your production configuration.',
        remediation: 'Use a key whose prefix matches the environment you intend to audit.',
        docsUrl: DOCS.apiKeys,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** Enumerate the scopes the restricted key did NOT grant (an info coverage note). */
export const RESTRICTED_KEY_PERMISSION_PROBE: Rule = defineRule({
  id: 'RESTRICTED_KEY_PERMISSION_PROBE',
  name: 'Restricted key is missing read scopes',
  severity: 'info',
  category: 'security',
  requires: ['account'],
  check: (snapshot) => {
    const denied = snapshot.scopeProbe.filter((g) => !g.granted).map((g) => g.scope)
    if (denied.length === 0) return []
    return [
      buildFinding(RESTRICTED_KEY_PERMISSION_PROBE, {
        title: 'Restricted key did not grant every read scope',
        description: `The audit key could not read: ${denied.join(', ')}. Rules over those regions were skipped, so this audit is partial. (This is expected if you intentionally scoped the key narrower than the audit's 6 read regions.)`,
        remediation: `Grant the key read access to ${denied.join(', ')} for a complete audit, or accept the reduced coverage.`,
        docsUrl: DOCS.restrictedKeys,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** The account cannot create charges. */
export const ACCOUNT_CHARGES_DISABLED: Rule = defineRule({
  id: 'ACCOUNT_CHARGES_DISABLED',
  name: 'Account cannot create charges',
  severity: 'high',
  category: 'security',
  requires: ['account'],
  check: (snapshot) => {
    if (snapshot.account.chargesEnabled === false) {
      return [
        buildFinding(ACCOUNT_CHARGES_DISABLED, {
          title: 'Account is not able to create charges',
          description:
            'The account reports it cannot currently create charges. Every payment attempt will fail until this is resolved — usually an onboarding or verification gap.',
          remediation: 'Complete account onboarding / verification in the Stripe Dashboard so charges are enabled.',
          docsUrl: DOCS.account,
          affectedResourceId: snapshot.account.id || null,
          affectedResourceType: 'account',
          estimatedImpact: 'While charges are disabled, 100% of payment attempts fail.',
        }),
      ]
    }
    return []
  },
})

/** The account has outstanding requirements (currently due, or a disabled reason). */
export const ACCOUNT_REQUIREMENTS_DUE: Rule = defineRule({
  id: 'ACCOUNT_REQUIREMENTS_DUE',
  name: 'Account has outstanding requirements',
  severity: 'high',
  category: 'security',
  requires: ['account'],
  check: (snapshot) => {
    const req = snapshot.account.requirements
    if (req === null) return []
    if (req.currentlyDue.length === 0 && req.disabledReason === null) return []
    const detail =
      req.currentlyDue.length > 0
        ? `currently due: ${req.currentlyDue.join(', ')}`
        : `disabled reason: ${req.disabledReason}`
    return [
      buildFinding(ACCOUNT_REQUIREMENTS_DUE, {
        title: 'Account has outstanding requirements',
        description: `Stripe reports outstanding account requirements (${detail}). Unmet requirements can disable charges or payouts, interrupting revenue.`,
        remediation: 'Submit the outstanding requirements in the Stripe Dashboard before they disable the account.',
        docsUrl: DOCS.account,
        affectedResourceId: snapshot.account.id || null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** The security/account rule cluster, in stable order. Aggregated into ALL_RULES by `index.ts`. */
export const securityRules: Rule[] = [
  TEST_KEY_DETECTED_LIVE,
  LIVE_KEY_DETECTED_TEST,
  RESTRICTED_KEY_PERMISSION_PROBE,
  ACCOUNT_CHARGES_DISABLED,
  ACCOUNT_REQUIREMENTS_DUE,
]
