/**
 * End-to-end: a plugin registered IN A CONFIG FILE actually runs.
 *
 * The fixture config is a SELF-CONTAINED plain-JS manifest: importing
 * the TS example plugin directly is impossible under native `import()` (it
 * bypasses vitest's transformer), so the fixture mirrors the example's
 * STATEMENT_DESCRIPTOR_MISSING rule id + behavior as plain objects, and
 * test/integration/plugin-example.test.ts keeps covering the TS example
 * itself through the transformer.
 *
 * The bundled all-issues demo snapshot has `statementDescriptor: null`, so it
 * doubles as the trigger snapshot — the plugin's finding must appear in the
 * report NAMESPACED (`example-plugin/STATEMENT_DESCRIPTOR_MISSING`, stamped by
 * the engine's provenance chokepoint), alongside the untouched core findings.
 */
import { describe, it, expect, afterAll, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as cli from '../../src/cli'
import { EXIT_CONFIG } from '../../src/exit-codes'

/** The manifest body shared by the .mjs / .cjs fixture variants. */
const RULE_LITERAL = `{
  id: 'STATEMENT_DESCRIPTOR_MISSING',
  name: 'No card statement descriptor configured',
  severity: 'medium',
  category: 'configuration',
  requires: ['account'],
  check: (snapshot) => {
    const d = snapshot.account.statementDescriptor
    if (d !== null && d.trim().length > 0) return []
    return [{
      ruleId: 'STATEMENT_DESCRIPTOR_MISSING',
      severity: 'medium',
      category: 'configuration',
      title: 'No card statement descriptor configured',
      affectedResourceId: snapshot.account.id,
      affectedResourceType: 'account',
      description: 'The account has no statement descriptor.',
      remediation: 'Set one under Settings -> Public details.',
      docsUrl: 'https://docs.stripe.com/get-started/account/statement-descriptors',
    }]
  },
}`

const MANIFEST_MJS = `export default {
  meta: { name: 'example-plugin', version: '0.1.0' },
  rules: [${RULE_LITERAL}],
}
`

const MANIFEST_CJS = `module.exports = {
  meta: { name: 'example-plugin', version: '0.1.0' },
  rules: [${RULE_LITERAL}],
}
`

const NAMESPACED = 'example-plugin/STATEMENT_DESCRIPTOR_MISSING'

const createdDirs: string[] = []
function fixtureDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sba-plugin-e2e-'))
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
  createdDirs.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true })
})

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

interface ReportShape {
  findings: Array<{ ruleId: string }>
  summary: { total: number; suppressed: number }
}

describe('config-registered plugin — end-to-end through the CLI spine', () => {
  it('an .mjs config registers the plugin and its NAMESPACED finding fires in the report', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.mjs': MANIFEST_MJS })
    const r = await drive(['--demo', '--working-directory', dir, '--output', 'json'])
    const report = JSON.parse(r.stdout) as ReportShape
    const ids = report.findings.map((f) => f.ruleId)
    expect(ids).toContain(NAMESPACED)
    // The engine stamps the RESOLVED rule id, so the plugin's finding arrives
    // namespaced and distinguishable from the core STATEMENT_DESCRIPTOR_MISSING
    // twin (the example plugin deliberately mirrors a core rule) — both fire.
    expect(ids.filter((id) => id === NAMESPACED)).toHaveLength(1)
    expect(ids).toContain('STATEMENT_DESCRIPTOR_MISSING')
    // Core findings ride along untouched: exactly one finding was added.
    const plain = await drive(['--demo', '--output', 'json'])
    expect(report.summary.total).toBe((JSON.parse(plain.stdout) as ReportShape).summary.total + 1)
  })

  it('the .cjs variant loads through the same path (module.exports interop)', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.cjs': MANIFEST_CJS })
    const r = await drive(['--demo', '--working-directory', dir, '--output', 'json'])
    expect((JSON.parse(r.stdout) as ReportShape).findings.map((f) => f.ruleId)).toContain(
      NAMESPACED,
    )
  })

  it('the namespaced finding is suppressible by its namespaced id', async () => {
    const dir = fixtureDir({ 'stripe-audit.config.mjs': MANIFEST_MJS })
    const r = await drive([
      '--demo',
      '--working-directory',
      dir,
      '--ignore',
      NAMESPACED,
      '--output',
      'json',
    ])
    const report = JSON.parse(r.stdout) as ReportShape
    expect(report.findings.map((f) => f.ruleId)).not.toContain(NAMESPACED)
  })

  it('a plugin whose rule id collides with a core rule is a plain-language exit 2', async () => {
    const collision = `export default {
  meta: { name: 'p' },
  plugins: [
    { key: 'dup', rules: [{ id: 'R', name: 'n', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }] },
    { key: 'dup', rules: [{ id: 'R', name: 'n', severity: 'low', category: 'billing', requires: ['prices'], check: () => [] }] },
  ],
}
`
    const dir = fixtureDir({ 'stripe-audit.config.mjs': collision })
    const r = await drive(['--demo', '--working-directory', dir, '--output', 'json'])
    expect(r.exitCode).toBe(EXIT_CONFIG)
    expect(r.stderr).toMatch(/collision/i)
    expect(r.stderr).not.toMatch(/at .*\(.*:\d+:\d+\)/) // plain language, no stack
    expect(r.stdout.trim()).toBe('')
  })

  it('a config-loaded plugin never sees the Stripe client — rules receive snapshots only', async () => {
    // The manifest's check receives the snapshot object; assert the demo path
    // hands it no client-shaped capability (nothing callable that could write).
    const probe = `export default {
  meta: { name: 'probe' },
  rules: [{
    id: 'CLIENT_PROBE',
    name: 'probe',
    severity: 'info',
    category: 'configuration',
    requires: ['account'],
    check: (snapshot) => {
      const suspicious = Object.entries(snapshot).filter(([, v]) => typeof v === 'function')
      return suspicious.length === 0 ? [] : [{
        ruleId: 'CLIENT_PROBE', severity: 'info', category: 'configuration',
        title: 'snapshot exposed a function', affectedResourceId: null,
        affectedResourceType: 'account', description: 'x', remediation: 'x', docsUrl: '',
      }]
    },
  }],
}
`
    const dir = fixtureDir({ 'stripe-audit.config.mjs': probe })
    const r = await drive(['--demo', '--working-directory', dir, '--output', 'json'])
    const report = JSON.parse(r.stdout) as ReportShape
    expect(report.findings.map((f) => f.ruleId)).not.toContain('probe/CLIENT_PROBE')
  })
})
