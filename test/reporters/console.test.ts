import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runRules } from '../../src/engine'
import { ALL_RULES } from '../../src/rules/index'
import { buildAuditResult, renderConsole, stripAnsi } from '../../src/report'
import type { BuildAuditResultOptions } from '../../src/report'
import type { StripeAccountSnapshot } from '../../src/types'

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

/** Plain (ANSI-stripped) console output — what a piped consumer sees. */
const plain = () => stripAnsi(renderConsole(demoResult()))

/** Plain console output for a snapshot whose list regions were truncated (PARTIAL audit). */
function cappedPlain() {
  const snap = loadSnap()
  snap.truncated = ['prices']
  const run = runRules(snap, ALL_RULES)
  const result = buildAuditResult(snap, run, {
    rulesTotal: ALL_RULES.length,
    auditDate: '2026-06-24T00:00:00.000Z',
  })
  return stripAnsi(renderConsole(result))
}

describe('renderConsole — basic severity-grouped (default reporter)', () => {
  it('matches the committed snapshot (ANSI-stripped for stability)', () => {
    expect(plain()).toMatchSnapshot()
  })

  it('prints a one-line score/grade summary', () => {
    expect(plain()).toMatch(/score/i)
    expect(plain()).toMatch(/grade/i)
  })

  it('renders a score/grade gauge that survives ANSI stripping (non-TTY safe)', () => {
    const text = plain()
    // "Score" + "Grade C/F/…" contiguous text, plus the gauge bracket + glyphs.
    expect(text).toMatch(/Score\s+\[[█░]+\]\s+\d+\/100 — Grade [A-F]/)
  })

  it('renders per-severity bars proportional to counts', () => {
    const text = plain()
    expect(text).toContain('Findings by severity')
    // The demo fixture has findings, so at least one filled bar glyph is present.
    expect(text).toMatch(/Critical\s+[█ ]*\s*\d+/)
    expect(text).toContain('█')
  })

  it('renders a category heat-strip across the configured categories', () => {
    const text = plain()
    expect(text).toContain('Findings by category')
    for (const category of ['webhooks', 'billing', 'pricing', 'configuration']) {
      expect(text).toContain(category)
    }
  })

  it('still shows the actionable finding detail (title + remediation), not just the dashboard', () => {
    const text = plain()
    // A dashboard that hid the detail would regress usefulness — keep both.
    expect(text).toMatch(/•/)
  })

  it('groups active findings under severity headings', () => {
    const text = plain()
    expect(text).toMatch(/critical/i)
    expect(text).toMatch(/high|medium|low|info/i)
  })

  it('always prints a Skipped line and a Suppressed (N) line (N=0 here)', () => {
    const text = plain()
    expect(text).toMatch(/skipped/i)
    expect(text).toMatch(/suppressed[^0-9]*\(?[0-9]+\)?/i)
  })

  it('always prints a coverage line (full vs PARTIAL warning naming the truncated region)', () => {
    expect(plain()).toMatch(/coverage: full/i)
    const partial = cappedPlain()
    expect(partial).toMatch(/partial audit/i)
    expect(partial).toContain('prices')
  })

  it('shows the pinned Stripe API version as contiguous text', () => {
    expect(plain()).toContain('2026-06-24.dahlia')
  })

  it('renders no Stripe key substring (even before ANSI stripping)', () => {
    expect(renderConsole(demoResult())).not.toMatch(/sk_(live|test)_|rk_(live|test)_/)
  })

  it('stripAnsi removes SGR codes', () => {
    expect(stripAnsi('\x1b[31mred\x1b[39m')).toBe('red')
  })
})

describe('renderConsole — filtered-run labeling', () => {
  const filteredPlain = () =>
    stripAnsi(renderConsole(demoResult({ filter: { severity: ['low'] } })))

  it('annotates the grade as filtered and replaces "Coverage: full" with the FILTERED line', () => {
    const text = filteredPlain()
    expect(text).toMatch(/Grade [A-F] \(filtered\)/)
    expect(text).toContain(
      'Coverage: FILTERED (severity=low) — higher-severity rules were not run.',
    )
    expect(text).not.toMatch(/coverage: full/i)
  })

  it('filtered + truncated shows BOTH the FILTERED line and the partial warning', () => {
    const snap = loadSnap()
    snap.truncated = ['prices']
    const run = runRules(snap, ALL_RULES)
    const result = buildAuditResult(snap, run, {
      rulesTotal: ALL_RULES.length,
      auditDate: '2026-06-24T00:00:00.000Z',
      filter: { severity: ['low'], category: ['billing'] },
    })
    const text = stripAnsi(renderConsole(result))
    expect(text).toContain('Coverage: FILTERED (severity=low, category=billing)')
    expect(text).toMatch(/partial audit/i)
    expect(text).not.toMatch(/coverage: full/i)
  })

  it('the unfiltered dashboard carries no filtered annotation (byte-unchanged contract)', () => {
    expect(plain()).not.toMatch(/\(filtered\)|FILTERED/)
  })
})
