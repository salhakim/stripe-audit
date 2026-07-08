import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { coachKeyPrefix } from '../../src/coaching'

/**
 * Local key-prefix coaching. The pure classifier is unit-tested
 * across all four branches; the security invariant (the full key value never
 * appears in any line) is asserted both in-unit and against the built CLI.
 *
 * Fake keys are built by concatenation so no real-looking literal lands in source.
 */
const CLI = 'dist/cli.js'
const RK_TEST = 'rk_' + 'test_' + 'A'.repeat(24)
const RK_LIVE = 'rk_' + 'live_' + 'B'.repeat(24)
const SK_LIVE = 'sk_' + 'live_' + 'C'.repeat(24)
const SK_TEST = 'sk_' + 'test_' + 'D'.repeat(24)

function runKeyDemo(key: string) {
  const env = { ...process.env }
  delete env.STRIPE_SECRET_KEY
  return spawnSync(process.execPath, [CLI, '--key', key, '--demo'], { encoding: 'utf8', env })
}

beforeAll(() => {
  if (!existsSync(CLI)) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })
}, 120_000)

describe('coachKeyPrefix (pure classifier)', () => {
  it('celebrates a restricted key (rk_test_ / rk_live_)', () => {
    for (const key of [RK_TEST, RK_LIVE]) {
      const out = coachKeyPrefix(key).join('\n')
      expect(out.toLowerCase()).toMatch(/restricted/)
      expect(out).not.toContain(key) // full key never echoed
    }
  })

  it('warns + suggests restricted for a live secret key (sk_live_)', () => {
    const out = coachKeyPrefix(SK_LIVE).join('\n')
    expect(out.toLowerCase()).toMatch(/warning/)
    expect(out.toLowerCase()).toMatch(/restricted/)
    expect(out).not.toContain(SK_LIVE)
  })

  it('accepts a test secret key (sk_test_) with the same restricted suggestion', () => {
    const out = coachKeyPrefix(SK_TEST).join('\n')
    expect(out.toLowerCase()).toMatch(/restricted/)
    expect(out).not.toContain(SK_TEST)
  })

  it('notes a prefix-vs-expected-mode mismatch (the seam)', () => {
    const out = coachKeyPrefix(RK_TEST, 'live').join('\n')
    expect(out.toLowerCase()).toMatch(/mismatch|test-mode|expected/)
  })

  it('never echoes the full key, even for an unrecognized prefix', () => {
    const bogus = 'pk_' + 'test_' + 'E'.repeat(24)
    const out = coachKeyPrefix(bogus).join('\n')
    expect(out).not.toContain(bogus)
    expect(out.toLowerCase()).toMatch(/not recognized|expected/)
  })
})

describe('coaching on the CLI (built binary)', () => {
  it('celebrates rk_test_ on stderr', () => {
    const { stderr } = runKeyDemo(RK_TEST)
    expect(stderr.toLowerCase()).toMatch(/restricted/)
  })

  it('warns + suggests restricted for sk_live_ on stderr', () => {
    const { stderr } = runKeyDemo(SK_LIVE)
    expect(stderr.toLowerCase()).toMatch(/restricted|recommend|consider|warn/)
  })

  it('SECURITY: the full key value never appears in any output line', () => {
    const { stdout, stderr } = runKeyDemo(SK_LIVE)
    expect(stdout + stderr).not.toContain(SK_LIVE)
  })
})
