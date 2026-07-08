import { describe, it, expect } from 'vitest'
import {
  renderBadge,
  badgeColorOf,
  worstSeverityOf,
  BADGE_SEVERITY_COLOR,
  BADGE_CLEAN_COLOR,
  renderReport,
} from '../../src/report'
import type { AuditResult, AuditSummary } from '../../src/report'
import type { Severity } from '../../src/types'

/** A summary tally with the given per-severity counts (others zero). */
function summaryWith(counts: Partial<Record<Severity, number>>): AuditSummary {
  const c = { critical: 0, high: 0, medium: 0, low: 0, info: 0, ...counts }
  const total = c.critical + c.high + c.medium + c.low + c.info
  return {
    ...c,
    total,
    rulesRun: 10,
    rulesPassed: Math.max(0, 10 - total),
    score: Math.max(0, 100 - c.critical * 25 - c.high * 10 - c.medium * 4 - c.low),
    grade: 'A',
    suppressed: 0,
  }
}

/** A minimal AuditResult carrying only what the badge reads (its summary). */
function resultWith(summary: AuditSummary): AuditResult {
  return {
    version: '0.2.0',
    stripeApiVersion: '2026-06-24.dahlia',
    accountMode: 'test',
    auditDate: '2026-06-24T00:00:00.000Z',
    summary,
    findings: [],
    skipped: [],
    truncated: [],
  }
}

describe('worstSeverityOf — worst-first derivation from summary counts', () => {
  it('returns null on a clean tally', () => {
    expect(worstSeverityOf(summaryWith({}))).toBeNull()
  })

  it('picks the highest severity present, not the most numerous', () => {
    // one critical outranks a hundred lows
    expect(worstSeverityOf(summaryWith({ critical: 1, low: 100 }))).toBe('critical')
    expect(worstSeverityOf(summaryWith({ high: 2, medium: 5 }))).toBe('high')
    expect(worstSeverityOf(summaryWith({ medium: 1 }))).toBe('medium')
    expect(worstSeverityOf(summaryWith({ low: 3 }))).toBe('low')
    expect(worstSeverityOf(summaryWith({ info: 4 }))).toBe('info')
  })
})

describe('badgeColorOf — worst-severity → fill mapping', () => {
  it('maps clean → brightgreen', () => {
    expect(badgeColorOf(summaryWith({}))).toBe(BADGE_CLEAN_COLOR)
  })

  it('maps each worst severity to its palette color', () => {
    expect(badgeColorOf(summaryWith({ critical: 1 }))).toBe(BADGE_SEVERITY_COLOR.critical)
    expect(badgeColorOf(summaryWith({ high: 1 }))).toBe(BADGE_SEVERITY_COLOR.high)
    expect(badgeColorOf(summaryWith({ medium: 1 }))).toBe(BADGE_SEVERITY_COLOR.medium)
    expect(badgeColorOf(summaryWith({ low: 1 }))).toBe(BADGE_SEVERITY_COLOR.low)
  })

  it('critical is red, high is orange, medium is yellow, low is green', () => {
    expect(BADGE_SEVERITY_COLOR.critical).toBe('#e05d44')
    expect(BADGE_SEVERITY_COLOR.high).toBe('#fe7d37')
    expect(BADGE_SEVERITY_COLOR.medium).toBe('#dfb317')
    expect(BADGE_SEVERITY_COLOR.low).toBe('#4c1')
  })
})

describe('renderBadge — self-contained SVG', () => {
  it('emits a well-formed, self-contained SVG with a11y attributes', () => {
    const svg = renderBadge(resultWith(summaryWith({ critical: 1 })))
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
    expect(svg).toContain('role="img"')
    expect(svg).toContain('aria-label="Stripe Health: A (75)"')
    // no external resource references — self-contained by construction. The SVG
    // namespace URI (xmlns="http://www.w3.org/2000/svg") is a name, not a fetch,
    // so guard against the attributes that actually pull a resource instead.
    expect(svg).not.toMatch(/\b(?:href|src)\s*=/)
    expect(svg).not.toMatch(/xlink:href|<image\b|<use\b/)
  })

  it('reads "Stripe Health" and the grade/score label', () => {
    const svg = renderBadge(resultWith(summaryWith({})))
    expect(svg).toContain('Stripe Health')
    // clean account → grade A, score 100
    expect(svg).toContain('A (100)')
    expect(svg).toMatch(/[A-F]/)
  })

  it('fills the value box with the worst-severity color', () => {
    const critical = renderBadge(resultWith(summaryWith({ critical: 1 })))
    expect(critical).toContain(`fill="${BADGE_SEVERITY_COLOR.critical}"`)
    const clean = renderBadge(resultWith(summaryWith({})))
    expect(clean).toContain(`fill="${BADGE_CLEAN_COLOR}"`)
  })

  it('never emits a Stripe key substring', () => {
    const svg = renderBadge(resultWith(summaryWith({ high: 3, medium: 2 })))
    expect(svg).not.toMatch(/sk_(live|test)_|rk_(live|test)_/)
  })

  it('renderReport routes the badge format to renderBadge', () => {
    const result = resultWith(summaryWith({ medium: 1 }))
    expect(renderReport(result, 'badge')).toBe(renderBadge(result))
  })

  it('annotates the value box + aria-label as (filtered) when the result carries a filter', () => {
    const filtered = renderBadge({ ...resultWith(summaryWith({})), filter: { severity: ['low'] } })
    expect(filtered).toContain('A (100) (filtered)')
    expect(filtered).toContain('aria-label="Stripe Health: A (100) (filtered)"')
    // Unfiltered badge stays byte-identical to the pre-filter render.
    const unfiltered = renderBadge(resultWith(summaryWith({})))
    expect(unfiltered).not.toContain('(filtered)')
  })
})
