import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyIgnore, parseSuppression, loadIgnoreFile } from '../../src/suppress'
import type { Finding } from '../../src/types'

/**
 * The pure suppression filter. `applyIgnore` partitions findings into
 * `{ active, suppressed, unmatched }` against gitignore-style patterns; the loader
 * reads `.stripeauditignore` from a working directory.
 */
const f = (ruleId: string, affectedResourceId: string | null): Finding => ({
  ruleId,
  severity: 'high',
  category: 'security',
  title: 't',
  affectedResourceId,
  affectedResourceType: 'x',
  description: '',
  remediation: '',
  docsUrl: '',
})

describe('parseSuppression', () => {
  it('parses a bare rule id', () => {
    expect(parseSuppression('WEBHOOK_SELECT_ALL')).toEqual({
      raw: 'WEBHOOK_SELECT_ALL',
      ruleId: 'WEBHOOK_SELECT_ALL',
      resourceId: null,
    })
  })

  it('parses :resource and *:resource as resource-only', () => {
    expect(parseSuppression(':we_123')).toEqual({ raw: ':we_123', ruleId: null, resourceId: 'we_123' })
    expect(parseSuppression('*:we_123')).toEqual({ raw: '*:we_123', ruleId: null, resourceId: 'we_123' })
  })

  it('parses rule:resource', () => {
    expect(parseSuppression('PRICE_NO_LOOKUP_KEY:price_a')).toEqual({
      raw: 'PRICE_NO_LOOKUP_KEY:price_a',
      ruleId: 'PRICE_NO_LOOKUP_KEY',
      resourceId: 'price_a',
    })
  })

  it('returns null for blank and comment lines', () => {
    expect(parseSuppression('')).toBeNull()
    expect(parseSuppression('   ')).toBeNull()
    expect(parseSuppression('# a comment')).toBeNull()
  })
})

describe('applyIgnore', () => {
  it('suppresses by rule id (every finding of that rule)', () => {
    const r = applyIgnore([f('WEBHOOK_SELECT_ALL', 'we_1'), f('PRICE_NO_LOOKUP_KEY', 'price_a')], [
      'WEBHOOK_SELECT_ALL',
    ])
    expect(r.suppressed.map((x) => x.ruleId)).toEqual(['WEBHOOK_SELECT_ALL'])
    expect(r.active.map((x) => x.ruleId)).toEqual(['PRICE_NO_LOOKUP_KEY'])
    expect(r.unmatched).toEqual([])
  })

  it('suppresses by resource (every finding on that resource, any rule)', () => {
    const findings = [f('A', 'we_9'), f('B', 'we_9'), f('A', 'we_0')]
    const r = applyIgnore(findings, [':we_9'])
    expect(r.suppressed).toHaveLength(2)
    expect(r.active.map((x) => x.affectedResourceId)).toEqual(['we_0'])
  })

  it('suppresses by rule:resource (only that rule on that resource)', () => {
    const findings = [f('PRICE_NO_LOOKUP_KEY', 'price_abc'), f('PRICE_NO_LOOKUP_KEY', 'price_xyz')]
    const r = applyIgnore(findings, ['PRICE_NO_LOOKUP_KEY:price_abc'])
    expect(r.suppressed.map((x) => x.affectedResourceId)).toEqual(['price_abc'])
    expect(r.active.map((x) => x.affectedResourceId)).toEqual(['price_xyz'])
  })

  it('skips blank lines and # comments (suppresses nothing)', () => {
    const r = applyIgnore([f('A', 'x')], ['  ', '# note', ''])
    expect(r.active).toHaveLength(1)
    expect(r.suppressed).toHaveLength(0)
    expect(r.unmatched).toEqual([])
  })

  it('reports unmatched patterns without suppressing anything', () => {
    const r = applyIgnore([f('A', 'x')], ['NO_SUCH_RULE'])
    expect(r.suppressed).toHaveLength(0)
    expect(r.active).toHaveLength(1)
    expect(r.unmatched).toEqual(['NO_SUCH_RULE'])
  })

  it('is pure — does not mutate its findings argument', () => {
    const findings = [f('A', 'x')]
    const before = JSON.parse(JSON.stringify(findings))
    applyIgnore(findings, ['A'])
    expect(findings).toEqual(before)
  })
})

describe('loadIgnoreFile', () => {
  it('reads .stripeauditignore lines from the working dir; [] when absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sba-ignore-'))
    try {
      expect(loadIgnoreFile(dir)).toEqual([])
      writeFileSync(join(dir, '.stripeauditignore'), 'WEBHOOK_SELECT_ALL\n# note\n:we_1\n')
      expect(loadIgnoreFile(dir)).toContain('WEBHOOK_SELECT_ALL')
      expect(loadIgnoreFile(dir)).toContain(':we_1')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
