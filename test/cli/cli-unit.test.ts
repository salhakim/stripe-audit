import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as cli from '../../src/cli'
import * as stripeClientModule from '../../src/stripe-client'
import * as fetcherModule from '../../src/fetcher'
import { ALL_RULES } from '../../src/rules/index'
import { DROPPED_RULES } from '../../src/rules/dropped'
import { EXIT_CONFIG, EXIT_RUNTIME, EXIT_OK, EXIT_FINDINGS, DEFAULT_FAIL_ON } from '../../src/exit-codes'
import type { StripeAccountSnapshot } from '../../src/types'
import allIssues from '../fixtures/snapshots/all-issues@2026-06-24.dahlia.json'

/**
 * cli-coverage-001 (TIER 4 security) — the IN-PROCESS cli unit layer.
 *
 * `src/cli.ts` was previously exercised ONLY as a subprocess (test/cli/parse.test.ts
 * spawns `dist/cli.js`), which v8 in-process instrumentation cannot see — leaving the
 * module at 0% coverage. Now that the module is import-safe (its two top-level side
 * effects sit behind `require.main === module`), this suite imports it directly and
 * drives every exported function plus `runCli`'s branches in-process.
 *
 * SECURITY: no resolved key is ever echoed. `STRIPE_SECRET_KEY` is
 * stripped from the env for the whole suite so a stray ambient key can never leak into
 * a real network call or assertion; key-precedence is proved with an EXPLICIT env
 * object, and the live-fetch paths pass a fabricated key whose full value is asserted
 * absent from all captured output.
 */

/** The bundled all-issues sample, reused as the live-fetch snapshot for the spy paths. */
const DEMO = allIssues as unknown as StripeAccountSnapshot

/** Fabricated keys — concatenated so no real-looking literal lands in source (no gitleaks trip). */
const ARG_KEY = 'rk_' + 'test_' + 'argonly' + '0'.repeat(20)
const ENV_KEY = 'rk_' + 'test_' + 'envonly' + '0'.repeat(20)
const LIVE_KEY = 'rk_' + 'live_' + 'spied' + '0'.repeat(20)

interface RunResult {
  stdout: string
  stderr: string
  exitCode: number | undefined
}

/**
 * Drive one CLI invocation in-process behind a capture-and-restore harness:
 * stub process.stdout/stderr.write, reset+capture process.exitCode, run the parsed
 * program via `parseAsync(args, { from: 'user' })` (no argv[0]/argv[1] prefix), then
 * restore everything so the test worker's own streams and exit code are untouched.
 */
async function drive(args: string[]): Promise<RunResult> {
  const out: string[] = []
  const err: string[] = []
  const prevExitCode = process.exitCode
  process.exitCode = undefined
  const outSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown) => {
      out.push(String(chunk))
      return true
    }) as typeof process.stdout.write)
  const errSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: unknown) => {
      err.push(String(chunk))
      return true
    }) as typeof process.stderr.write)
  try {
    await cli.buildProgram().parseAsync(args, { from: 'user' })
  } finally {
    outSpy.mockRestore()
    errSpy.mockRestore()
  }
  const exitCode = typeof process.exitCode === 'number' ? process.exitCode : undefined
  process.exitCode = prevExitCode
  return { stdout: out.join(''), stderr: err.join(''), exitCode }
}

let savedAmbientKey: string | undefined
beforeEach(() => {
  savedAmbientKey = process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_SECRET_KEY
})
afterEach(() => {
  if (savedAmbientKey === undefined) delete process.env.STRIPE_SECRET_KEY
  else process.env.STRIPE_SECRET_KEY = savedAmbientKey
  vi.restoreAllMocks()
})

describe('resolveKey (explicit env — never touches the ambient process.env)', () => {
  it('takes --key over STRIPE_SECRET_KEY', () => {
    expect(cli.resolveKey(ARG_KEY, { STRIPE_SECRET_KEY: ENV_KEY } as NodeJS.ProcessEnv)).toBe(ARG_KEY)
  })
  it('falls back to STRIPE_SECRET_KEY when --key is absent', () => {
    expect(cli.resolveKey(undefined, { STRIPE_SECRET_KEY: ENV_KEY } as NodeJS.ProcessEnv)).toBe(ENV_KEY)
  })
  it('is undefined when neither is set', () => {
    expect(cli.resolveKey(undefined, {} as NodeJS.ProcessEnv)).toBeUndefined()
  })
})

describe('buildRuleFilter', () => {
  it('parses --severity into a severity filter', () => {
    const f = cli.buildRuleFilter({ severity: 'critical,high' })
    expect(f?.severity).toEqual(['critical', 'high'])
    expect(f?.category).toBeUndefined()
  })
  it('parses --category into a category filter', () => {
    const f = cli.buildRuleFilter({ category: 'billing,webhooks' })
    expect(f?.category).toEqual(['billing', 'webhooks'])
  })
  it('drops unknown tokens leniently', () => {
    expect(cli.buildRuleFilter({ severity: 'critical,bogus' })?.severity).toEqual(['critical'])
  })
  it('is undefined when neither severity nor category is set', () => {
    expect(cli.buildRuleFilter({})).toBeUndefined()
  })

  it('normalizes lists deterministically — sorted + deduped regardless of typed order', () => {
    expect(cli.buildRuleFilter({ severity: 'high,critical,high' })?.severity).toEqual([
      'critical',
      'high',
    ])
    expect(cli.buildRuleFilter({ category: 'webhooks,billing,webhooks' })?.category).toEqual([
      'billing',
      'webhooks',
    ])
  })
})

describe('formatRuleList', () => {
  it('renders a labelled header and one row per rule with a base|deep scope column', () => {
    const out = cli.formatRuleList()
    const lines = out.split('\n')
    for (const col of ['ID', 'SCOPE', 'CATEGORY', 'SEVERITY']) expect(lines[0]).toContain(col)
    // header + one row per rule + blank + DROPPED header + one row per dropped rule
    expect(lines.length).toBe(ALL_RULES.length + 1 + 2 + DROPPED_RULES.length)
    for (const rule of ALL_RULES) expect(out).toContain(rule.id)
    for (const row of lines.slice(1, ALL_RULES.length + 1)) expect(row).toMatch(/\b(base|deep)\b/)
  })

  it('renders the DROPPED transparency section from DROPPED_RULES', () => {
    const out = cli.formatRuleList()
    expect(out).toContain('DROPPED (consciously not built')
    for (const dropped of DROPPED_RULES) {
      expect(out).toContain(dropped.id)
      expect(out).toContain(dropped.reason)
    }
    // The dropped radar rule appears ONLY in the DROPPED section — never as a
    // shipped row (its verify-gate landed DROPPED; the rule file must not exist).
    expect(ALL_RULES.some((r) => r.id === 'RADAR_SETUP_INTENTS_NOT_ENABLED')).toBe(false)
  })
})

describe('formatRuleListJson (machine-readable registry — the docs-drift interface)', () => {
  it('emits { active, dropped } covering both registries with the full field set', () => {
    const parsed = JSON.parse(cli.formatRuleListJson())
    expect(parsed.active.map((r: { id: string }) => r.id)).toEqual(ALL_RULES.map((r) => r.id))
    expect(parsed.dropped.map((d: { id: string }) => d.id)).toEqual(DROPPED_RULES.map((d) => d.id))
    for (const r of parsed.active) {
      expect(['base', 'deep']).toContain(r.scope)
      expect(typeof r.category).toBe('string')
      expect(typeof r.severity).toBe('string')
    }
    for (const d of parsed.dropped) {
      expect(typeof d.reason).toBe('string')
      expect(typeof d.decidedIn).toBe('string')
      expect(typeof d.evidence).toBe('string')
      expect(['api-gap', 'scope-gated', 'low-value']).toContain(d.category)
    }
  })

  it('carries revisitCondition only where one exists (no undefined keys)', () => {
    const parsed = JSON.parse(cli.formatRuleListJson())
    for (const d of parsed.dropped) {
      const source = DROPPED_RULES.find((x) => x.id === d.id)
      expect(Object.hasOwn(d, 'revisitCondition')).toBe(source?.revisitCondition !== undefined)
    }
    expect(parsed.dropped.some((d: { revisitCondition?: string }) => d.revisitCondition)).toBe(true)
  })

  it('every dropped reason is backed by a cached doc or a verify-gate verdict', () => {
    // A drop reason is printed to users by --list-rules, so it carries the same
    // evidence burden as a finding. Generic "see the audit" strings are what let a
    // false claim (TRIAL_WITHOUT_PAYMENT_COLLECTION) ship for a month.
    for (const d of DROPPED_RULES) {
      expect(d.evidence).toMatch(/^(learnings\/stack-documentation\/|docs\/)/)
      expect(d.evidence).toMatch(/\.md$/)
    }
  })

  it('no dropped entry claims unreadable what the cached docs show as readable', () => {
    const stale = [/not readable via the API/i, /no coupon-to-price linkage/i]
    for (const d of DROPPED_RULES) {
      for (const pattern of stale) {
        expect(d.reason).not.toMatch(pattern)
      }
    }
  })

  it('renders the dropped category column in the human table', () => {
    const out = cli.formatRuleList()
    for (const d of DROPPED_RULES) {
      const row = out.split('\n').find((l) => l.startsWith(d.id))
      expect(row).toBeDefined()
      expect(row).toContain(d.category)
      expect(row).toContain(d.reason)
    }
  })

  it('keeps every rule ID underscore-bearing (reconcile-regex invariant)', () => {
    const parsed = JSON.parse(cli.formatRuleListJson())
    for (const { id } of [...parsed.active, ...parsed.dropped]) {
      expect(id).toMatch(/^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/)
    }
  })
})

describe('runAudit / runDemoAudit (the keyless demo spine)', () => {
  it('runAudit assembles a canonical result over a snapshot', () => {
    const result = cli.runAudit(DEMO, {})
    expect(result.summary.total).toBeGreaterThan(0)
    expect(result.summary).toHaveProperty('suppressed')
    expect(Array.isArray(result.findings)).toBe(true)
  })
  it('runDemoAudit renders the bundled demo in the requested format', () => {
    const parsed = JSON.parse(cli.runDemoAudit('json'))
    expect(parsed.summary.total).toBeGreaterThan(0)
  })
})

describe('runAudit — filter provenance', () => {
  it('records the normalized filter on the result; the key is ABSENT unfiltered', () => {
    expect(cli.runAudit(DEMO, {})).not.toHaveProperty('filter')
    const result = cli.runAudit(DEMO, { severity: 'low' })
    expect(result.filter).toEqual({ severity: ['low'] })
  })

  it('--demo --severity low labels the console report and carries filter in JSON', async () => {
    const rJson = await drive(['--demo', '--severity', 'low', '--output', 'json'])
    expect(JSON.parse(rJson.stdout).filter).toEqual({ severity: ['low'] })
    const rConsole = await drive(['--demo', '--severity', 'low'])
    expect(rConsole.stdout).toMatch(/Grade [A-F] \(filtered\)/)
    expect(rConsole.stdout).toContain('Coverage: FILTERED (severity=low)')
    expect(rConsole.stdout).not.toContain('Coverage: full')
  })

  it('an unfiltered --demo run still reads "Coverage: full" with no filter key (byte-unchanged)', async () => {
    const r = await drive(['--demo', '--output', 'json'])
    expect(JSON.parse(r.stdout)).not.toHaveProperty('filter')
    const rConsole = await drive(['--demo'])
    expect(rConsole.stdout).toContain('Coverage: full')
    expect(rConsole.stdout).not.toMatch(/\(filtered\)/)
  })

  it('recording the filter never changes the exit-code class for the same active findings (E3)', async () => {
    // An all-severities filter selects every rule, so the active findings are the
    // same set as the unfiltered run — only the filter label differs. The exit
    // code must be a pure function of findings + fail-on, never of the label.
    const unfiltered = await drive(['--demo', '--output', 'json'])
    const labelled = await drive([
      '--demo',
      '--severity',
      'critical,high,medium,low,info',
      '--output',
      'json',
    ])
    const findingIds = (raw: string) =>
      (JSON.parse(raw).findings as Array<{ ruleId: string }>).map((f) => f.ruleId).sort()
    expect(findingIds(labelled.stdout)).toEqual(findingIds(unfiltered.stdout))
    expect(JSON.parse(labelled.stdout).filter).toBeDefined()
    expect(labelled.exitCode).toBe(unfiltered.exitCode)
    // And directly at the decision seam: the filter key on the result is inert.
    const base = cli.runAudit(DEMO, {})
    const withLabel = cli.runAudit(DEMO, { severity: 'critical,high,medium,low,info' })
    expect(cli.decideExit(withLabel, {}, DEFAULT_FAIL_ON)).toBe(
      cli.decideExit(base, {}, DEFAULT_FAIL_ON),
    )
  })
})

describe('buildProgram (flag surface + commander exit handling)', () => {
  it('registers the full v0.1.0 flag surface', () => {
    const program = cli.buildProgram()
    const longs = program.options.map((o) => o.long)
    for (const flag of [
      '--key',
      '--output',
      '--severity',
      '--category',
      '--quiet',
      '--only-failures',
      '--demo',
      '--list-rules',
      '--deep',
      '--fail-on',
      '--ignore',
      '--write-baseline',
      '--config',
      '--working-directory',
    ]) {
      expect(longs, `missing ${flag}`).toContain(flag)
    }
    expect(program.name()).toBe('stripe-audit')
  })

  it('--version throws a CommanderError under exitOverride (never exits the worker)', async () => {
    const program = cli.buildProgram().exitOverride()
    vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as typeof process.stdout.write)
    await expect(program.parseAsync(['--version'], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.version',
    })
  })

  it('an unknown flag throws a CommanderError under exitOverride', async () => {
    const program = cli.buildProgram().exitOverride()
    vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as typeof process.stderr.write)
    await expect(program.parseAsync(['--not-a-real-flag'], { from: 'user' })).rejects.toMatchObject({
      code: 'commander.unknownOption',
    })
  })
})

describe('runCli — configuration validation (exit 2)', () => {
  it('rejects an unknown --output with a stderr notice', async () => {
    const r = await drive(['--output', 'bogus'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/unknown --output/)
  })
  it('rejects an invalid --fail-on level', async () => {
    const r = await drive(['--fail-on', 'sometimes'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/invalid --fail-on/)
  })
  it('rejects an invalid --severity token', async () => {
    const r = await drive(['--severity', 'spicy'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/invalid --severity/)
  })
  it('rejects an invalid --category token', async () => {
    const r = await drive(['--category', 'kittens'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/invalid --category/)
  })

  it('rejects an EMPTY --severity list — selects no rules (closes #9)', async () => {
    const r = await drive(['--demo', '--severity', ','])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/--severity selects no rules/)
    expect(r.stdout.trim()).toBe('')
  })

  it('rejects an EMPTY --category list (separators/whitespace only)', async () => {
    const r = await drive(['--demo', '--category', ' , '])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/--category selects no rules/)
  })
})

describe('runCli — keyless short-circuits', () => {
  it('--list-rules prints the rule table and sets no error exit code', async () => {
    const r = await drive(['--list-rules'])
    expect(r.stdout).toContain('SCOPE')
    for (const rule of ALL_RULES) expect(r.stdout).toContain(rule.id)
    expect(r.exitCode).toBeUndefined()
  })

  it('--demo renders a parseable report on stdout and exits 0|1', async () => {
    const r = await drive(['--demo', '--output', 'json'])
    const parsed = JSON.parse(r.stdout)
    expect(parsed.summary.total).toBeGreaterThan(0)
    expect([EXIT_OK, EXIT_FINDINGS]).toContain(r.exitCode)
    expect(r.stderr).toMatch(/demo mode/)
  })

  it('no key and no --demo → onboarding panel on stderr, clean stdout, exit 2', async () => {
    const r = await drive([])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr.toLowerCase()).toMatch(/read-only|never writes/)
    expect(r.stdout.trim()).toBe('')
  })
})

describe('runCli — registered-but-unwired honesty notices (stderr only, exit code unchanged)', () => {
  // --write-baseline / --baseline are WIRED and asserted separately below;
  // only --quiet / --only-failures remain honest "not implemented" notices. --deep
  // went LIVE — its retired no-op notice is asserted absent below.
  const cases: Array<{ name: string; args: string[]; match: RegExp }> = [
    { name: '--quiet', args: ['--quiet'], match: /--quiet is not implemented/i },
    { name: '--only-failures', args: ['--only-failures'], match: /--only-failures is not implemented/i },
  ]
  for (const { name, args, match } of cases) {
    it(`${name} emits its notice on stderr while stdout stays a clean report`, async () => {
      const r = await drive(['--demo', '--output', 'json', ...args])
      expect(r.stderr).toMatch(match)
      expect(() => JSON.parse(r.stdout)).not.toThrow()
    })
  }

  it('--deep no longer emits the retired v0.1.0 no-op notice', async () => {
    const r = await drive(['--demo', '--output', 'json', '--deep'])
    expect(r.stderr).not.toMatch(/deep is a no-op/i)
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })

  it('--demo --deep emits the honesty notice (bundled sample is base-mode), stdout clean', async () => {
    const r = await drive(['--demo', '--output', 'json', '--deep'])
    expect(r.stderr).toMatch(/--deep has no effect in demo mode/i)
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })

  it('--demo without --deep emits no deep-mode notice', async () => {
    const r = await drive(['--demo', '--output', 'json'])
    expect(r.stderr).not.toMatch(/--deep has no effect/i)
  })

  it('no key + --deep routes the deep onboarding checklist through runCli (exit 2)', async () => {
    const r = await drive(['--deep'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toContain('• Coupons: Read')
    expect(r.stderr).toContain('stripe-audit --deep --key')
  })
})

describe('runCli — baseline flags (wired)', () => {
  it('--write-baseline with NO path is a config error (exit 2), stdout stays clean', async () => {
    const r = await drive(['--demo', '--output', 'json', '--write-baseline'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/--write-baseline requires a file path/i)
    expect(r.stderr).not.toMatch(/not implemented/i)
    expect(() => JSON.parse(r.stdout)).not.toThrow()
  })

  it('--baseline with an unreadable file is a config error (exit 2), plain-language stderr', async () => {
    // The baseline load is a pre-audit config gate: it exits 2 BEFORE the report
    // renders, so stdout stays empty (no partial/garbled report leaks).
    const r = await drive(['--demo', '--output', 'json', '--baseline', 'does-not-exist.json'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/could not read baseline file/i)
    expect(r.stderr).not.toMatch(/not implemented/i)
    expect(r.stdout.trim()).toBe('')
  })
})

describe('runCli — baseline filter-scope gate', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sba-c14-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('unfiltered baseline + filtered check → exit 2, both scopes named, stdout clean', async () => {
    const p = join(dir, 'base.json')
    await drive(['--demo', '--output', 'json', '--write-baseline', p])
    const r = await drive(['--demo', '--baseline', p, '--severity', 'low'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/baseline scope mismatch/i)
    expect(r.stderr).toContain('full (unfiltered)')
    expect(r.stderr).toContain('filtered (severity=low)')
    // No spurious "-N resolved" report ever renders — stdout stays empty.
    expect(r.stdout.trim()).toBe('')
  })

  it('filtered baseline + unfiltered check → exit 2 (the mismatch is two-sided)', async () => {
    const p = join(dir, 'base.json')
    await drive(['--demo', '--severity', 'low', '--output', 'json', '--write-baseline', p])
    expect(JSON.parse(readFileSync(p, 'utf8')).filter).toEqual({ severity: ['low'] })
    const r = await drive(['--demo', '--baseline', p])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/baseline scope mismatch/i)
  })

  it('filtered baseline + SAME-scope check compares clean (no mismatch, exit 0 on identical run)', async () => {
    const p = join(dir, 'base.json')
    await drive(['--demo', '--severity', 'low', '--output', 'json', '--write-baseline', p])
    const r = await drive(['--demo', '--baseline', p, '--severity', 'low', '--output', 'json'])
    expect(r.stderr).not.toMatch(/mismatch/i)
    expect(r.exitCode).toBe(EXIT_OK)
    expect(JSON.parse(r.stdout).baseline.regression).toBe(false)
  })

  it('scope equality is order-insensitive: severity=low,high baseline vs high,low check', async () => {
    const p = join(dir, 'base.json')
    await drive(['--demo', '--severity', 'low,high', '--output', 'json', '--write-baseline', p])
    const r = await drive(['--demo', '--baseline', p, '--severity', 'high,low', '--output', 'json'])
    expect(r.stderr).not.toMatch(/mismatch/i)
    expect(r.exitCode).toBe(EXIT_OK)
  })

  it('a legacy baseline file (no filter field) + unfiltered check still passes (back-compat)', async () => {
    const p = join(dir, 'base.json')
    await drive(['--demo', '--output', 'json', '--write-baseline', p])
    // The unfiltered write records no filter field — exactly the legacy file shape.
    expect(JSON.parse(readFileSync(p, 'utf8'))).not.toHaveProperty('filter')
    const r = await drive(['--demo', '--baseline', p, '--output', 'json'])
    expect(r.exitCode).toBe(EXIT_OK)
    expect(r.stderr).not.toMatch(/mismatch/i)
    expect(JSON.parse(r.stdout).baseline.regression).toBe(false)
  })
})

describe('runCli — live-fetch path (createStripeClient + fetchAccountSnapshot spied via vi.spyOn)', () => {
  it('success: spied fetch → report on stdout, exit 0|1, key never echoed (S1)', async () => {
    vi.spyOn(stripeClientModule, 'createStripeClient').mockReturnValue(
      {} as unknown as ReturnType<typeof stripeClientModule.createStripeClient>,
    )
    vi.spyOn(fetcherModule, 'fetchAccountSnapshot').mockResolvedValue(DEMO)
    const r = await drive(['--key', LIVE_KEY, '--output', 'json'])
    const parsed = JSON.parse(r.stdout)
    expect(parsed.summary).toHaveProperty('total')
    expect([EXIT_OK, EXIT_FINDINGS]).toContain(r.exitCode)
    expect(r.stdout + r.stderr).not.toContain(LIVE_KEY)
  })

  it('error: spied fetch rejects → translated stderr message, exit 3, key never echoed (S1)', async () => {
    vi.spyOn(stripeClientModule, 'createStripeClient').mockReturnValue(
      {} as unknown as ReturnType<typeof stripeClientModule.createStripeClient>,
    )
    vi.spyOn(fetcherModule, 'fetchAccountSnapshot').mockRejectedValue(new Error('boom-401'))
    const r = await drive(['--key', LIVE_KEY])
    expect(r.exitCode).toBe(EXIT_RUNTIME)
    expect(r.stderr.length).toBeGreaterThan(0)
    expect(r.stdout + r.stderr).not.toContain(LIVE_KEY)
  })

  it('--deep with missing deep scopes → stderr names the exact permissions + link, no key echo', async () => {
    vi.spyOn(stripeClientModule, 'createStripeClient').mockReturnValue(
      {} as unknown as ReturnType<typeof stripeClientModule.createStripeClient>,
    )
    const deepDenied = {
      ...DEMO,
      auditScope: 'deep' as const,
      scopeProbe: [
        ...DEMO.scopeProbe,
        { scope: 'subscriptions' as const, granted: false },
        { scope: 'meters' as const, granted: true },
        { scope: 'event_destinations' as const, granted: false },
        { scope: 'coupons' as const, granted: true },
      ],
    }
    vi.spyOn(fetcherModule, 'fetchAccountSnapshot').mockResolvedValue(deepDenied)
    const r = await drive(['--key', LIVE_KEY, '--deep', '--output', 'json'])
    // The missing-list line names ONLY the denied scopes (granted ones excluded);
    // the full grant checklist on the link line legitimately lists everything.
    expect(r.stderr).toMatch(/deep scopes not granted on this key: Subscriptions, Event Destinations\./)
    expect(r.stderr).toContain('https://dashboard.stripe.com/apikeys')
    expect(r.stderr).toMatch(/provisional/i)
    expect(() => JSON.parse(r.stdout)).not.toThrow() // stdout stays a clean report
    expect(r.stdout + r.stderr).not.toContain(LIVE_KEY) // S1
    expect(r.stderr).not.toMatch(/(rk|sk)_(test|live)_[A-Za-z0-9]{6}/) // no key material at all
  })

  it('--deep with every deep scope granted emits NO missing-scope notice', async () => {
    vi.spyOn(stripeClientModule, 'createStripeClient').mockReturnValue(
      {} as unknown as ReturnType<typeof stripeClientModule.createStripeClient>,
    )
    const deepGranted = {
      ...DEMO,
      auditScope: 'deep' as const,
      scopeProbe: [
        ...DEMO.scopeProbe,
        { scope: 'subscriptions' as const, granted: true },
        { scope: 'meters' as const, granted: true },
        { scope: 'event_destinations' as const, granted: true },
        { scope: 'coupons' as const, granted: true },
      ],
    }
    vi.spyOn(fetcherModule, 'fetchAccountSnapshot').mockResolvedValue(deepGranted)
    const r = await drive(['--key', LIVE_KEY, '--deep', '--output', 'json'])
    expect(r.stderr).not.toContain('deep scopes not granted')
  })
})

describe('import safety (Elevation 2 — locks the require.main guard against regression)', () => {
  it('importing src/cli.ts produces no stdout, no stderr, and no exit-code change', async () => {
    vi.resetModules()
    const out: string[] = []
    const err: string[] = []
    const prevExit = process.exitCode
    const outSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(((chunk: unknown) => {
        out.push(String(chunk))
        return true
      }) as typeof process.stdout.write)
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: unknown) => {
        err.push(String(chunk))
        return true
      }) as typeof process.stderr.write)
    await import('../../src/cli')
    outSpy.mockRestore()
    errSpy.mockRestore()
    expect(out.join('')).toBe('')
    expect(err.join('')).toBe('')
    expect(process.exitCode).toBe(prevExit)
  })
})
