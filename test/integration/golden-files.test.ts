import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runRules } from '../../src/engine'
import { ALL_RULES } from '../../src/rules/index'
import { buildAuditResult } from '../../src/report/result'
import { writeBaseline, compareBaseline } from '../../src/baseline'
import { applyIgnore, loadIgnoreFile } from '../../src/suppress'
import type { StripeAccountSnapshot } from '../../src/types'

const SNAP_DIR = 'test/fixtures/snapshots'
const EXPECTED_DIR = 'test/fixtures/expected'
const BASELINE_DIR = 'test/fixtures/baseline'

const loadSnap = (p: string) =>
  JSON.parse(readFileSync(p, 'utf8')) as StripeAccountSnapshot

/** The expected-output envelope every `<desc>.expected.json` carries. */
interface ExpectedEnvelope {
  expectedRuleIds: string[]
}

/** Distinct rule IDs that fired against the full re-grounded catalog, sorted. */
function firedIds(snap: StripeAccountSnapshot): string[] {
  return [...new Set(runRules(snap, ALL_RULES).findings.map((f) => f.ruleId))].sort()
}

/**
 * Map a snapshot filename to its `<desc>` by stripping the trailing `@<version>`
 * suffix (a date and optional codename, e.g. `@2026-06-24.dahlia`) and the `.json`
 * extension: `clean-account@2026-06-24.dahlia.json` → `clean-account`. The generic
 * suffix regex means a codename or date change does not break discovery.
 */
function descOf(filename: string): string {
  return filename.replace(/\.json$/, '').replace(/@[0-9-]+(\.[a-z]+)?$/, '')
}

describe('golden-files — auto-discovered fixtures over the re-grounded catalog', () => {
  const fixtures = readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'))

  it('discovers the committed snapshot fixtures (clean-account + all-issues at minimum)', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(2)
    const descs = fixtures.map(descOf)
    expect(descs).toContain('clean-account')
    expect(descs).toContain('all-issues')
  })

  // One assertion per discovered fixture. Adding a new fixture+expected pair needs
  // ZERO harness edits — discovery + the envelope mapping cover it automatically.
  for (const file of fixtures) {
    const desc = descOf(file)
    it(`${desc}: fired rule IDs equal expected/${desc}.expected.json`, () => {
      const expectedPath = join(EXPECTED_DIR, `${desc}.expected.json`)
      // Missing-expected guard: a discovered fixture with no expected envelope is a
      // loud failure, never a silent skip — otherwise a fixture could ship unchecked.
      if (!existsSync(expectedPath)) {
        throw new Error(
          `golden harness: fixture ${file} has no expected envelope at ${expectedPath}. ` +
            `Add ${desc}.expected.json with {"expectedRuleIds":[...]}.`,
        )
      }
      const envelope = JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedEnvelope
      expect(Array.isArray(envelope.expectedRuleIds)).toBe(true)
      const actual = firedIds(loadSnap(join(SNAP_DIR, file)))
      expect(actual).toEqual([...envelope.expectedRuleIds].sort())
    })
  }

  it('clean-account maps to an empty expectedRuleIds (false-positive guard)', () => {
    const envelope = JSON.parse(
      readFileSync(join(EXPECTED_DIR, 'clean-account.expected.json'), 'utf8'),
    ) as ExpectedEnvelope
    expect(envelope.expectedRuleIds).toEqual([])
  })
})

describe('golden-files — baseline regression seam', () => {
  // The baseline block is finding ARRAYS: newFindings: Finding[], resolvedFindings:
  // string[]. This exercises the real baseline core (writeBaseline + compareBaseline)
  // fed into buildAuditResult({ baseline }) over a committed before/after pair where
  // `after` introduces exactly one new finding vs a clean `before` baseline.
  const before = loadSnap(join(BASELINE_DIR, 'before@2026-06-24.dahlia.json'))
  const after = loadSnap(join(BASELINE_DIR, 'after@2026-06-24.dahlia.json'))

  const resultFor = (snap: StripeAccountSnapshot) =>
    buildAuditResult(snap, runRules(snap, ALL_RULES), {
      rulesTotal: ALL_RULES.length,
      auditDate: '2026-06-24T00:00:00Z',
    })

  it('the after fixture introduces exactly one new finding vs before (clean baseline)', () => {
    const beforeIds = firedIds(before)
    const afterIds = firedIds(after)
    expect(beforeIds).toEqual([])
    expect(afterIds.filter((id) => !beforeIds.includes(id))).toEqual(['STATEMENT_DESCRIPTOR_MISSING'])
  })

  it('buildAuditResult carries the baseline block as arrays (regression + newFindings[])', () => {
    const base = writeBaseline(resultFor(before)) // clean before → 0 fingerprints
    const comparison = compareBaseline(resultFor(after).findings, base)
    const result = buildAuditResult(after, runRules(after, ALL_RULES), {
      rulesTotal: ALL_RULES.length,
      baseline: comparison,
      auditDate: '2026-06-24T00:00:00Z',
    })
    expect(result.baseline).toBeDefined()
    expect(result.baseline?.regression).toBe(true)
    expect([...new Set(result.baseline?.newFindings.map((f) => f.ruleId))]).toEqual([
      'STATEMENT_DESCRIPTOR_MISSING',
    ])
    expect(result.baseline?.resolvedFindings).toEqual([])
  })

  it('omits the baseline block when none is supplied (optional-block contract)', () => {
    const run = runRules(after, ALL_RULES)
    const result = buildAuditResult(after, run, { rulesTotal: ALL_RULES.length })
    expect(result.baseline).toBeUndefined()
  })
})

describe('golden-files — .stripeauditignore suppression case', () => {
  // Loads the committed test/fixtures/.stripeauditignore (gitignore-style), runs it
  // through loadIgnoreFile + applyIgnore over the all-issues findings, and asserts a
  // matching finding lands in `suppressed` (not `active`) and the suppressed tally is
  // non-zero — the suppression seam the score/exit gate reads `active` over.
  it('a matching suppression moves the wildcard-webhook finding to suppressed', () => {
    const snap = loadSnap(join(SNAP_DIR, 'all-issues@2026-06-24.dahlia.json'))
    const findings = runRules(snap, ALL_RULES).findings

    const lines = loadIgnoreFile('test/fixtures')
    expect(lines.length).toBeGreaterThan(0)

    const { active, suppressed } = applyIgnore(findings, lines)

    // Total is conserved: every finding is either active or suppressed (pure partition).
    expect(active.length + suppressed.length).toBe(findings.length)
    // The suppressed tally is visible and non-zero.
    expect(suppressed.length).toBeGreaterThan(0)
    // The suppressed rule (WEBHOOK_SELECT_ALL) is gone from active and present in suppressed.
    expect(suppressed.some((f) => f.ruleId === 'WEBHOOK_SELECT_ALL')).toBe(true)
    expect(active.some((f) => f.ruleId === 'WEBHOOK_SELECT_ALL')).toBe(false)
  })
})
