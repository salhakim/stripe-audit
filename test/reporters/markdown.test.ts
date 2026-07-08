import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runRules } from '../../src/engine'
import { ALL_RULES } from '../../src/rules/index'
import { buildAuditResult, renderMarkdown } from '../../src/report'
import type { BuildAuditResultOptions } from '../../src/report'
import type { Finding, StripeAccountSnapshot } from '../../src/types'

const FIXTURE = 'test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json'
const loadSnap = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as StripeAccountSnapshot

function demoResult(opts: Partial<BuildAuditResultOptions> = {}) {
  const snap = loadSnap()
  const run = runRules(snap, ALL_RULES)
  return buildAuditResult(snap, run, {
    rulesTotal: ALL_RULES.length,
    auditDate: '2026-06-24T00:00:00.000Z',
    ...opts,
  })
}

/** A result whose snapshot had list regions truncated at the fetch cap (PARTIAL audit). */
function cappedResult() {
  const snap = loadSnap()
  snap.truncated = ['prices', 'webhook_endpoints']
  const run = runRules(snap, ALL_RULES)
  return buildAuditResult(snap, run, { rulesTotal: ALL_RULES.length, auditDate: '2026-06-24T00:00:00.000Z' })
}

describe('renderMarkdown — GitHub-flavored report', () => {
  it('matches the committed snapshot', () => {
    expect(renderMarkdown(demoResult())).toMatchSnapshot()
  })

  it('contains a pipe-delimited table with a separator row', () => {
    const md = renderMarkdown(demoResult())
    const lines = md.split('\n')
    expect(lines.some((l) => /^\|.*\|$/.test(l))).toBe(true)
    expect(lines.some((l) => /^\|[ :|-]+\|$/.test(l))).toBe(true)
  })

  it('renders the score/grade and the pinned API version', () => {
    const md = renderMarkdown(demoResult())
    expect(md).toMatch(/score/i)
    expect(md).toMatch(/grade/i)
    expect(md).toContain('2026-06-24.dahlia')
  })

  it('always renders a Skipped section and a Suppressed (N) footnote (N=0 here)', () => {
    const md = renderMarkdown(demoResult())
    expect(md).toMatch(/skipped/i)
    expect(md).toMatch(/Suppressed \(0\)/) // contiguous text, never split
  })

  it('leads findings with the consequence + a Stripe docs link', () => {
    const md = renderMarkdown(demoResult())
    expect(md).toMatch(/https:\/\/docs\.stripe\.com\//)
    // A finding heading leads with the title (consequence), not a bare RULE_ID line.
    expect(md).not.toMatch(/^#### [A-Z][A-Z0-9_]+$/m)
  })

  it('always renders a coverage line: full when nothing truncated, PARTIAL warning when a region was capped', () => {
    expect(renderMarkdown(demoResult())).toMatch(/full audit/i)
    const partial = renderMarkdown(cappedResult())
    expect(partial).toMatch(/partial audit/i)
    expect(partial).toContain('`prices`')
    expect(partial).toContain('`webhook_endpoints`')
  })

  it('renders the baseline block only when a baseline is supplied', () => {
    expect(renderMarkdown(demoResult())).not.toMatch(/## Baseline/)
    const withBaseline = renderMarkdown(
      demoResult({
        baseline: {
          newFindings: [{} as Finding, {} as Finding],
          resolvedFindings: ['fp_resolved'],
          scoreDelta: -7,
          regression: true,
        },
      }),
    )
    expect(withBaseline).toMatch(/## Baseline/)
    expect(withBaseline).toMatch(/Score delta: -7/)
  })

  it('renders no Stripe key substring', () => {
    expect(renderMarkdown(demoResult())).not.toMatch(/sk_(live|test)_|rk_(live|test)_/)
  })
})

describe('renderMarkdown — filtered-run labeling', () => {
  it('annotates the grade and replaces the full-audit line with the FILTERED callout', () => {
    const md = renderMarkdown(demoResult({ filter: { severity: ['low'] } }))
    expect(md).toMatch(/Grade [A-F] \(filtered\)\*\*/)
    expect(md).toContain(
      '> ⚠️ **Coverage: FILTERED** (severity=low) — higher-severity rules were not run.',
    )
    expect(md).not.toMatch(/full audit/i)
  })

  it('filtered + truncated renders BOTH the FILTERED callout and the partial warning', () => {
    const snap = loadSnap()
    snap.truncated = ['prices']
    const run = runRules(snap, ALL_RULES)
    const md = renderMarkdown(
      buildAuditResult(snap, run, {
        rulesTotal: ALL_RULES.length,
        auditDate: '2026-06-24T00:00:00.000Z',
        filter: { category: ['billing'] },
      }),
    )
    expect(md).toContain('**Coverage: FILTERED** (category=billing)')
    expect(md).toMatch(/partial audit/i)
  })

  it('the unfiltered report carries no filtered annotation (byte-unchanged contract)', () => {
    expect(renderMarkdown(demoResult())).not.toMatch(/\(filtered\)|FILTERED/)
  })
})
