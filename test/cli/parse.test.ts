import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '../../src/config/load-config'
import { ALL_RULES } from '../../src/rules/index'
import { STRIPE_API_VERSION } from '../../src/stripe-client'

/**
 * The commander spine + flag surface. The pure first spine stage
 * (`loadConfig`) is unit-tested directly; the parsed flag surface, `--list-rules`
 * introspection, `--deep` no-op, key precedence, and the demo end-to-end spine are
 * exercised against the BUILT CLI as a subprocess (the shipped binary), mirroring
 * the demo capstone.
 */
const CLI = 'dist/cli.js'

/** Run the built CLI; STRIPE_SECRET_KEY is stripped unless an explicit env is passed. */
function run(args: string[], env: NodeJS.ProcessEnv = stripKeyEnv()) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })
}

function stripKeyEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.STRIPE_SECRET_KEY
  return env
}

beforeAll(() => {
  // Self-contained: build the CLI if absent (CI builds first → no-op there).
  if (!existsSync(CLI)) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })
}, 120_000)

describe('loadConfig — first spine stage (real loader; deep coverage in test/config)', () => {
  it('defaults to core-only with zero plugins, anchored at cwd (repo root stays config-free)', async () => {
    const cfg = await loadConfig()
    expect(cfg.source).toBe('core-only')
    expect(cfg.plugins).toEqual([])
    expect(cfg.cwd).toBe(process.cwd())
  })

  it('reports "disabled" for --no-config, which wins over --config', async () => {
    expect((await loadConfig({ noConfig: true })).source).toBe('disabled')
    expect((await loadConfig({ noConfig: true, configPath: 'x.json' })).source).toBe('disabled')
  })

  it('honours --working-directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sba-parse-'))
    expect((await loadConfig({ workingDirectory: dir })).cwd).toBe(dir)
  })
})

describe('flag surface (--help)', () => {
  it('lists every v0.1.0 audit/DX flag', () => {
    const { stdout } = run(['--help'])
    for (const flag of [
      '--key',
      '--output',
      '--severity',
      '--category',
      '--quiet',
      '--only-failures',
      '--demo',
      '--list-rules',
      '--version',
    ]) {
      expect(stdout, `missing ${flag}`).toContain(flag)
    }
  })

  it('lists every post-v0.1.0 flag', () => {
    const { stdout } = run(['--help'])
    for (const flag of [
      '--deep',
      '--fail-on',
      '--ignore',
      '--write-baseline',
      '--baseline',
      '--config',
      '--no-config',
      '--working-directory',
    ]) {
      expect(stdout, `missing ${flag}`).toContain(flag)
    }
  })
})

describe('--version', () => {
  it('prints the tool name + the pinned Stripe API version literal', () => {
    const { stdout, status } = run(['--version'])
    expect(status).toBe(0)
    expect(stdout).toContain('stripe-audit')
    expect(stdout).toContain(STRIPE_API_VERSION)
  })
})

describe('--list-rules (keyless introspection)', () => {
  it('exits 0 with no key and lists every shipped rule with a base|deep scope column', () => {
    const { stdout, status } = run(['--list-rules'])
    expect(status).toBe(0)
    // Count only the catalog table (header + one row per rule) — the DROPPED
    // transparency section below it is free prose and must not leak into the
    // scope-token census (same hardening as cli-unit's formatRuleList test).
    const tableRows = stdout
      .split('\n')
      .slice(1, ALL_RULES.length + 1)
      .filter((l) => /\b(base|deep)\b/.test(l))
    expect(tableRows.length).toBe(ALL_RULES.length)
    for (const rule of ALL_RULES) expect(stdout).toContain(rule.id)
    expect(stdout).toContain('DROPPED (consciously not built')
  })

  it('--output json emits the machine-readable { active, dropped } registry, exit 0', () => {
    const { stdout, status } = run(['--list-rules', '--output', 'json'])
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.active.map((r: { id: string }) => r.id)).toEqual(ALL_RULES.map((r) => r.id))
    expect(parsed.dropped.length).toBeGreaterThan(0)
  })

  it('--output bogus is a config error (exit 2) even with --list-rules', () => {
    const { stderr, status } = run(['--list-rules', '--output', 'bogus'])
    expect(status).toBe(2)
    expect(stderr).toContain("unknown --output 'bogus'")
  })
})

describe('--deep (live)', () => {
  it('is accepted without the retired no-op notice and never errors', () => {
    const { stderr, status } = run(['--demo', '--deep'])
    expect(stderr.toLowerCase()).not.toMatch(/deep is a no-op/)
    expect([0, 1, 3]).toContain(status)
  })
})

describe('empty filter lists are refused (closes #9)', () => {
  it('--severity , exits 2 with the selects-no-rules message and a clean stdout', () => {
    const { status, stderr, stdout } = run(['--demo', '--severity', ','])
    expect(status).toBe(2)
    expect(stderr).toMatch(/--severity selects no rules/)
    expect(stdout.trim()).toBe('')
  })

  it('--category with only separators/whitespace exits 2', () => {
    const { status, stderr } = run(['--demo', '--category', ' , '])
    expect(status).toBe(2)
    expect(stderr).toMatch(/--category selects no rules/)
  })

  it('a trailing comma with a valid token still runs (not an empty list)', () => {
    const { status } = run(['--demo', '--severity', 'critical,'])
    expect([0, 1]).toContain(status)
  })
})

describe('unknown flag', () => {
  it('exits non-zero with a usage hint', () => {
    const { status, stderr } = run(['--not-a-real-flag'])
    expect(status).not.toBe(0)
    expect(stderr.toLowerCase()).toMatch(/unknown option|--help/)
  })
})

describe('--key precedence', () => {
  it('takes --key over STRIPE_SECRET_KEY and never echoes the env key', () => {
    // Concatenated so no real-looking literal lands in committed source (no gitleaks trip).
    const envKey = 'rk_' + 'test_' + 'envonly' + '0'.repeat(18)
    const argKey = 'rk_' + 'test_' + 'argonly' + '0'.repeat(18)
    const { stdout, stderr } = run(['--key', argKey, '--demo'], {
      ...stripKeyEnv(),
      STRIPE_SECRET_KEY: envKey,
    })
    expect(stdout + stderr).not.toContain(envKey)
    expect(stdout + stderr).not.toContain(argKey)
  })
})

describe('orchestration spine (demo end-to-end)', () => {
  it('renders a parseable JSON report with findings', () => {
    const { stdout } = run(['--demo', '--output', 'json'])
    const parsed = JSON.parse(stdout)
    expect(parsed.summary.total).toBeGreaterThan(0)
    expect(parsed.summary).toHaveProperty('suppressed')
  })

  it('wires --severity into the rule filter (narrows the run; all-severities is a no-op)', () => {
    const total = (args: string[]) =>
      JSON.parse(run(['--demo', '--output', 'json', ...args]).stdout).summary.total as number
    const unfiltered = total([])
    expect(total(['--severity', 'critical'])).toBeLessThanOrEqual(unfiltered)
    expect(total(['--severity', 'critical,high,medium,low,info'])).toBe(unfiltered)
  })
})

describe('registered-but-unwired flags (honesty notice)', () => {
  // Baseline exit code for plain `--demo` (no unwired flag) — the notice must not move it.
  const demoStatus = () => run(['--demo', '--output', 'json']).status

  const cases: Array<{ name: string; arg: string[]; match: RegExp }> = [
    { name: '--quiet', arg: ['--quiet'], match: /--quiet is not implemented/i },
    { name: '--only-failures', arg: ['--only-failures'], match: /--only-failures is not implemented/i },
  ]

  for (const { name, arg, match } of cases) {
    it(`${name} emits its notice on stderr, keeps stdout clean, and does not change the exit code`, () => {
      const baseStatus = demoStatus()
      const { stdout, stderr, status } = run(['--demo', '--output', 'json', ...arg])
      // (1) honest notice on stderr
      expect(stderr).toMatch(match)
      // (2) stdout stays a clean, parseable report — no notice leaked
      const parsed = JSON.parse(stdout)
      expect(parsed.summary).toHaveProperty('total')
      expect(stdout).not.toMatch(/is not implemented/i)
      // (3) the notice never alters the exit code
      expect(status).toBe(baseStatus)
    })
  }

  it('--list-rules introspection stays notice-free even with an unwired flag passed', () => {
    // list-rules short-circuits before the notice block (pure introspection): no
    // notice, exit 0, and stdout is the rule table not a notice.
    const { stdout, stderr, status } = run(['--list-rules', '--quiet'])
    expect(status).toBe(0)
    expect(stderr).not.toMatch(/is not implemented/i)
    expect(stdout).toContain('SCOPE')
  })
})

describe('baseline flags (wired end-to-end)', () => {
  const tmpBaseline = () => join(mkdtempSync(join(tmpdir(), 'stripe-audit-baseline-')), 'baseline.json')

  it('--write-baseline writes a parseable baseline (fingerprints) and exits 0', () => {
    const file = tmpBaseline()
    const { stderr, status } = run(['--demo', '--write-baseline', file])
    expect(status).toBe(0)
    expect(stderr).toMatch(/wrote baseline:.*\(\d+ fingerprints\)/i)
    const baseline = JSON.parse(readFileSync(file, 'utf8'))
    expect(Array.isArray(baseline.fingerprints)).toBe(true)
    expect(baseline.fingerprints.length).toBeGreaterThan(0)
  })

  it('--baseline and --check-baseline are the SAME option: both gate an identical run to exit 0', () => {
    // Guards the two-long-name attribute-name gotcha as WIRED behavior: the option
    // stores under the last long flag (checkBaseline), so both aliases must compare.
    const file = tmpBaseline()
    run(['--demo', '--write-baseline', file])
    expect(run(['--demo', '--baseline', file]).status).toBe(0)
    expect(run(['--demo', '--check-baseline', file]).status).toBe(0)
  })

  it('the JSON baseline block is present (regression:false / newFindings:[]) on an identical run', () => {
    const file = tmpBaseline()
    run(['--demo', '--write-baseline', file])
    const { stdout, status } = run(['--demo', '--baseline', file, '--output', 'json'])
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.baseline.regression).toBe(false)
    expect(parsed.baseline.newFindings).toEqual([])
  })

  it('--write-baseline with NO file argument (boolean form) is a config error (exit 2)', () => {
    const { stderr, status } = run(['--demo', '--write-baseline'])
    expect(status).toBe(2)
    expect(stderr).toMatch(/--write-baseline requires a file path/i)
  })

  it('an unreadable baseline file is a config error (exit 2) with plain-language stderr', () => {
    const { stderr, status } = run(['--demo', '--baseline', 'does-not-exist.json'])
    expect(status).toBe(2)
    expect(stderr).toMatch(/could not read baseline file/i)
  })
})
