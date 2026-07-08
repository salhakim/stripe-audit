/**
 * stripe-audit — the canonical audit-result shape + its assembler.
 *
 * `AuditResult` is the machine-readable shape every reporter derives from: the
 * JSON reporter serializes it verbatim, and the Markdown / HTML / console
 * reporters render views of it. Assembling it in ONE place (`buildAuditResult`)
 * is the single seam later features plug into — `applySuppressions` feeds
 * the `suppressed` list, `compareBaseline` feeds the optional `baseline`
 * block — so the four reporters never drift on what "the result" contains.
 *
 * The score/grade live on `summary` and are computed over ACTIVE findings only
 * (see `docs/scoring.md`): suppressed findings and skipped (deep, unrun) rules
 * are excluded from the score and the `rulesPassed` tally — a skipped rule is
 * never a passed rule.
 */
import { VERSION } from '../version'
import { STRIPE_API_VERSION } from '../stripe-client'
import { scoreFindings, type Grade } from '../score'
import type { Finding, RuleScope, Severity, StripeAccountSnapshot } from '../types'
import type { RuleFilter, RunResult, SkippedRule } from '../engine'

/** The severity tally + run/score rollup every reporter header renders. */
export interface AuditSummary {
  critical: number
  high: number
  medium: number
  low: number
  info: number
  /** Active findings total (`critical + high + medium + low + info`). */
  total: number
  /** Rules that actually ran (catalog size − skipped). */
  rulesRun: number
  /**
   * Rules that ran and produced no finding — active OR suppressed. Skipped rules
   * are NOT counted as passed, and neither is a rule whose findings were all
   * suppressed (it fired; it is surfaced in the Suppressed(N) tally).
   */
  rulesPassed: number
  /** 0–100 health score over active findings ({@link scoreFindings}). */
  score: number
  /** Letter grade for {@link score}. */
  grade: Grade
  /** Count of separately-suppressed findings. Always present; 0 when none. */
  suppressed: number
}

/**
 * The optional baseline-comparison block. Present only when a baseline was
 * supplied; omitted entirely from the result otherwise.
 *
 * Structurally identical to `compareBaseline`'s return (`src/baseline.ts`): the
 * CLI feeds that comparison straight in. `newFindings` are the full findings that
 * appeared vs the baseline (so a JSON consumer can render them); `resolvedFindings`
 * are the baseline fingerprints that are now gone (sorted). `regression` is
 * strictly additive — true iff `newFindings` is non-empty (a lower `scoreDelta`
 * with no new finding is NOT a regression).
 */
export interface BaselineDelta {
  newFindings: Finding[]
  resolvedFindings: string[]
  scoreDelta: number
  regression: boolean
}

/** The canonical, machine-readable audit result the JSON reporter emits verbatim. */
export interface AuditResult {
  /** Package version that produced the audit. */
  version: string
  /** Pinned Stripe API version (`STRIPE_API_VERSION`, e.g. `2026-06-24.dahlia`). */
  stripeApiVersion: string
  /** Key mode the snapshot was read under. */
  accountMode: 'test' | 'live'
  /** ISO-8601 timestamp the result was assembled. */
  auditDate: string
  summary: AuditSummary
  /** Active findings (suppressed excluded), each a full {@link Finding}. */
  findings: Finding[]
  /** Deep rules that were not run, each with its reason. */
  skipped: SkippedRule[]
  /**
   * List regions whose fetch hit the `MAX_LIST_ITEMS` cap and were truncated
   * (carried from {@link StripeAccountSnapshot.truncated}). Empty when nothing
   * was capped. Reporters surface a non-empty list as a PARTIAL audit so a large
   * catalog (e.g. >10k prices) is never silently under-audited — a sibling of the
   * `skipped` / `suppressed` no-false-assurance signals. The score reflects only
   * the data that WAS read, so a non-empty list qualifies the grade.
   */
  truncated: RuleScope[]
  /**
   * The rule filter the run executed under (`--severity` / `--category`), lists
   * normalized (sorted + deduped) by the CLI. Present ONLY when a filter was
   * active — the key is ABSENT on an unfiltered run (the `baseline?`
   * optional-block contract), so unfiltered results stay byte-identical.
   * Reporters surface it so a filtered run can never present as a full audit.
   */
  filter?: RuleFilter
  /** Baseline delta — present only when a baseline was supplied. */
  baseline?: BaselineDelta
}

/** Options for {@link buildAuditResult}. The suppression/baseline seam lives here. */
export interface BuildAuditResultOptions {
  /** Total rules CONSIDERED in the run (catalog size). `rulesRun = rulesTotal − skipped`. */
  rulesTotal: number
  /**
   * Findings the user suppressed. Counted in `summary.suppressed`; never
   * scored. Defaults to none when no suppressions are configured.
   */
  suppressed?: readonly Finding[]
  /** The active rule filter; omitted from the result when null/undefined. */
  filter?: RuleFilter | null
  /** Baseline delta; omitted from the result when null/undefined. */
  baseline?: BaselineDelta | null
  /** ISO timestamp override; defaults to `now`. Tests pass a fixed value for stable snapshots. */
  auditDate?: string
}

/** A fresh zeroed severity tally. */
function zeroCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 }
}

/**
 * Assemble the canonical {@link AuditResult} from a run.
 *
 * `run.findings` is treated as the ACTIVE set (the engine applies no
 * suppression, so every emitted finding is active; suppression passes the post-suppression
 * active subset). The score and severity tally are computed over those active
 * findings; `summary.suppressed` reflects `opts.suppressed.length`.
 *
 * @param snapshot the audited account view (supplies `accountMode`)
 * @param run      the engine result (`{ findings, skipped }`)
 * @param opts     catalog size + the suppression/baseline seams + an optional date override
 */
export function buildAuditResult(
  snapshot: StripeAccountSnapshot,
  run: RunResult,
  opts: BuildAuditResultOptions,
): AuditResult {
  const active = run.findings
  const suppressed = opts.suppressed ?? []

  const counts = zeroCounts()
  for (const finding of active) counts[finding.severity]++

  const score = scoreFindings(active)
  const rulesRun = Math.max(0, opts.rulesTotal - run.skipped.length)
  // "Fired" spans active ∪ suppressed: a rule whose findings were ALL
  // suppressed still fired — it is neither passed nor active, surfaced only in
  // the Suppressed(N) tally (the docs/scoring.md invariant). Counting only the
  // active set silently bumped rulesPassed on full suppression.
  const distinctFired = new Set([...active, ...suppressed].map((f) => f.ruleId)).size
  const rulesPassed = Math.max(0, rulesRun - distinctFired)

  const summary: AuditSummary = {
    critical: counts.critical,
    high: counts.high,
    medium: counts.medium,
    low: counts.low,
    info: counts.info,
    total: active.length,
    rulesRun,
    rulesPassed,
    score: score.score,
    grade: score.grade,
    suppressed: suppressed.length,
  }

  const result: AuditResult = {
    version: VERSION,
    stripeApiVersion: STRIPE_API_VERSION,
    accountMode: snapshot.accountMode,
    auditDate: opts.auditDate ?? new Date().toISOString(),
    summary,
    findings: active,
    skipped: run.skipped,
    // A snapshot fact (which list regions overflowed the fetch cap), carried
    // straight through like `accountMode` — never a suppression/baseline seam.
    truncated: snapshot.truncated,
  }
  // Omit the filter/baseline keys entirely when absent (the "optional block"
  // contract) — an unfiltered result stays byte-identical to pre-filter builds.
  if (opts.filter) result.filter = opts.filter
  if (opts.baseline) result.baseline = opts.baseline
  return result
}

/**
 * Human-readable description of an active {@link AuditResult.filter}, e.g.
 * `severity=low` or `severity=low, category=billing`. Shared by the console /
 * Markdown / HTML coverage lines so the reporters cannot drift on how a
 * filtered run is labelled. The lists carry only validated enum tokens (never
 * account-derived text), so the output needs no escaping.
 */
export function describeFilter(filter: RuleFilter): string {
  const parts: string[] = []
  if (filter.severity && filter.severity.length > 0) parts.push(`severity=${filter.severity.join(',')}`)
  if (filter.category && filter.category.length > 0) parts.push(`category=${filter.category.join(',')}`)
  return parts.join(', ')
}
