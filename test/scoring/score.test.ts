import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { scoreFindings, gradeForScore } from '../../src/score'
import { runRules } from '../../src/engine'
import { ALL_RULES } from '../../src/rules/index'
import type { Finding, Severity, StripeAccountSnapshot } from '../../src/types'

/** A severity-only finding stub — scoreFindings reads only `severity`. */
const sev = (severity: Severity): Pick<Finding, 'severity'> => ({ severity })

const ALL_ISSUES_FIXTURE = 'test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json'

describe('scoreFindings — clean account', () => {
  it('scores zero active findings as 100 / grade A / worstSeverity null', () => {
    expect(scoreFindings([])).toEqual({ score: 100, grade: 'A', worstSeverity: null })
  })
})

describe('scoreFindings — deterministic', () => {
  it('is deterministic: the same findings always yield the same score', () => {
    const findings = [sev('critical'), sev('low'), sev('medium')]
    const first = scoreFindings(findings)
    const second = scoreFindings(findings)
    expect(first).toEqual(second)
  })

  it('reads only severity — extra finding fields never change the result', () => {
    const bare = scoreFindings([sev('high')])
    const rich = scoreFindings([{ severity: 'high', ruleId: 'X', title: 'noise' } as Finding])
    expect(rich).toEqual(bare)
  })
})

describe('scoreFindings — monotonic in severity', () => {
  const ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info']

  it('a worse single finding never scores higher than a milder one', () => {
    const scores = ORDER.map((s) => scoreFindings([sev(s)]).score)
    // critical ≤ high ≤ medium ≤ low ≤ info, all ≤ 100
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeLessThanOrEqual(scores[i])
    }
    expect(scores.at(-1)).toBe(100) // info is weightless
  })

  it('adding a finding never raises the score (count monotonicity)', () => {
    const base = scoreFindings([sev('critical'), sev('high')]).score
    const fewer = scoreFindings([sev('critical')]).score
    expect(fewer).toBeGreaterThanOrEqual(base)
  })
})

describe('scoreFindings — grade thresholds', () => {
  it('maps scores to letter grades at the documented thresholds', () => {
    expect(gradeForScore(100)).toBe('A')
    expect(gradeForScore(90)).toBe('A')
    expect(gradeForScore(89)).toBe('B')
    expect(gradeForScore(80)).toBe('B')
    expect(gradeForScore(79)).toBe('C')
    expect(gradeForScore(70)).toBe('C')
    expect(gradeForScore(69)).toBe('D')
    expect(gradeForScore(60)).toBe('D')
    expect(gradeForScore(59)).toBe('F')
    expect(gradeForScore(0)).toBe('F')
  })
})

describe('scoreFindings — active-only contract', () => {
  it('operates on the active list it is given (skipped/suppressed exclusion is the caller job)', () => {
    // Excluding a finding (as a suppression would) must not LOWER the score.
    const withBoth = scoreFindings([sev('critical'), sev('high')]).score
    const suppressedExcluded = scoreFindings([sev('critical')]).score
    expect(suppressedExcluded).toBeGreaterThanOrEqual(withBoth)
  })
})

describe('scoreFindings — over the bundled all-issues fixture', () => {
  it('scores the all-issues account sub-A with worstSeverity critical', () => {
    const snap = JSON.parse(readFileSync(ALL_ISSUES_FIXTURE, 'utf8')) as StripeAccountSnapshot
    const { findings } = runRules(snap, ALL_RULES)
    const result = scoreFindings(findings)
    expect(result.worstSeverity).toBe('critical')
    expect(result.grade).not.toBe('A')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })
})
