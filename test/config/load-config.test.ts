/**
 * The real config loader: discovery, the JSON (data-only) branch,
 * settings precedence, and the fail-loud exit-2 error contract.
 *
 * Unit layer drives `loadConfig` / `applyConfigSettings` directly; the e2e
 * layer drives the in-process CLI (same capture harness as
 * test/cli/cli-unit.test.ts) over fixture working directories. Every fixture
 * lives in its own mkdtemp dir — NEVER the repo root, which must stay
 * config-free so the demo golden output is byte-unchanged (invariant 4).
 *
 * SECURITY: the malformed-config tests plant a marker string in
 * the file and assert it never surfaces in the error output — config errors
 * name the path, never the contents.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig, coreOnlyConfig, ConfigError } from '../../src/config/load-config'
import { configFileSchema } from '../../src/config/config-schema'
import * as cli from '../../src/cli'
import { EXIT_OK, EXIT_FINDINGS, EXIT_CONFIG } from '../../src/exit-codes'
import { MAX_LIST_ITEMS, REQUEST_TIMEOUT_MS, MAX_NETWORK_RETRIES } from '../../src/config/defaults'

/**
 * The three operational knobs carry `.default(<constant>)` in the schema, so
 * EVERY loaded config's `settings` gains them (byte-unchanged runtime values).
 * A file that omits them still resolves to these concrete numbers.
 */
const KNOB_DEFAULTS = {
  maxListItems: MAX_LIST_ITEMS,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  maxNetworkRetries: MAX_NETWORK_RETRIES,
} as const

/** Make a fresh fixture dir; caller-provided files are written into it. */
function fixtureDir(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'sba-config-'))
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content)
  }
  createdDirs.push(dir)
  return dir
}
const createdDirs: string[] = []
afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true })
})

/** In-process CLI capture harness (same shape as test/cli/cli-unit.test.ts). */
interface RunResult {
  stdout: string
  stderr: string
  exitCode: number | undefined
}
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

// A rule id the bundled all-issues demo snapshot reliably fires (see
// test/fixtures/expected/all-issues.expected.json) — used to prove a
// config-file `ignore` actually suppresses.
const DEMO_RULE = 'ACCOUNT_CHARGES_DISABLED'

describe('loadConfig — resolution + discovery', () => {
  it('no config file anywhere → the byte-unchanged core-only default', async () => {
    const dir = fixtureDir()
    const config = await loadConfig({ workingDirectory: dir })
    expect(config).toEqual({ cwd: dir, source: 'core-only', plugins: [] })
  })

  it('coreOnlyConfig mirrors the no-config default shape', async () => {
    const dir = fixtureDir()
    expect(coreOnlyConfig(dir)).toEqual(await loadConfig({ workingDirectory: dir }))
  })

  it('--no-config skips discovery entirely — even an invalid file is never read', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.json': 'not json at all' })
    const config = await loadConfig({ workingDirectory: dir, noConfig: true })
    expect(config.source).toBe('disabled')
    expect(config.plugins).toEqual([])
  })

  it('discovers stripe-audit.config.json in the working directory', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.json': '{ "failOn": "none" }' })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.source).toBe('file')
    expect(config.path).toBe(join(dir, 'stripe-audit.config.json'))
    expect(config.settings).toEqual({ failOn: 'none', ...KNOB_DEFAULTS })
  })

  it('--config resolves a relative path against the working directory', async () => {
    const dir = fixtureDir({ 'my-config.json': '{ "deep": true }' })
    const config = await loadConfig({ workingDirectory: dir, configPath: 'my-config.json' })
    expect(config.source).toBe('file')
    expect(config.path).toBe(join(dir, 'my-config.json'))
    expect(config.settings).toEqual({ deep: true, ...KNOB_DEFAULTS })
  })

  it('a missing --config file is a fail-loud ConfigError naming the path (exit-code 2)', async () => {
    const dir = fixtureDir()
    const err = await loadConfig({ workingDirectory: dir, configPath: 'nope.json' }).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ConfigError)
    expect((err as ConfigError).exitCode).toBe(2)
    expect((err as ConfigError).message).toContain('nope.json')
  })

  it('MORE THAN ONE discovered candidate is fail-loud, naming every candidate', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.json': '{}',
      'stripe-audit.config.mjs': 'export default {}',
    })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(
      /stripe-audit\.config\.json.*stripe-audit\.config\.mjs|2 config files/,
    )
  })

  it('an unsupported extension is a plain-language ConfigError', async () => {
    const dir = fixtureDir({ 'cfg.yaml': 'failOn: none' })
    await expect(loadConfig({ workingDirectory: dir, configPath: 'cfg.yaml' })).rejects.toThrow(
      /unsupported config file extension/,
    )
  })

  it('a directory posing as the config file is "could not read" (EISDIR class)', async () => {
    const dir = fixtureDir()
    mkdirSync(join(dir, 'dir.json'))
    await expect(loadConfig({ workingDirectory: dir, configPath: 'dir.json' })).rejects.toThrow(
      /could not read config file/,
    )
  })
})

describe('loadConfig — JSON validation (data-only; plain-language errors, no content echo)', () => {
  it('invalid JSON names the file, never the contents (S1)', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.json': '{ SECRET_MARKER_9931 not json',
    })
    const err = (await loadConfig({ workingDirectory: dir }).then(
      () => null,
      (e: unknown) => e,
    )) as ConfigError
    expect(err.message).toMatch(/not valid JSON/)
    expect(err.message).not.toContain('SECRET_MARKER_9931')
  })

  it('a schema violation names keys/locations, never the offending values', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.json': '{ "failOn": "SECRET_MARKER_9932" }',
    })
    const err = (await loadConfig({ workingDirectory: dir }).then(
      () => null,
      (e: unknown) => e,
    )) as ConfigError
    expect(err.message).toMatch(/invalid/)
    expect(err.message).toContain('failOn')
    expect(err.message).not.toContain('SECRET_MARKER_9932')
  })

  it('the JSON form rejects a plugins key with the executable-form hint (trust boundary)', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.json': '{ "plugins": ["evil-module"] }',
    })
    const err = (await loadConfig({ workingDirectory: dir }).then(
      () => null,
      (e: unknown) => e,
    )) as ConfigError
    expect(err.message).toContain('"plugins"')
    expect(err.message).toMatch(/executable config form/)
    expect(err.message).not.toContain('evil-module')
  })

  it('an empty severity/category list is rejected (E1a — the bug #9 sibling)', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.json': '{ "severity": [] }' })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(/empty list/)
    expect(configFileSchema.safeParse({ category: [] }).success).toBe(false)
  })

  it('an out-of-range numeric knob is a key-only ConfigError, never echoing the value (S1)', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.json': '{ "requestTimeoutMs": -5 }' })
    const err = (await loadConfig({ workingDirectory: dir }).then(
      () => null,
      (e: unknown) => e,
    )) as ConfigError
    expect(err).toBeInstanceOf(ConfigError)
    expect(err.exitCode).toBe(2)
    expect(err.message).toContain('requestTimeoutMs')
    // Numeric too_small must NOT reuse the array "empty filter" copy.
    expect(err.message).not.toMatch(/empty (list|filter)/)
    // S1 asserts the human-readable REASON never echoes the offending value.
    // The full message embeds the mkdtemp temp-dir path (e.g. ".../sba-config-5.../"),
    // which can incidentally contain "-5"; split on the stable "is invalid:" literal
    // and assert on the reason tail so the check never flakes on the path.
    const reason = err.message.split('is invalid:')[1] ?? err.message
    expect(reason).not.toContain('-5')
  })

  it('E1 — maxListItems: 10000 (one over the SDK ceiling) fails load with exit 2', async () => {
    // Pins the illegal cap+1 footgun: a cap AT the SDK ceiling makes cap+1 = 10001,
    // which the SDK rejects. The .max(LIST_ITEMS_CEILING) bound refuses it at load.
    const dir = fixtureDir({ 'stripe-audit.config.json': '{ "maxListItems": 10000 }' })
    const err = (await loadConfig({ workingDirectory: dir }).then(
      () => null,
      (e: unknown) => e,
    )) as ConfigError
    expect(err).toBeInstanceOf(ConfigError)
    expect(err.exitCode).toBe(2)
    expect(err.message).toContain('maxListItems')
    expect(err.message).toMatch(/maximum/)
  })

  it('maxNetworkRetries: 0 is valid (disables retries) and loads', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.json': '{ "maxNetworkRetries": 0 }' })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.source).toBe('file')
    expect(config.settings?.maxNetworkRetries).toBe(0)
  })

  it('an absent-knob config still resolves the three knobs to their defaults', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.json': '{ "failOn": "none" }' })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.settings).toMatchObject(KNOB_DEFAULTS)
  })

  it('accepts the full settings surface including an inert $schema reference', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.json': JSON.stringify({
        $schema: './node_modules/stripe-audit/schemas/stripe-audit.config.schema.json',
        failOn: 'medium',
        deep: true,
        ignore: ['WEBHOOK_SELECT_ALL'],
        baseline: 'baseline.json',
        output: 'json',
        severity: ['critical', 'high'],
        category: ['billing'],
      }),
    })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.settings).toEqual({
      failOn: 'medium',
      deep: true,
      ignore: ['WEBHOOK_SELECT_ALL'],
      baseline: 'baseline.json',
      output: 'json',
      severity: ['critical', 'high'],
      category: ['billing'],
      ...KNOB_DEFAULTS,
    })
  })
})

describe('loadConfig — executable configs (SECURITY-sensitive)', () => {
  /** A self-contained plain-JS manifest body (ESM syntax) with one rule + one setting. */
  const MANIFEST_ESM = `export default {
  meta: { name: 'fixture-plugin', version: '0.0.1' },
  rules: [{
    id: 'ALWAYS_QUIET',
    name: 'Fixture rule',
    severity: 'low',
    category: 'configuration',
    requires: ['account'],
    check: () => [],
  }],
  failOn: 'none',
}
`

  it('loads an .mjs manifest — rules bridge under meta.name, settings extracted', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.mjs': MANIFEST_ESM })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.source).toBe('file')
    expect(config.plugins).toHaveLength(1)
    expect(config.plugins?.[0].key).toBe('fixture-plugin')
    expect(config.plugins?.[0].rules.map((r) => r.id)).toEqual(['ALWAYS_QUIET'])
    expect(config.settings).toEqual({ failOn: 'none', ...KNOB_DEFAULTS })
  })

  it('loads a .cjs manifest — module.exports arrives as the default export (Node interop)', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.cjs': `module.exports = {
  meta: { name: 'cjs-plugin' },
  rules: [{ id: 'CJS_RULE', name: 'n', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }],
}
`,
    })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.plugins?.[0].key).toBe('cjs-plugin')
    expect(config.plugins?.[0].rules[0].id).toBe('CJS_RULE')
  })

  it('loads a .js manifest whose format follows the USER package.json "type":"module"', async () => {
    const dir = fixtureDir({
      'package.json': '{ "type": "module" }',
      'stripe-audit.config.js': MANIFEST_ESM,
    })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.plugins?.[0].key).toBe('fixture-plugin')
  })

  it('a { plugins: [...] } manifest passes through to the resolveRules shape unchanged', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `export default {
  plugins: [
    { key: 'a', rules: [{ id: 'R1', name: 'n', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }] },
    { key: 'b', rules: [{ id: 'R2', name: 'n', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }] },
  ],
}
`,
    })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.plugins?.map((p) => p.key)).toEqual(['a', 'b'])
  })

  it('unwraps a transpiled-CJS default (__esModule marker) once', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.cjs': `exports.__esModule = true
exports.default = { meta: { name: 'transpiled' }, rules: [{ id: 'T1', name: 'n', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }] }
`,
    })
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.plugins?.[0].key).toBe('transpiled')
  })

  it('a throwing module body is a plain-language ConfigError — never the raw error/stack (S2)', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `throw new Error('SECRET_MARKER_9933')\nexport default {}`,
    })
    const err = (await loadConfig({ workingDirectory: dir }).then(
      () => null,
      (e: unknown) => e,
    )) as ConfigError
    expect(err).toBeInstanceOf(ConfigError)
    expect(err.message).toMatch(/could not load executable config/)
    expect(err.message).not.toContain('SECRET_MARKER_9933')
    expect(err.message).not.toMatch(/at .*:\d+:\d+/)
  })

  it('a manifest referencing a missing import is a ConfigError', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `import nope from './does-not-exist.mjs'\nexport default nope`,
    })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(
      /could not load executable config/,
    )
  })

  it('a non-object default export is a ConfigError', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.mjs': `export default 'just a string'` })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(
      /must default-export a manifest object/,
    )
  })

  it('a missing default export is a ConfigError', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.mjs': `export const notDefault = {}` })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(
      /must default-export a manifest object/,
    )
  })

  it('a thenable default export is a ConfigError (export the manifest synchronously)', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `export default Promise.resolve({ meta: { name: 'late' } })`,
    })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(/thenable/)
  })

  it('rules without meta.name is a ConfigError naming the missing key', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `export default {
  rules: [{ id: 'R', name: 'n', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }],
}
`,
    })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(/meta\.name/)
  })

  it('a rule-shaped violation (check not a function) is a plain-language ConfigError', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `export default { meta: { name: 'p' }, rules: [{ id: 'R' }] }`,
    })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(/is invalid/)
  })

  it('a rule with a typo severity/missing name is rejected — never silently filter-dropped', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `export default {
  meta: { name: 'p' },
  rules: [{ id: 'R', name: 'n', severity: 'sevre', category: 'billing', requires: ['prices'], check: () => [] }],
}
`,
    })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(/is invalid/)
    const noName = fixtureDir({
      'stripe-audit.config.mjs': `export default {
  meta: { name: 'p' },
  rules: [{ id: 'R', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }],
}
`,
    })
    await expect(loadConfig({ workingDirectory: noName })).rejects.toThrow(/is invalid/)
  })

  it('an unknown manifest key is fail-loud (strict manifest, same as the JSON form)', async () => {
    const dir = fixtureDir({
      'stripe-audit.config.mjs': `export default { meta: { name: 'p' }, rulez: [] }`,
    })
    await expect(loadConfig({ workingDirectory: dir })).rejects.toThrow(/unknown key/)
  })

  it('NO auto-discovery: an adjacent installed plugin-looking package is never loaded', async () => {
    // A booby-trapped module INSIDE the working directory's installed-packages
    // tree: importing it would throw. Only the config file the user named (or
    // dropped in cwd) may ever load — discovery must not descend anywhere.
    const dir = fixtureDir({ 'stripe-audit.config.json': '{ "failOn": "none" }' })
    mkdirSync(join(dir, 'node_modules', 'stripe-audit-plugin-evil'), { recursive: true })
    writeFileSync(
      join(dir, 'node_modules', 'stripe-audit-plugin-evil', 'index.mjs'),
      `throw new Error('AUTO_DISCOVERY_EXECUTED')`,
    )
    const config = await loadConfig({ workingDirectory: dir })
    expect(config.source).toBe('file')
    expect(config.plugins).toEqual([]) // JSON form: data only, evil package untouched
    const none = await loadConfig({ workingDirectory: dir, noConfig: true })
    expect(none.plugins).toEqual([])
  })
})

describe('applyConfigSettings — settings precedence (CLI flag > config file > default)', () => {
  const dir = '/fixture-cwd'
  const loaded = (settings: object) =>
    ({ cwd: dir, source: 'file' as const, plugins: [], settings }) as Parameters<
      typeof cli.applyConfigSettings
    >[1]

  it('config settings fill unset flags', () => {
    const eff = cli.applyConfigSettings(
      {},
      loaded({ failOn: 'none', output: 'json', severity: ['low'], deep: true }),
    )
    expect(eff.failOn).toBe('none')
    expect(eff.output).toBe('json')
    expect(eff.severity).toBe('low')
    expect(eff.deep).toBe(true)
  })

  it('an explicit CLI flag outranks the config per-key', () => {
    const eff = cli.applyConfigSettings(
      { failOn: 'high', output: 'console' },
      loaded({ failOn: 'none', output: 'json', category: ['billing'] }),
    )
    expect(eff.failOn).toBe('high')
    expect(eff.output).toBe('console')
    expect(eff.category).toBe('billing') // untouched keys still flow from config
  })

  it('ignore is a UNION-merge, not a precedence pick', () => {
    const eff = cli.applyConfigSettings(
      { ignore: ['FROM_FLAG'] },
      loaded({ ignore: ['FROM_CONFIG'] }),
    )
    expect(eff.ignore).toEqual(['FROM_FLAG', 'FROM_CONFIG'])
  })

  it('the config baseline path resolves against the config cwd', () => {
    const eff = cli.applyConfigSettings({}, loaded({ baseline: 'base.json' }))
    expect(eff.checkBaseline).toBe(join(dir, 'base.json'))
  })

  it('a config baseline never joins a --write-baseline run (bootstrap/regenerate path)', () => {
    const eff = cli.applyConfigSettings(
      { writeBaseline: 'new-base.json' },
      loaded({ baseline: 'base.json' }),
    )
    expect(eff.checkBaseline).toBeUndefined()
  })

  it('a no-settings config (core-only/disabled) leaves the flags untouched', () => {
    const flags = { severity: 'low' }
    expect(
      cli.applyConfigSettings(flags, { cwd: dir, source: 'core-only', plugins: [] }),
    ).toBe(flags)
  })
})

describe('config e2e — the demo audit under a fixture working directory', () => {
  let dir: string
  beforeAll(() => {
    dir = fixtureDir({
      'stripe-audit.config.json': JSON.stringify({
        ignore: [DEMO_RULE],
        failOn: 'none',
      }),
    })
  })

  it('a discovered config applies its ignore AND its failOn threshold', async () => {
    const r = await drive(['--demo', '--working-directory', dir, '--output', 'json'])
    const parsed = JSON.parse(r.stdout) as {
      findings: Array<{ ruleId: string }>
      summary: { suppressed: number }
    }
    expect(parsed.findings.map((f) => f.ruleId)).not.toContain(DEMO_RULE)
    expect(parsed.summary.suppressed).toBeGreaterThan(0)
    // failOn 'none' from the config: the all-issues demo (criticals present,
    // default gate exit 1) now exits 0 — the threshold demonstrably applied.
    expect(r.exitCode).toBe(EXIT_OK)
  })

  it('a CLI --fail-on outranks the config failOn', async () => {
    const r = await drive([
      '--demo',
      '--working-directory',
      dir,
      '--fail-on',
      'high',
      '--output',
      'json',
    ])
    expect(r.exitCode).toBe(EXIT_FINDINGS)
  })

  it('--no-config under the same directory restores the identical default report', async () => {
    const noConfig = await drive([
      '--demo',
      '--working-directory',
      dir,
      '--no-config',
      '--output',
      'json',
    ])
    const plain = await drive(['--demo', '--output', 'json'])
    // Deep-equal with the wall-clock auditDate normalized out — the two runs
    // legitimately straddle a millisecond tick; every other field must match.
    const normalize = (raw: string) => ({ ...JSON.parse(raw), auditDate: 'NORMALIZED' })
    expect(normalize(noConfig.stdout)).toEqual(normalize(plain.stdout))
    expect(noConfig.exitCode).toBe(plain.exitCode)
  })

  it('a config-sourced severity filter flows into filter provenance', async () => {
    const filtered = fixtureDir({
      'stripe-audit.config.json': JSON.stringify({ severity: ['low'] }),
    })
    const r = await drive(['--demo', '--working-directory', filtered, '--output', 'json'])
    expect(JSON.parse(r.stdout).filter).toEqual({ severity: ['low'] })
    const rConsole = await drive(['--demo', '--working-directory', filtered])
    expect(rConsole.stdout).toContain('Coverage: FILTERED (severity=low)')
  })

  it('a config-sourced output format is honored — and an explicit --output outranks it', async () => {
    const jsonOut = fixtureDir({
      'stripe-audit.config.json': JSON.stringify({ output: 'json', failOn: 'none' }),
    })
    const r = await drive(['--demo', '--working-directory', jsonOut])
    expect(() => JSON.parse(r.stdout)).not.toThrow()
    const overridden = await drive(['--demo', '--working-directory', jsonOut, '--output', 'console'])
    expect(overridden.stdout).toContain('Coverage:')
  })

  it('a malformed config exits 2 with plain-language stderr and a clean stdout', async () => {
    const broken = fixtureDir({ 'stripe-audit.config.json': '{ nope' })
    const r = await drive(['--demo', '--working-directory', broken, '--output', 'json'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/not valid JSON/)
    expect(r.stderr).not.toMatch(/at Object\.|at .*\(.*:\d+:\d+\)/) // no stack frames
    expect(r.stdout.trim()).toBe('')
  })
})
