/**
 * findUnusedSuppressions: the pure advisory helper behind
 * --report-unused-suppressions. A declared suppression is "unused" iff it suppressed
 * nothing in the run (matched no finding in the `suppressed` set). Reporting-only —
 * it reuses applyIgnore's parse + match logic and never touches score or exit.
 */
import { describe, it, expect } from 'vitest'
import { findUnusedSuppressions } from '../src/suppress'
import type { Finding } from '../src/types'

/** A minimal Finding for the suppression helper (it reads only ruleId + resource). */
function finding(ruleId: string, affectedResourceId: string | null): Finding {
  return {
    ruleId,
    severity: 'high',
    category: 'webhooks',
    title: 'x',
    affectedResourceId,
    affectedResourceType: 'webhook_endpoint',
    description: 'd',
    remediation: 'r',
    docsUrl: 'https://example.com',
  }
}

describe('findUnusedSuppressions — unused suppression detection', () => {
  it('does NOT report a suppression that matched a suppressed finding (used)', () => {
    const suppressed = [finding('WEBHOOK_SELECT_ALL', 'we_1')]
    expect(findUnusedSuppressions(['WEBHOOK_SELECT_ALL'], suppressed)).toEqual([])
  })

  it('reports a suppression that matched nothing (stale/unused), leaving used ones out', () => {
    const suppressed = [finding('WEBHOOK_SELECT_ALL', 'we_1')]
    const unused = findUnusedSuppressions(['STALE_RULE', 'WEBHOOK_SELECT_ALL'], suppressed)
    expect(unused.map((s) => s.raw)).toEqual(['STALE_RULE'])
  })

  it('honors resource-scoped patterns: matching one is used, a stale one is reported', () => {
    const suppressed = [finding('WEBHOOK_SELECT_ALL', 'we_1')]
    expect(findUnusedSuppressions([':we_1'], suppressed)).toEqual([])
    expect(findUnusedSuppressions([':we_999'], suppressed).map((s) => s.raw)).toEqual([':we_999'])
  })

  it('reports everything as unused when nothing was suppressed', () => {
    const unused = findUnusedSuppressions(['WEBHOOK_SELECT_ALL', ':we_1'], [])
    expect(unused.map((s) => s.raw)).toEqual(['WEBHOOK_SELECT_ALL', ':we_1'])
  })

  it('is pure — same inputs yield equal output and mutates neither input', () => {
    const lines = ['STALE_RULE']
    const suppressed = [finding('WEBHOOK_SELECT_ALL', 'we_1')]
    const a = findUnusedSuppressions(lines, suppressed)
    const b = findUnusedSuppressions(lines, suppressed)
    expect(a).toEqual(b)
    expect(lines).toEqual(['STALE_RULE']) // input not mutated
    expect(suppressed).toHaveLength(1)
  })
})
