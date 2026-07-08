/**
 * stripe-audit-plugin-example — a reference stripe-audit plugin.
 *
 * This is what an EXTERNAL plugin author writes against the published `stripe-audit`
 * package. It imports ONLY from the public barrel (`stripe-audit`, which in this repo
 * is `src/index.ts`) — never a deep internal path (the internal rules, engine, or
 * fetcher modules).
 * Everything it needs — `defineRule`, `CORE_API_VERSION`, and the `Rule` / `Finding` /
 * `StripeAccountSnapshot` contract types — is on that barrel.
 *
 * A plugin is a module that default-exports a **manifest**: the documented convention
 *
 *     { meta: { name, version, apiVersion }, rules: Rule[] }
 *
 * The host consumes it through `resolveRules({ plugins: [{ key, rules }] })`, bridging
 * `key = meta.name` (see `docs/writing-plugins.md` and the integration test in
 * `test/integration/plugin-example.test.ts`). `meta.apiVersion` is pinned to the host's
 * `CORE_API_VERSION` so the plugin declares which major contract it was built against;
 * the contract is append-only within a major, so this plugin keeps working across every
 * minor host release.
 */
import { defineRule, CORE_API_VERSION } from '../../src/index'
import type { Finding, Rule, StripeAccountSnapshot } from '../../src/index'

/**
 * The Plugin manifest convention. There is intentionally no exported `Plugin` type on
 * the host — the manifest is a plain shape a plugin agrees to, and the host only ever
 * reads `meta.name` (→ the resolve key) and `rules`. Authors may declare it locally
 * like this for their own type-safety.
 */
export interface PluginManifest {
  meta: { name: string; version: string; apiVersion: number }
  rules: Rule[]
}

/**
 * Example rule: flag an account with no card statement descriptor.
 *
 * A blank statement descriptor means customers see a cryptic charge on their card
 * statement, which drives avoidable disputes and chargebacks — a revenue leak, exactly
 * the class of misconfiguration stripe-audit exists to catch. The rule is a pure
 * `check(snapshot) => Finding[]`, requires the `account` region (non-empty `requires`
 * is mandatory — `resolveRules` rejects an empty one fail-loud), and builds its
 * `Finding` as a plain object literal against the public `Finding` type (an external
 * author has no access to the host's internal finding factory).
 */
export const STATEMENT_DESCRIPTOR_MISSING: Rule = defineRule({
  id: 'STATEMENT_DESCRIPTOR_MISSING',
  name: 'No card statement descriptor configured',
  severity: 'medium',
  category: 'configuration',
  requires: ['account'],
  check: (snapshot: StripeAccountSnapshot): Finding[] => {
    const descriptor = snapshot.account.statementDescriptor
    if (descriptor !== null && descriptor.trim().length > 0) return []
    return [
      {
        ruleId: 'STATEMENT_DESCRIPTOR_MISSING',
        severity: 'medium',
        category: 'configuration',
        title: 'No card statement descriptor configured',
        affectedResourceId: snapshot.account.id,
        affectedResourceType: 'account',
        description:
          'The account has no statement descriptor, so charges appear on customers’ card statements with a generic or unrecognizable label. Unrecognized charges are a leading cause of disputes and chargebacks.',
        remediation:
          'Set a clear, recognizable statement descriptor (your brand name) in the Stripe Dashboard under Settings → Public details.',
        docsUrl: 'https://docs.stripe.com/get-started/account/statement-descriptors',
        estimatedImpact: 'Unrecognized charges drive disputes/chargebacks that cost fees and lost revenue.',
      },
    ]
  },
})

/**
 * The plugin manifest — the module's default export. `meta.name` becomes the resolve
 * `key` (so every rule resolves under `acme-billing-checks/<RULE_ID>`), and
 * `meta.apiVersion` pins the host contract major this plugin was built against.
 */
const plugin: PluginManifest = {
  meta: {
    name: 'acme-billing-checks',
    version: '0.1.0',
    apiVersion: CORE_API_VERSION,
  },
  rules: [STATEMENT_DESCRIPTOR_MISSING],
}

export default plugin
