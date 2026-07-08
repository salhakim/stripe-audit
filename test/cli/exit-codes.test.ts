import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import {
  EXIT_OK,
  EXIT_FINDINGS,
  EXIT_CONFIG,
  EXIT_RUNTIME,
  DEFAULT_FAIL_ON,
  FAIL_ON_LEVELS,
  isFailOnLevel,
  exitCodeForFindings,
  type FailOnLevel,
} from '../../src/exit-codes'
import type { Finding, Severity } from '../../src/types'

/**
 * The canonical 0/1/2/3 exit-code contract. The pure gate
 * (`exitCodeForFindings`, `isFailOnLevel`) is unit-tested directly; the
 * config-error (2) and completed-audit (0/1) outcomes are exercised against the
 * built CLI as a subprocess.
 */
const CLI = 'dist/cli.js'

function run(args: string[]) {
  const env = { ...process.env }
  delete env.STRIPE_SECRET_KEY
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })
}

/** Minimal full Finding with the given severity (only severity drives the gate). */
const finding = (severity: Severity): Finding => ({
  ruleId: 'RULE_X',
  severity,
  category: 'security',
  title: 'x',
  affectedResourceId: null,
  affectedResourceType: 'account',
  description: '',
  remediation: '',
  docsUrl: '',
})

beforeAll(() => {
  if (!existsSync(CLI)) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })
}, 120_000)

describe('exit-code constants + fail-on vocabulary', () => {
  it('pins the documented 0/1/2/3 contract', () => {
    expect([EXIT_OK, EXIT_FINDINGS, EXIT_CONFIG, EXIT_RUNTIME]).toEqual([0, 1, 2, 3])
  })

  it('defaults to high (preserving the original 0/1 behaviour)', () => {
    expect(DEFAULT_FAIL_ON).toBe('high')
  })

  it('accepts only the documented fail-on levels (no "info")', () => {
    expect(FAIL_ON_LEVELS).toEqual(['critical', 'high', 'medium', 'low', 'none'])
    expect(isFailOnLevel('high')).toBe(true)
    expect(isFailOnLevel('none')).toBe(true)
    expect(isFailOnLevel('info')).toBe(false)
    expect(isFailOnLevel('banana')).toBe(false)
  })
})

describe('exitCodeForFindings — gate over active findings', () => {
  it('default high trips on critical/high, not medium/low/info', () => {
    expect(exitCodeForFindings([finding('critical')], 'high')).toBe(EXIT_FINDINGS)
    expect(exitCodeForFindings([finding('high')], 'high')).toBe(EXIT_FINDINGS)
    expect(exitCodeForFindings([finding('medium')], 'high')).toBe(EXIT_OK)
    expect(exitCodeForFindings([finding('low')], 'high')).toBe(EXIT_OK)
    expect(exitCodeForFindings([finding('info')], 'high')).toBe(EXIT_OK)
  })

  it('critical threshold trips only on critical', () => {
    expect(exitCodeForFindings([finding('critical')], 'critical')).toBe(EXIT_FINDINGS)
    expect(exitCodeForFindings([finding('high')], 'critical')).toBe(EXIT_OK)
  })

  it('low threshold trips on low and above, not info', () => {
    expect(exitCodeForFindings([finding('low')], 'low')).toBe(EXIT_FINDINGS)
    expect(exitCodeForFindings([finding('medium')], 'low')).toBe(EXIT_FINDINGS)
    expect(exitCodeForFindings([finding('info')], 'low')).toBe(EXIT_OK)
  })

  it('none never trips, even on critical', () => {
    expect(exitCodeForFindings([finding('critical')], 'none')).toBe(EXIT_OK)
  })

  it('an empty active set is always OK', () => {
    for (const level of FAIL_ON_LEVELS) {
      expect(exitCodeForFindings([], level as FailOnLevel)).toBe(EXIT_OK)
    }
  })
})

describe('CLI exit-code contract (built binary)', () => {
  it('--demo defaults to fail-on high → exit 1 (fixture has active critical/high)', () => {
    expect(run(['--demo']).status).toBe(1)
  })

  it('--demo --fail-on none → exit 0', () => {
    expect(run(['--demo', '--fail-on', 'none']).status).toBe(0)
  })

  it('--demo --fail-on critical → completes (0 or 1, never a config/transport error)', () => {
    expect([0, 1]).toContain(run(['--demo', '--fail-on', 'critical']).status)
  })

  it('invalid --fail-on → exit 2 (config error)', () => {
    expect(run(['--demo', '--fail-on', 'banana']).status).toBe(2)
  })

  it('invalid --output → exit 2', () => {
    expect(run(['--demo', '--output', 'not-a-format']).status).toBe(2)
  })

  it('no key (no --demo) → exit 2', () => {
    expect(run([]).status).toBe(2)
  })

  it('--demo --output json stays parseable on stdout with findings', () => {
    const { stdout } = run(['--demo', '--output', 'json'])
    const parsed = JSON.parse(stdout)
    expect(parsed.summary.total).toBeGreaterThan(0)
  })
})
