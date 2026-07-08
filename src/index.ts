/**
 * stripe-audit — public API barrel.
 *
 * This module IS the v0.2 plugin contract surface. Everything a plugin author or
 * downstream consumer needs is re-exported here from its single source of truth:
 * the contract types live in `./types`, the pinned API version in
 * `./stripe-client`. Nothing is re-declared — there is no two-literal drift.
 */
/** Package version, single-sourced in `./version` (re-exported here for the barrel). */
export { VERSION } from './version'

/**
 * The single pinned Stripe API version, re-exported from its canonical home
 * (`./stripe-client`). Re-exported — never re-declared — so the literal lives in
 * exactly one place and a future SDK bump only has to change one line.
 */
export { STRIPE_API_VERSION } from './stripe-client'

/**
 * The core plugin contract types, single-sourced in `./types`:
 * - `Rule` / `Finding` — the rule-author contract (a rule is a pure
 *   `check(snapshot) => Finding[]`).
 * - `Severity` / `Category` — the finding taxonomy.
 * - `RuleScope` — the data regions a rule may require (base-6 + deep-5); needed
 *   to type `Rule.requires` when authoring rules.
 * - `StripeAccountSnapshot` — the read-only account view every rule receives.
 */
export type { Rule, Finding, StripeAccountSnapshot } from './types'
export type { Severity, Category, RuleScope } from './types'

/**
 * The deterministic audit score spine: `scoreFindings(activeFindings)`
 * → `{ score, grade, worstSeverity }`, computed over ACTIVE findings only.
 * Re-exported here so plugin authors and the reporters share one scoring source.
 */
export { scoreFindings, gradeForScore, SEVERITY_PENALTY, GRADE_BANDS } from './score'
export type { ScoreResult, Grade } from './score'

/**
 * The reporter surface: the canonical {@link AuditResult} shape, its
 * assembler `buildAuditResult`, and the pure `(AuditResult) -> string` reporters
 * (JSON, Markdown, HTML, and console).
 * Re-exported so downstream tooling builds and renders audit results from the
 * package barrel.
 */
export {
  buildAuditResult,
  renderReport,
  renderJson,
  renderMarkdown,
  renderHtml,
  renderConsole,
  stripAnsi,
  isOutputFormat,
  OUTPUT_FORMATS,
} from './report'
export type {
  AuditResult,
  AuditSummary,
  BaselineDelta,
  BuildAuditResultOptions,
  OutputFormat,
} from './report'

/**
 * Finding suppression: the pure `applyIgnore(findings, lines)` partition
 * into `{ active, suppressed, unmatched }`, its `Suppression` shape, and the
 * `.stripeauditignore` loader. Re-exported so downstream tooling can apply the
 * same canonical suppression filter the CLI uses.
 */
export { applyIgnore, parseSuppression, loadIgnoreFile } from './suppress'
export type { Suppression, IgnoreResult } from './suppress'

/**
 * The CLI exit-code contract: the 0/1/2/3 constants, the `--fail-on`
 * vocabulary, and the pure `exitCodeForFindings` gate. Re-exported so a downstream
 * harness can reproduce the CLI's exit decision over an audit result.
 */
export {
  EXIT_OK,
  EXIT_FINDINGS,
  EXIT_CONFIG,
  EXIT_RUNTIME,
  FAIL_ON_LEVELS,
  DEFAULT_FAIL_ON,
  isFailOnLevel,
  exitCodeForFindings,
} from './exit-codes'
export type { FailOnLevel } from './exit-codes'

/**
 * Restricted-key creation deep link: the stable dashboard URL + the exact
 * 6 read scopes a base audit needs. Re-exported so the same least-privilege
 * guidance the CLI renders is available to downstream tooling.
 */
export {
  buildRestrictedKeyLink,
  buildDeepRestrictedKeyLink,
  RESTRICTED_KEY_READ_SCOPES,
  DEEP_SCOPE_PARAMS,
  DASHBOARD_APIKEYS_URL,
} from './deep-link'
export type { RestrictedKeyLink } from './deep-link'

/**
 * Plain-language Stripe error translation: turns a caught auth /
 * permission / transport error into key-safe copy + the restricted-key deep link.
 * Re-exported so downstream tooling can reuse the same translation on the live path.
 */
export { translateStripeError } from './errors'

/**
 * The major version of the plugin contract (Rule / Finding / RuleScope shape).
 *
 * The contract is append-only within a major: a plugin pinned to
 * `CORE_API_VERSION === 1` keeps working across every minor release; a breaking
 * change to the contract bumps this to `2`.
 */
export const CORE_API_VERSION = 1

/**
 * Identity helper for authoring a rule with full type-checking and inference
 * (`defineRule({...})`). Single-sourced in `./define-rule` — a leaf module the rule
 * clusters import directly, so re-exporting it here (rather than declaring it here)
 * keeps the rule graph off the barrel and avoids a rules→barrel import cycle now that
 * the barrel re-exports `resolveRules`. See the note in `./define-rule`.
 */
export { defineRule } from './define-rule'

/**
 * The plugin injection seam: `resolveRules` merges the core rule catalog
 * with namespaced plugin rules and returns the unified `Rule[]`. Re-exported here
 * — additive, append-only within `CORE_API_VERSION` major 1, no signature change —
 * so a downstream host can wire `defineRule` plugins through the SAME merge path the
 * CLI uses: `resolveRules({ plugins: [{ key, rules }] })`.
 *
 * A plugin rule's effective id is `${key}/${rule.id}`; core ids are never rewritten
 * and never carry a `/`, so a plugin can never shadow a core rule. A duplicate
 * effective id (or a plugin rule with an empty `requires`) is FAIL-LOUD:
 * `resolveRules` throws {@link RuleResolutionError}, which carries the CLI exit code
 * {@link CONFIG_USAGE_EXIT} — never a silent de-dupe or last-wins.
 *
 * The engine runner (`runRules`) stays non-public: a plugin author exercises a rule
 * through its own `rule.check(snapshot)` contract (see the reference plugin under
 * `examples/stripe-audit-plugin-example/`).
 */
export { resolveRules, RuleResolutionError, CONFIG_USAGE_EXIT } from './config/resolve-rules'
export type { PluginRuleSet, ResolveRulesConfig } from './config/resolve-rules'
