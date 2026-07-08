import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * The Action's --fail-on gate contract, proven against the REAL built
 * CLI over the all-issues `--demo` fixture. Both directions are asserted so a
 * silently-always-pass gate is impossible:
 *
 *   --fail-on none  → exit 0   (the `none` sentinel = +∞ threshold; never trips)
 *   --fail-on high  → exit !0  (the fixture's critical/high findings trip it)
 *
 * NOTE — an early spec example claimed `--fail-on critical → exit 0`; that is
 * factually wrong: the demo fixture carries a critical finding, so `critical`
 * (and every level down to `low`) trips → exit 1. Only the `none` sentinel exits
 * 0. The behaviour below is the ratified contract
 * (`--baseline` REPLACES `--fail-on`; the severity gate owns these exit codes).
 *
 * Also asserts the same JSON the Action parses for its `score`/`grade` outputs
 * carries a numeric summary.score and a non-empty string summary.grade.
 */
const CLI = 'dist/cli.js'

/** Run the built CLI in demo mode with STRIPE_SECRET_KEY stripped from the env. */
function runDemo(extraArgs: string[]) {
  const env = { ...process.env }
  delete env.STRIPE_SECRET_KEY
  return spawnSync(process.execPath, [CLI, '--demo', ...extraArgs], { encoding: 'utf8', env })
}

beforeAll(() => {
  // Self-contained: build if dist is cold (CI builds first, so this no-ops there).
  if (!existsSync(CLI)) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })
}, 120_000)

describe('Action --fail-on gate contract', () => {
  it('is lenient: `--fail-on none` exits 0 even with findings present', () => {
    const { status } = runDemo(['--fail-on', 'none'])
    expect(status).toBe(0)
  })

  it('is strict: `--fail-on high` exits non-zero on the all-issues fixture', () => {
    const { status } = runDemo(['--fail-on', 'high'])
    expect(status).not.toBe(0)
  })

  it('exposes numeric summary.score + non-empty string summary.grade in JSON', () => {
    const { stdout } = runDemo(['--output', 'json'])
    const summary = JSON.parse(stdout).summary
    expect(typeof summary.score).toBe('number')
    expect(typeof summary.grade).toBe('string')
    expect(summary.grade.length).toBeGreaterThan(0)
  })
})
