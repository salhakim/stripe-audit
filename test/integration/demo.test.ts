import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/**
 * The keyless `--demo` capstone. Drives the BUILT CLI as a subprocess
 * (the shipped surface) with STRIPE_SECRET_KEY stripped from the environment, and
 * asserts the full fetch-free pipeline completes, stays branded (never a
 * missing-key error), renders the mandatory Skipped + Suppressed surfaces, and
 * never leaks a key — across every `--output` format.
 */
const CLI = 'dist/cli.js'
const OUTPUTS = ['console', 'json', 'markdown', 'html'] as const

/** Run the built CLI in demo mode with STRIPE_SECRET_KEY removed from the env. */
function runDemo(extraArgs: string[] = []) {
  const env = { ...process.env }
  delete env.STRIPE_SECRET_KEY
  return spawnSync(process.execPath, [CLI, '--demo', ...extraArgs], { encoding: 'utf8', env })
}

beforeAll(() => {
  // Self-contained: build the CLI if it isn't present (CI builds first, so
  // this is a no-op there; a cold `vitest run` builds on demand).
  if (!existsSync(CLI)) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })
}, 120_000)

describe('--demo keyless pipeline (capstone)', () => {
  it('runs with no key present without crashing (exit code in {0,1})', () => {
    const { status } = runDemo()
    expect([0, 1]).toContain(status)
  })

  it('runs in every --output format without crashing', () => {
    for (const fmt of OUTPUTS) {
      const { status } = runDemo(['--output', fmt])
      expect([0, 1], `--output ${fmt} exited ${status}`).toContain(status)
    }
  })

  it('prints a branded demo banner, never a missing-key error', () => {
    const { stdout, stderr } = runDemo()
    const combined = stdout + stderr
    expect(combined).toMatch(/demo|sample|example/i)
    expect(combined).not.toMatch(/missing.*key|no api key|STRIPE_SECRET_KEY.*required/i)
  })

  it('emits valid JSON on stdout carrying skipped[] + summary.suppressed', () => {
    const { stdout } = runDemo(['--output', 'json'])
    const parsed = JSON.parse(stdout)
    expect(Array.isArray(parsed.skipped)).toBe(true)
    expect(parsed.summary).toHaveProperty('suppressed')
  })

  it('renders the mandatory Skipped + Suppressed surfaces in every format', () => {
    for (const fmt of OUTPUTS) {
      const { stdout } = runDemo(['--output', fmt])
      expect(stdout, `--output ${fmt}`).toMatch(/skipped/i)
      expect(stdout, `--output ${fmt}`).toMatch(/suppressed/i)
    }
  })

  it('never leaks a Stripe key in any output, even when a --key is supplied', () => {
    // Build the fake key by concatenation so the literal never appears in source
    // (no gitleaks trip, no real secret); the demo must ignore it entirely.
    const fakeKey = 'sk_' + 'test_' + '0'.repeat(24)
    for (const fmt of OUTPUTS) {
      const { stdout, stderr } = runDemo(['--output', fmt, '--key', fakeKey])
      const out = stdout + stderr
      // Key-prefix coaching may surface a REDACTED prefix (e.g.
      // sk_test_******0000) — that is NOT a leak (redact() masks the secret body).
      // The guard forbids the full key value and any unredacted key body (a prefix
      // followed by a run of real key chars) while permitting the masked form.
      expect(out, `--output ${fmt}`).not.toContain(fakeKey)
      expect(out, `--output ${fmt}`).not.toMatch(/(sk|rk)_(live|test)_[A-Za-z0-9]{12,}/)
    }
  })
})
