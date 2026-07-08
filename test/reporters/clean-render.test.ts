import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runAudit } from '../../src/cli'
import { renderReport, type OutputFormat } from '../../src/report/index'
import { worstSeverityOf } from '../../src/report/badge'
import type { StripeAccountSnapshot } from '../../src/types'

/**
 * The tool's primary SUCCESS output, exercised end-to-end: a healthy account
 * rendered by ALL five reporters. Failure modes and findings-heavy accounts
 * are covered elsewhere; this is the zero-findings/score-100 path a
 * well-configured account actually sees.
 */
const SNAP_DIR = 'test/fixtures/snapshots'
const FORMATS: readonly OutputFormat[] = ['console', 'json', 'markdown', 'html', 'badge']

function loadCleanSnapshot(): StripeAccountSnapshot {
  const file = readdirSync(SNAP_DIR).find((f) => f.startsWith('clean-account@'))
  if (!file) throw new Error('clean-account snapshot fixture missing')
  return JSON.parse(readFileSync(join(SNAP_DIR, file), 'utf8'))
}

describe('clean-account render — all five reporters over a healthy snapshot', () => {
  const result = runAudit(loadCleanSnapshot(), {})

  it('audits clean: score 100, Grade A, no worst severity, zero active findings', () => {
    expect(result.summary.score).toBe(100)
    expect(result.summary.grade).toBe('A')
    expect(worstSeverityOf(result.summary)).toBeNull()
    expect(result.findings).toEqual([])
  })

  for (const format of FORMATS) {
    it(`renders --output ${format} without crashing, non-empty`, () => {
      const rendered = renderReport(result, format)
      expect(rendered.length).toBeGreaterThan(0)
    })
  }

  it('json render carries the perfect summary and empty findings', () => {
    const parsed = JSON.parse(renderReport(result, 'json'))
    expect(parsed.summary.score).toBe(100)
    expect(parsed.summary.grade).toBe('A')
    expect(parsed.findings).toEqual([])
  })

  it('badge render is an SVG showing the perfect score', () => {
    const svg = renderReport(result, 'badge')
    expect(svg).toContain('<svg')
    expect(svg).toMatch(/100|grade a/i)
  })

  it('console render celebrates the healthy account (zero tallies, healthy copy)', () => {
    const text = renderReport(result, 'console')
    expect(text).toMatch(/100\/100/)
    expect(text).toMatch(/Grade A/)
    expect(text).toMatch(/No active findings/i)
    expect(text).toMatch(/Critical\s+0/)
    expect(text).toMatch(/High\s+0/)
  })
})
