/**
 * stripe-audit — rule resolution.
 *
 * `resolveRules` merges the core {@link ALL_RULES} catalog with any namespaced
 * plugin rules and returns the unified `Rule[]` that is fed UNCHANGED to the
 * engine's existing `runRules(snapshot, rules)` 2nd argument — the engine signature
 * does not change; this is the plugin injection point (spec §3.5).
 *
 * Namespacing: a plugin rule's effective id is `${pluginKey}/${rule.id}`. Core rule
 * ids are NEVER rewritten and never carry a `/` (a meta-test asserts this),
 * so a plugin can never shadow a core id and a finding's origin stays legible.
 *
 * Collision is FAIL-LOUD: if two resolved rules share an effective id, resolveRules
 * throws {@link RuleResolutionError} (exit code {@link CONFIG_USAGE_EXIT}) naming the
 * id. It NEVER silently de-dupes or last-wins — a silent shadow could let a plugin
 * mask a core revenue rule, the exact false assurance this layer forbids.
 *
 * Default (zero plugins) → exactly `ALL_RULES` (same length, same ids): the plugin-free
 * JSON config form registers no plugin module, so the default audit is core-only.
 */
import type { Rule } from '../types'
import { ALL_RULES } from '../rules/index'

/** A plugin's rules plus the key that namespaces them. */
export interface PluginRuleSet {
  /** The plugin key — prefixes every rule id as `${key}/${rule.id}`. */
  key: string
  rules: Rule[]
}

/** The slice of resolved config `resolveRules` reads. */
export interface ResolveRulesConfig {
  plugins?: PluginRuleSet[]
}

/** Exit code a CLI should surface when `resolveRules` throws (spec's config/usage error). */
export const CONFIG_USAGE_EXIT = 2

/** Fail-loud error for an unresolvable rule set. Carries the CLI exit code to use. */
export class RuleResolutionError extends Error {
  readonly exitCode = CONFIG_USAGE_EXIT
  constructor(message: string) {
    super(message)
    this.name = 'RuleResolutionError'
  }
}

/**
 * Resolve the effective rule set: core `ALL_RULES` + namespaced plugin rules.
 *
 * @throws {RuleResolutionError} on a plugin rule with an empty `requires`, or on any
 *   duplicate effective id (collision). Both are fail-loud — never silent.
 */
export function resolveRules(config: ResolveRulesConfig = {}): Rule[] {
  // Core ids are never rewritten — start from the catalog as-is.
  const resolved: Rule[] = [...ALL_RULES]

  for (const plugin of config.plugins ?? []) {
    for (const rule of plugin.rules) {
      const effectiveId = `${plugin.key}/${rule.id}`
      // The Rule contract (incl. a non-empty requires) applies uniformly to plugin
      // rules — so the no-slash-in-core-ids invariant and the --deep gate treat them identically.
      if (!Array.isArray(rule.requires) || rule.requires.length === 0) {
        throw new RuleResolutionError(
          `Plugin rule "${effectiveId}" declares an empty requires — every rule must require at least one RuleScope.`,
        )
      }
      resolved.push({ ...rule, id: effectiveId })
    }
  }

  // Fail-loud collision gate — never silent de-dupe / last-wins.
  const seen = new Set<string>()
  for (const rule of resolved) {
    if (seen.has(rule.id)) {
      throw new RuleResolutionError(
        `Rule id collision: "${rule.id}" is defined more than once. ` +
          `Resolve the conflict — stripe-audit never silently de-dupes or last-wins.`,
      )
    }
    seen.add(rule.id)
  }

  return resolved
}
