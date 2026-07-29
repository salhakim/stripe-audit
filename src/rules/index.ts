/**
 * stripe-audit — rule catalog aggregation.
 *
 * `ALL_RULES` is the full core catalog: every cluster's rules in a stable
 * order. `RULE_MAP` is the id→rule lookup (spec §3.5). Both are consumed by the CLI
 * (`--list-rules`), the engine, and `resolveRules`, which merges plugin
 * rules on top of `ALL_RULES`.
 *
 * Every core rule id is bare `UPPER_SNAKE` with no `/` (the `/` namespace separator
 * is reserved for plugin rules). Base clusters require only base regions; the deep
 * clusters require ≥1 deep region and derive to deep tier, so base-mode runs
 * SKIP them — both halves asserted by the catalog-invariants meta-test.
 */
import type { Rule } from '../types'
import { isDeepRule } from '../engine'
import { webhookRules } from './webhooks'
import { portalRules } from './portal'
import { pricingRules } from './pricing'
import { configurationRules } from './configuration'
import { securityRules } from './security'
import { billingModeRules } from './billing-mode'
import { subscriptionRules } from './subscriptions'
import { meterErrorRules } from './meter-error'
import { couponRules } from './coupons'

/** The full core rule catalog, in stable cluster order (deep clusters last). */
export const ALL_RULES: Rule[] = [
  ...webhookRules,
  ...portalRules,
  ...pricingRules,
  ...configurationRules,
  ...securityRules,
  ...billingModeRules,
  ...subscriptionRules,
  ...meterErrorRules,
  ...couponRules,
]

/** id → Rule lookup over {@link ALL_RULES} (spec §3.5). */
export const RULE_MAP: ReadonlyMap<string, Rule> = new Map(ALL_RULES.map((rule) => [rule.id, rule]))

/**
 * The deep (`--deep`-only) slice of the catalog — DERIVED, never hand-listed.
 * A rule is deep iff `isDeepRule` says so; this export can never drift from
 * the registry.
 */
export const deepRules: Rule[] = ALL_RULES.filter(isDeepRule)
