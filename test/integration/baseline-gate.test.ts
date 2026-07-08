import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runRules } from '../../src/engine'
import { ALL_RULES } from '../../src/rules/index'
import { buildAuditResult } from '../../src/report/result'
import { writeBaseline, compareBaseline, fingerprintFinding } from '../../src/baseline'
import { decideExit, type CliOptions } from '../../src/cli'
import { EXIT_OK, EXIT_FINDINGS } from '../../src/exit-codes'
import type { StripeAccountSnapshot } from '../../src/types'

/**
 * The baseline-gate golden triad — the end-to-end regression contract:
 * a run exits 1 iff a NEW finding appeared vs the baseline, else 0 (even on a
 * score drop). Runs the engine over committed before/after snapshot fixtures,
 * writes a baseline from one, compares the other's active findings against it,
 * and asserts the exit code `decideExit` (the shared demo+live tail) returns.
 *
 * The fixtures re-pair to express all three transitions:
 *   worse  = clean `before` baseline vs `after`  (one new finding)  → exit 1
 *   same   = `after` baseline vs `after`         (no change)        → exit 0
 *   fixed  = `after` baseline vs clean `before`  (finding resolved) → exit 0
 */
const BASELINE_DIR = 'test/fixtures/baseline'
const loadSnap = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as StripeAccountSnapshot
const before = loadSnap(join(BASELINE_DIR, 'before@2026-06-24.dahlia.json'))
const after = loadSnap(join(BASELINE_DIR, 'after@2026-06-24.dahlia.json'))

/** Options that route decideExit through the baseline gate (as `--baseline <file>` does). */
const GATED: CliOptions = { checkBaseline: 'baseline.json' }

const resultFor = (snap: StripeAccountSnapshot) =>
  buildAuditResult(snap, runRules(snap, ALL_RULES), {
    rulesTotal: ALL_RULES.length,
    auditDate: '2026-06-24T00:00:00Z',
  })

/** Build the assembled result for `active`, gated against a baseline written from `baseSnap`. */
function gatedResult(baseSnap: StripeAccountSnapshot, activeSnap: StripeAccountSnapshot) {
  const base = writeBaseline(resultFor(baseSnap))
  const comparison = compareBaseline(resultFor(activeSnap).findings, base)
  return buildAuditResult(activeSnap, runRules(activeSnap, ALL_RULES), {
    rulesTotal: ALL_RULES.length,
    baseline: comparison,
    auditDate: '2026-06-24T00:00:00Z',
  })
}

describe('baseline-gate — golden regression triad', () => {
  it('worse: a new finding vs the baseline exits 1', () => {
    const result = gatedResult(before, after)
    expect(result.baseline?.regression).toBe(true)
    expect(decideExit(result, GATED, 'high')).toBe(EXIT_FINDINGS)
  })

  it('same: an identical run exits 0', () => {
    const result = gatedResult(after, after)
    expect(result.baseline?.regression).toBe(false)
    expect(result.baseline?.newFindings).toEqual([])
    expect(decideExit(result, GATED, 'high')).toBe(EXIT_OK)
  })

  it('fixed: a resolved baseline finding exits 0 AND lists the resolved fingerprint', () => {
    const result = gatedResult(after, before)
    expect(result.baseline?.regression).toBe(false)
    expect(result.baseline?.newFindings).toEqual([])
    // The one `after` finding (STATEMENT_DESCRIPTOR_MISSING) is gone in `before`.
    const resolvedFp = fingerprintFinding(resultFor(after).findings[0])
    expect(result.baseline?.resolvedFindings).toContain(resolvedFp)
    expect(decideExit(result, GATED, 'high')).toBe(EXIT_OK)
  })

  it('baseline gate REPLACES --fail-on: no new finding exits 0 even when --fail-on would trip', () => {
    // `after` has a medium finding, so `--fail-on medium` alone trips (exit 1).
    // Gated against its own baseline there is no NEW finding → the baseline gate
    // wins and returns exit 0.
    const gated = gatedResult(after, after)
    expect(decideExit(gated, GATED, 'medium')).toBe(EXIT_OK)
    // Sanity: the same findings WITHOUT a baseline gate DO trip --fail-on medium.
    expect(decideExit(resultFor(after), {}, 'medium')).toBe(EXIT_FINDINGS)
  })
})
