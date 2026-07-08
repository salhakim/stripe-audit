/**
 * stripe-audit — the pure, I/O-free baseline / anti-regression core.
 *
 * This is the anti-abandonment spine: it lets an adopter ACCEPT the current state
 * of their account as a baseline, then gate CI on **new** findings only (a
 * coverage-gate, not a score gate — a lower score with no new finding is NOT a
 * regression). Three pure functions, zero fs/path/http imports:
 *
 *   - {@link fingerprintFinding} — a stable sha256 identity for one finding.
 *   - {@link writeBaseline}      — snapshot the current result as a `Baseline` object.
 *   - {@link compareBaseline}    — diff the current active findings against a baseline.
 *
 * File-I/O (reading / writing the user-owned `baseline.json`) lives in the CLI
 * layer, NOT here — that split is what keeps the tool STATELESS (the
 * baseline file is user-owned, committed to the user's own git repo) and keeps
 * this module unit-testable without a tmp dir. The `AuditResult` import is
 * type-only, so this module never pulls in the Stripe SDK.
 *
 * Locked pipeline order: suppress → baseline → score. `writeBaseline`
 * and `compareBaseline` operate over the result's ACTIVE (post-suppression)
 * findings — the baseline never sees a suppressed finding.
 */
import { createHash } from 'node:crypto'
import { scoreFindings, type Grade } from './score'
import type { Finding } from './types'
import type { RuleFilter } from './engine'
import type { AuditResult } from './report/result'

/**
 * The sentinel a null/undefined resource field normalises to BEFORE hashing, so a
 * finding fingerprints identically run-to-run regardless of whether the field is
 * absent or an empty string. `ruleId` is always part of the digest, so two
 * account-level findings (both resource fields null) of DIFFERENT rules never
 * collide.
 */
const EMPTY_FIELD = ''

/**
 * A field separator that cannot occur inside a Stripe resource id, a resource
 * type, or a rule id (all `[A-Za-z0-9_.-]`). Joining the three components with it
 * makes the fingerprint genuinely collision-resistant — without it, `ruleId="AB" +
 * type="C"` and `ruleId="A" + type="BC"` would hash identically. The goal is
 * a collision-resistant fingerprint; a delimiter is how that goal is met.
 *
 * The separator is NUL (U+0000), written as the 6-char escape sequence — NEVER as a
 * raw byte, which would make git treat this file as binary (no diff/blame/merge).
 * This value is a COMPATIBILITY CONTRACT: changing it changes every fingerprint and
 * invalidates every user-owned baseline file. The pinned-vector test in
 * test/baseline.test.ts locks it; scripts/check-text-integrity.mjs guards the encoding.
 */
const FIELD_SEP = '\u0000'

/** A serialisable baseline snapshot — the shape written to / read from `baseline.json`. */
export interface Baseline {
  /** Pinned Stripe API version the baseline was captured under (`result.stripeApiVersion`). */
  apiVersion: string
  /** ISO-8601 timestamp the baseline was written. */
  createdAt: string
  /** 0–100 health score at capture time (`result.summary.score`). */
  score: number
  /** Letter grade at capture time (`result.summary.grade`). */
  grade: Grade
  /** Stable, sorted per-finding fingerprints of the ACTIVE findings at capture time. */
  fingerprints: string[]
  /**
   * The rule-filter scope the baseline was captured under. ABSENT on
   * an unfiltered capture — and on every baseline file written before this
   * field existed, which therefore
   * reads as unfiltered/full (back-compat is the absence, mirroring
   * `AuditResult.filter`). The CLI refuses to compare a run against a baseline
   * captured under a different scope ({@link sameFilterScope}).
   */
  filter?: RuleFilter
}

/** The result of diffing current active findings against a baseline. */
export interface BaselineComparison {
  /** Active findings whose fingerprint is ABSENT from the baseline (the new regressions). */
  newFindings: Finding[]
  /** Baseline fingerprints ABSENT from the current active set (now resolved), sorted. */
  resolvedFindings: string[]
  /** `currentScore − base.score`. Negative ⇒ the account got worse by score. */
  scoreDelta: number
  /** True iff at least one new finding appeared — coverage-gate / strictly-additive semantics. */
  regression: boolean
}

/**
 * A stable sha256 identity for one finding, hex-encoded.
 *
 * Hashes `ruleId + affectedResourceType + affectedResourceId` (each joined by a
 * non-occurring separator), normalising null/undefined resource fields to a fixed
 * sentinel first. Reads ONLY those three fields, so cosmetic finding changes
 * (a reworded title, a new impact estimate) never change the fingerprint — the
 * baseline stays stable across such edits, and the same finding fingerprints
 * identically run-to-run.
 */
export function fingerprintFinding(finding: Finding): string {
  const ruleId = finding.ruleId ?? EMPTY_FIELD
  const resourceType = finding.affectedResourceType ?? EMPTY_FIELD
  const resourceId = finding.affectedResourceId ?? EMPTY_FIELD
  const material = [ruleId, resourceType, resourceId].join(FIELD_SEP)
  return createHash('sha256').update(material).digest('hex')
}

/**
 * Snapshot the current audit result as a serialisable {@link Baseline}.
 *
 * Returns an object (NOT a file write — the CLI owns file-I/O). Fingerprints are
 * built from the result's ACTIVE findings only and sorted so the baseline file is
 * deterministic and diff-friendly. `createdAt` defaults to now; tests pass a fixed
 * value (E1) for stable snapshots, mirroring `buildAuditResult`'s `auditDate`
 * override.
 *
 * @param result    the assembled audit result (active findings + score/grade + api version)
 * @param createdAt ISO timestamp override; defaults to `new Date().toISOString()`
 */
export function writeBaseline(result: AuditResult, createdAt?: string): Baseline {
  const baseline: Baseline = {
    apiVersion: result.stripeApiVersion,
    createdAt: createdAt ?? new Date().toISOString(),
    score: result.summary.score,
    grade: result.summary.grade,
    fingerprints: result.findings.map(fingerprintFinding).sort(),
  }
  // Record the capture scope; key ABSENT when unfiltered (the same optional-block
  // contract as `AuditResult.filter`), so unfiltered baseline files are unchanged.
  if (result.filter) baseline.filter = result.filter
  return baseline
}

/** One filter axis normalized for comparison: sorted + deduped; an ABSENT list ⇒ undefined. */
function normalizeAxis(list?: readonly string[]): string[] | undefined {
  if (!list) return undefined
  return [...new Set(list)].sort()
}

/**
 * True when two optional filter scopes select the same rules. An
 * absent scope ≡ unfiltered/full (baseline files predating the filter field); each present axis
 * compares order- and duplicate-insensitively (sorted + deduped), so a
 * hand-edited baseline with re-ordered lists still matches.
 *
 * An EMPTY list is deliberately a DISTINCT scope, not unfiltered: the engine
 * treats `{severity: []}` as deselecting every rule (see issue #9), so
 * collapsing it to "no constraint" would let an effective-empty check pass
 * against an unfiltered baseline with every finding "resolved" — the exact
 * false-assurance hole this comparison exists to close.
 */
export function sameFilterScope(a?: RuleFilter, b?: RuleFilter): boolean {
  const axisEqual = (x?: string[], y?: string[]) =>
    x === undefined
      ? y === undefined
      : y !== undefined && x.length === y.length && x.every((value, i) => value === y[i])
  return (
    axisEqual(normalizeAxis(a?.severity), normalizeAxis(b?.severity)) &&
    axisEqual(normalizeAxis(a?.category), normalizeAxis(b?.category))
  )
}

/**
 * Diff the current ACTIVE findings against a {@link Baseline}.
 *
 * `newFindings` are active findings whose fingerprint is absent from the baseline;
 * `resolvedFindings` are baseline fingerprints absent from the current active set
 * (sorted, E3); `scoreDelta` is the current score minus the baseline score; and
 * `regression` is true iff there is at least one new finding. The gate is strictly
 * additive: a lower score with no new fingerprint is reported via `scoreDelta` but
 * does NOT set `regression` (a coverage gate fails on NEW gaps, not on noise).
 *
 * @param active the current ACTIVE (post-suppression) findings
 * @param base   the baseline to compare against
 */
export function compareBaseline(active: readonly Finding[], base: Baseline): BaselineComparison {
  const baseFingerprints = new Set(base.fingerprints)
  const activeFingerprints = new Set(active.map(fingerprintFinding))

  const newFindings = active.filter((finding) => !baseFingerprints.has(fingerprintFinding(finding)))
  const resolvedFindings = base.fingerprints
    .filter((fingerprint) => !activeFingerprints.has(fingerprint))
    .sort()
  const scoreDelta = scoreFindings(active).score - base.score
  const regression = newFindings.length > 0

  return { newFindings, resolvedFindings, scoreDelta, regression }
}
