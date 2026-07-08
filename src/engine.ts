/**
 * stripe-audit — rule engine.
 *
 * `runRules` is the pure core of the audit: snapshot + rules → findings. It is
 * the walking skeleton that proves the snapshot/rule contract end-to-end.
 *
 * Three outcome buckets (the breaking shape landed pre-publish):
 *   - `findings`  — what every passing rule emitted, plus a synthetic `info`
 *                   finding for any rule whose `check()` threw (error containment).
 *   - `skipped`   — deep rules that could not be evaluated under the current scope.
 *
 * A skipped rule is NOT a passed rule: it produces no finding and contributes no
 * false assurance. The score counts only RUN rules.
 */
import type {
  StripeAccountSnapshot,
  Rule,
  Finding,
  Severity,
  Category,
  RuleScope,
} from './types'
import { SEVERITIES, CATEGORIES } from './types'

/** The deep-5 regions — a rule requiring any of these is a "deep" rule. */
const DEEP_SCOPES: ReadonlySet<RuleScope> = new Set<RuleScope>([
  'subscriptions',
  'radar',
  'meters',
  'event_destinations',
  'coupons',
])

/** Why a deep rule was not run. `skipped` is distinct from `passed`. */
export type SkipReason = 'requires-deep' | 'deep-scope-not-granted'

/** A rule that was not evaluated, with the reason it was held back. */
export interface SkippedRule {
  ruleId: string
  reason: SkipReason
}

/** Optional include-filters applied before a rule is considered. */
export interface RuleFilter {
  severity?: Severity[]
  category?: Category[]
}

/** The engine's result — findings emitted plus the rules deliberately skipped. */
export interface RunResult {
  findings: Finding[]
  skipped: SkippedRule[]
}

/** A rule is deep iff any region it requires is one of the deep-5. Derived, never stored. */
export function isDeepRule(rule: Rule): boolean {
  return rule.requires.some((scope) => DEEP_SCOPES.has(scope))
}

/** True when the key granted `scope` per the snapshot's scopeProbe (absent ⇒ not granted). */
function isScopeGranted(snapshot: StripeAccountSnapshot, scope: RuleScope): boolean {
  const grant = snapshot.scopeProbe.find((g) => g.scope === scope)
  return grant?.granted ?? false
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Derived from the canonical value arrays in types.ts (the unions are typed off
// those arrays), so the chokepoint's vocabulary can never drift from the types.
const VALID_SEVERITIES: ReadonlySet<string> = new Set(SEVERITIES)
const VALID_CATEGORIES: ReadonlySet<string> = new Set(CATEGORIES)

/**
 * Why a rule-returned value fails the Finding contract, in plain language —
 * or null when it is a valid finding. This is the shape chokepoint: plugin
 * rules return arbitrary values at runtime (the compile-time contract cannot
 * bind them), and a malformed finding must never reach score/reporters where
 * it surfaces as a NaN score or a raw TypeError.
 */
function findingShapeError(candidate: unknown): string | null {
  if (typeof candidate !== 'object' || candidate === null) return 'the finding is not an object'
  const f = candidate as Record<string, unknown>
  if (typeof f.severity !== 'string' || !VALID_SEVERITIES.has(f.severity))
    return `"severity" is ${JSON.stringify(f.severity) ?? 'undefined'} (expected one of: ${[...VALID_SEVERITIES].join(', ')})`
  if (typeof f.category !== 'string' || !VALID_CATEGORIES.has(f.category))
    return `"category" is ${JSON.stringify(f.category) ?? 'undefined'} (expected one of: ${[...VALID_CATEGORIES].join(', ')})`
  if (typeof f.title !== 'string' || f.title.length === 0) return '"title" is missing or empty'
  if (typeof f.description !== 'string') return '"description" is missing'
  if (typeof f.remediation !== 'string') return '"remediation" is missing'
  if (typeof f.docsUrl !== 'string') return '"docsUrl" is missing'
  if (!(f.affectedResourceId === null || typeof f.affectedResourceId === 'string'))
    return '"affectedResourceId" must be a string or null'
  if (typeof f.affectedResourceType !== 'string' || f.affectedResourceType.length === 0)
    return '"affectedResourceType" is missing or empty'
  if (f.estimatedImpact !== undefined && typeof f.estimatedImpact !== 'string')
    return '"estimatedImpact" must be a string when present'
  return null
}

/**
 * The synthetic finding emitted when a rule returns a malformed finding — the
 * shape chokepoint's containment path. Plain language naming the offending
 * rule; the malformed object itself is dropped, never rendered.
 */
function malformedFindingFinding(rule: Rule, why: string): Finding {
  return {
    ruleId: rule.id,
    severity: 'info',
    category: rule.category,
    title: `Rule "${rule.name}" returned a malformed finding`,
    affectedResourceId: null,
    affectedResourceType: 'rule',
    description: `The rule returned a finding that does not match the Finding contract — ${why}. The malformed finding was skipped.`,
    remediation:
      'Fix the rule to return complete Finding objects (see docs/writing-plugins.md for the contract).',
    docsUrl: '',
  }
}

/** The synthetic finding emitted when a rule's `check()` throws (error containment). */
function ruleErrorFinding(rule: Rule, err: unknown): Finding {
  return {
    ruleId: rule.id,
    severity: 'info',
    category: rule.category,
    title: `Rule "${rule.name}" failed to run`,
    affectedResourceId: null,
    affectedResourceType: 'rule',
    description: `The rule threw during evaluation and was skipped: ${errorMessage(err)}`,
    remediation: 'This is an internal audit error — please report it with the rule id.',
    docsUrl: '',
  }
}

/**
 * Evaluate `rules` against `snapshot`, returning findings + skipped rules.
 *
 * @param snapshot the account view to audit
 * @param rules    the rules to run (defaults to none — a no-rule run is valid)
 * @param filter   optional severity/category include-filters; a rule must match
 *                 every present filter list to be considered
 *
 * Deep rules are skipped (not run, not passed) when the snapshot is base-mode
 * (`requires-deep`) or a required deep region was not granted by the key
 * (`deep-scope-not-granted`). Every other rule runs inside a try/catch so one
 * throwing rule can never abort the audit.
 */
export function runRules(
  snapshot: StripeAccountSnapshot,
  rules: Rule[] = [],
  filter?: RuleFilter,
): RunResult {
  const findings: Finding[] = []
  const skipped: SkippedRule[] = []

  for (const rule of rules) {
    // Include-filters: skip silently (not "skipped" — just not selected).
    if (filter?.severity && !filter.severity.includes(rule.severity)) continue
    if (filter?.category && !filter.category.includes(rule.category)) continue

    // Deep-scope gating — skipped ≠ passed.
    if (isDeepRule(rule)) {
      if (snapshot.auditScope === 'base') {
        skipped.push({ ruleId: rule.id, reason: 'requires-deep' })
        continue
      }
      const missingScope = rule.requires.some(
        (scope) => DEEP_SCOPES.has(scope) && !isScopeGranted(snapshot, scope),
      )
      if (missingScope) {
        skipped.push({ ruleId: rule.id, reason: 'deep-scope-not-granted' })
        continue
      }
    }

    // Per-rule error containment: a throwing check() becomes an info finding.
    // Provenance chokepoint: every finding is stamped with the
    // RESOLVED rule id — for a plugin rule that is the namespaced
    // `pluginKey/RULE_ID`, so a plugin finding is always attributable in
    // reports/suppressions and can never masquerade as a core finding by
    // returning a core rule's id. Core rules are unchanged (their checks
    // already return their own id).
    //
    // Shape chokepoint at the same seam: each returned finding is validated
    // against the Finding contract before it can reach score/reporters. A
    // malformed finding (e.g. a spread of null) becomes a plain-language info
    // finding naming the rule — never a NaN score or a raw TypeError downstream.
    try {
      for (const candidate of rule.check(snapshot)) {
        const shapeError = findingShapeError(candidate)
        if (shapeError !== null) {
          findings.push(malformedFindingFinding(rule, shapeError))
          continue
        }
        findings.push({ ...(candidate as Finding), ruleId: rule.id })
      }
    } catch (err) {
      findings.push(ruleErrorFinding(rule, err))
    }
  }

  return { findings, skipped }
}
