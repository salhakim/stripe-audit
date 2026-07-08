/**
 * stripe-audit — the `defineRule` identity helper (leaf module).
 *
 * This lives in its own leaf module (it imports ONLY the `Rule` type, which is itself
 * a leaf) so the rule clusters can import `defineRule` without importing the public
 * barrel `./index`. The barrel re-exports `resolveRules`, which pulls the whole rule
 * catalog; if the rule clusters imported `defineRule` from the barrel instead of from
 * here, that would form a rules→barrel→rules import cycle and a rule module evaluated
 * as an entry point would spread a not-yet-initialized catalog. Keeping `defineRule`
 * here breaks that cycle at its source. The barrel re-exports `defineRule` from this
 * module, so the public contract (`import { defineRule } from 'stripe-audit'`) is
 * unchanged.
 */
import type { Rule } from './types'

/**
 * Identity helper for authoring a rule with full type-checking and inference.
 *
 * Wrapping a rule literal in `defineRule({...})` gives editor completion and
 * compile-time checking of `requires` / `severity` / `category` / `check` against the
 * {@link Rule} contract, with zero runtime cost — it returns its argument unchanged.
 *
 * @example
 * const myRule = defineRule({
 *   id: 'WEBHOOK_NONE',
 *   name: 'No webhook endpoints configured',
 *   severity: 'high',
 *   category: 'webhooks',
 *   requires: ['webhook_endpoints'],
 *   check: (snapshot) => (snapshot.webhookEndpoints.length === 0 ? buildFindings() : []),
 * })
 */
export const defineRule = (rule: Rule): Rule => rule
