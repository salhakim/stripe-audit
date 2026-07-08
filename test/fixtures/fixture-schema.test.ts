/**
 * Fixture drift protection.
 *
 * Every committed snapshot fixture must (1) parse through the real
 * `stripeAccountSnapshotSchema` (a schema change that orphans a fixture fails
 * HERE, not as a confusing golden mismatch), (2) carry the pinned API version in
 * its filename and `_meta.capturedApiVersion` — compared against the imported
 * `STRIPE_API_VERSION` constant, never a literal — and (3) for the base-mode
 * skip fixture: prove deep rules land in `skipped[]` with `requires-deep`, not
 * in the passed tally.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { stripeAccountSnapshotSchema } from '../../src/snapshot-schema'
import { STRIPE_API_VERSION } from '../../src/stripe-client'
import { runRules, isDeepRule } from '../../src/engine'
import { ALL_RULES, deepRules } from '../../src/rules/index'
import { buildAuditResult } from '../../src/report/result'
import type { StripeAccountSnapshot } from '../../src/types'

const FIXTURE_DIRS = ['test/fixtures/snapshots', 'test/fixtures/baseline']

const allFixtures = FIXTURE_DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ dir, file: f, path: join(dir, f) })),
)

describe('fixture-schema — every snapshot fixture parses through the real schema', () => {
  it('discovers fixtures in both fixture dirs', () => {
    expect(allFixtures.length).toBeGreaterThanOrEqual(9)
  })

  for (const { file, path } of allFixtures) {
    it(`${file} parses through stripeAccountSnapshotSchema`, () => {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      expect(() => stripeAccountSnapshotSchema.parse(raw)).not.toThrow()
    })
  }
})

describe('fixture-schema — _meta.expectedRules matches the golden envelope', () => {
  // _meta is human-facing documentation inside the fixture; the envelope is what
  // the golden harness enforces. Assert equality so the doc channel can never
  // silently drift from the enforced one.
  for (const { dir, file, path } of allFixtures) {
    const desc = file.replace(/\.json$/, '').replace(/@[0-9-]+(\.[a-z]+)?$/, '')
    const expectedPath = join('test/fixtures/expected', `${desc}.expected.json`)
    if (dir !== 'test/fixtures/snapshots' || !existsSync(expectedPath)) continue
    it(`${file}: _meta.expectedRules equals expected/${desc}.expected.json`, () => {
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      if (raw._meta?.expectedRules === undefined) return
      const envelope = JSON.parse(readFileSync(expectedPath, 'utf8')) as {
        expectedRuleIds: string[]
      }
      expect([...raw._meta.expectedRules].sort()).toEqual([...envelope.expectedRuleIds].sort())
    })
  }
})

describe('fixture-schema — version pin (imported constant, never a literal)', () => {
  for (const { file, path } of allFixtures) {
    it(`${file} filename + _meta.capturedApiVersion match STRIPE_API_VERSION`, () => {
      expect(file.endsWith(`@${STRIPE_API_VERSION}.json`)).toBe(true)
      const raw = JSON.parse(readFileSync(path, 'utf8'))
      // _meta is optional on baseline fixtures; when present it must match the pin.
      if (raw._meta?.capturedApiVersion !== undefined) {
        expect(raw._meta.capturedApiVersion).toBe(STRIPE_API_VERSION)
      }
      if (raw.apiVersion !== undefined) {
        expect(raw.apiVersion).toBe(STRIPE_API_VERSION)
      }
    })
  }
})

describe('fixture-schema — base-mode-skip proves the deep-rule skip contract', () => {
  const snap = JSON.parse(
    readFileSync(`test/fixtures/snapshots/base-mode-skip@${STRIPE_API_VERSION}.json`, 'utf8'),
  ) as StripeAccountSnapshot

  it('every deep rule lands in skipped[] with reason requires-deep', () => {
    const run = runRules(snap, ALL_RULES)
    const skippedIds = run.skipped.map((s) => s.ruleId).sort()
    expect(skippedIds).toEqual(deepRules.map((r) => r.id).sort())
    for (const skipped of run.skipped) {
      expect(skipped.reason).toBe('requires-deep')
    }
  })

  it('skipped deep rules are NOT counted as passed (rulesRun excludes them)', () => {
    const run = runRules(snap, ALL_RULES)
    const result = buildAuditResult(snap, run, { rulesTotal: ALL_RULES.length })
    const baseCount = ALL_RULES.filter((r) => !isDeepRule(r)).length
    expect(result.summary.rulesRun).toBe(baseCount)
    expect(result.summary.rulesPassed).toBeLessThanOrEqual(baseCount)
  })
})
