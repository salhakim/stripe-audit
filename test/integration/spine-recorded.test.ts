import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { runAudit, decideExit } from '../../src/cli'
import { renderReport } from '../../src/report/index'
import type { StripeAccountSnapshot } from '../../src/types'

/**
 * Full-spine integration over a RECORDED Stripe-shaped snapshot: the same
 * runAudit spine the CLI driver calls — resolveRules → runRules →
 * applySuppressions → score — then renderReport and decideExit, end to end
 * with zero mocks. This proves the CLI produces a real finding, a real score,
 * and the right exit code from recorded account data, not just that the fetch
 * shape parses.
 *
 * (The fetch leg of the spine is exercised for real by the built-CLI 401 e2e
 * and the stripe-mock fetcher integration; this test picks up from the
 * recorded snapshot those produce.)
 */
const SNAP_DIR = 'test/fixtures/snapshots'

function loadSnap(desc: string): StripeAccountSnapshot {
  const file = readdirSync(SNAP_DIR).find((f) => f.startsWith(`${desc}@`))
  if (!file) throw new Error(`no recorded snapshot fixture for ${desc}`)
  return JSON.parse(readFileSync(join(SNAP_DIR, file), 'utf8'))
}

describe('recorded-snapshot spine — runAudit → renderReport → decideExit', () => {
  const snapshot = loadSnap('all-issues')
  const result = runAudit(snapshot, {})

  it('emits real findings with a known rule present', () => {
    expect(result.findings.length).toBeGreaterThan(0)
    const ids = result.findings.map((f) => f.ruleId)
    expect(ids).toContain('ACCOUNT_CHARGES_DISABLED')
  })

  it('scores the account below 100 with a non-A grade and severe findings tallied', () => {
    expect(result.summary.score).toBeLessThan(100)
    expect(result.summary.grade).not.toBe('A')
    expect(result.summary.critical + result.summary.high).toBeGreaterThan(0)
  })

  it('renders every reporter format from the same result without crashing', () => {
    for (const format of ['console', 'json', 'markdown', 'html'] as const) {
      const rendered = renderReport(result, format)
      expect(rendered.length).toBeGreaterThan(0)
    }
    const parsed = JSON.parse(renderReport(result, 'json'))
    expect(parsed.summary.score).toBe(result.summary.score)
    expect(parsed.findings.length).toBe(result.findings.length)
  })

  it('decides the exit code from the real findings (fail-on high trips → 1)', () => {
    expect(decideExit(result, {}, 'high')).toBe(1)
    expect(decideExit(result, {}, 'none')).toBe(0)
  })

  it('a clean recorded account runs the same spine to score 100 / exit 0', () => {
    const clean = runAudit(loadSnap('clean-account'), {})
    expect(clean.summary.score).toBe(100)
    expect(clean.summary.grade).toBe('A')
    expect(decideExit(clean, {}, 'high')).toBe(0)
  })
})
