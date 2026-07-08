/**
 * stripe-audit — deterministic audit score + letter grade.
 *
 * `scoreFindings` reduces the ACTIVE findings of an audit to a single 0–100
 * score, an A–F letter grade, and the worst severity present. It is the shared
 * spine every reporter header renders: the JSON summary, the Markdown
 * header, the HTML header, and the console one-liner.
 * Pure: no network, no key, no randomness — the same `Finding[]` always yields
 * the same result.
 *
 * Scope rule (documented in `docs/scoring.md`): the score is computed over
 * ACTIVE findings ONLY. Suppressed findings and skipped — deep, unrun —
 * rules are NEVER inputs: a skipped rule is not a passed rule, so it can
 * neither raise nor lower the score (no false assurance). The caller passes the
 * post-suppression active list; this function only ever sees `severity`.
 */
import type { Finding, Severity } from './types'

/** Letter grade bands over the 0–100 score. */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F'

/** The deterministic score result every reporter header renders. */
export interface ScoreResult {
  /** 0–100, higher is healthier. 100 ⇔ zero active findings. */
  score: number
  /** Letter grade derived from {@link score} via {@link GRADE_BANDS}. */
  grade: Grade
  /** The highest-ranked severity among the active findings, or null when none. */
  worstSeverity: Severity | null
}

/**
 * Per-finding score deduction by severity. A higher severity deducts more, so
 * adding a higher-severity finding can never raise the score (monotonicity).
 * `info` deducts 0 — info findings are non-actionable notes, not health problems,
 * so they surface in {@link ScoreResult.worstSeverity} without moving the score.
 */
export const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 25,
  high: 10,
  medium: 4,
  low: 1,
  info: 0,
}

/** Severity rank, lower = worse. Drives the {@link ScoreResult.worstSeverity} pick. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

/**
 * Grade bands, ordered high → low: the first band whose `min` floor the score
 * meets wins. Standard report-card cutoffs (A ≥ 90 … F < 60).
 */
export const GRADE_BANDS: readonly { min: number; grade: Grade }[] = [
  { min: 90, grade: 'A' },
  { min: 80, grade: 'B' },
  { min: 70, grade: 'C' },
  { min: 60, grade: 'D' },
  { min: 0, grade: 'F' },
]

/** Map a 0–100 score to its letter grade via {@link GRADE_BANDS}. */
export function gradeForScore(score: number): Grade {
  for (const band of GRADE_BANDS) {
    if (score >= band.min) return band.grade
  }
  return 'F'
}

/**
 * Reduce ACTIVE findings to a deterministic `{ score, grade, worstSeverity }`.
 *
 * Score starts at 100 and deducts {@link SEVERITY_PENALTY} per finding, clamped
 * to `[0, 100]`. Zero findings ⇒ `100 / 'A' / null`. Reads ONLY each finding's
 * `severity`, so suppressed/skipped exclusion is the caller's contract — this
 * never sees those entries.
 *
 * @param activeFindings post-suppression active findings (skipped rules excluded)
 */
export function scoreFindings(activeFindings: readonly Pick<Finding, 'severity'>[]): ScoreResult {
  let deductions = 0
  let worstRank = Number.POSITIVE_INFINITY
  let worstSeverity: Severity | null = null

  for (const finding of activeFindings) {
    deductions += SEVERITY_PENALTY[finding.severity]
    const rank = SEVERITY_RANK[finding.severity]
    if (rank < worstRank) {
      worstRank = rank
      worstSeverity = finding.severity
    }
  }

  const score = Math.max(0, Math.min(100, 100 - deductions))
  return { score, grade: gradeForScore(score), worstSeverity }
}
