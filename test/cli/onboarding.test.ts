import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { renderOnboardingPanel } from '../../src/onboarding'
import { stripAnsi } from '../../src/report'

/**
 * The branded no-key onboarding panel. The panel copy is unit-tested
 * (ANSI stripped); the no-key exit + channel discipline are exercised against the
 * built CLI as a subprocess.
 */
const CLI = 'dist/cli.js'

function runNoKey(args: string[] = []) {
  const env = { ...process.env }
  delete env.STRIPE_SECRET_KEY
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })
}

beforeAll(() => {
  if (!existsSync(CLI)) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })
}, 120_000)

describe('renderOnboardingPanel (copy)', () => {
  const panel = stripAnsi(renderOnboardingPanel())

  it('is branded with the product name', () => {
    expect(panel).toContain('stripe-audit')
  })

  it('carries the read-only / never-writes assurance', () => {
    expect(panel.toLowerCase()).toMatch(/read-only|never writes/)
  })

  it('explains how to get a key', () => {
    expect(panel.toLowerCase()).toMatch(/restricted api key|--key|stripe_secret_key/)
  })

  it('is copy, not an exception — no "Error:" line', () => {
    expect(panel).not.toContain('Error:')
  })

  it('deep variant lists base-6 + deep read scopes, base variant does not', () => {
    const deepPanel = stripAnsi(renderOnboardingPanel({ deep: true }))
    for (const scope of ['Subscriptions', 'Billing Meters', 'Event Destinations', 'Coupons']) {
      expect(deepPanel).toContain(`• ${scope}: Read`)
      expect(panel).not.toContain(`• ${scope}: Read`)
    }
    expect(deepPanel).toContain('10 resources')
    expect(deepPanel).not.toMatch(/radar/i) // DROPPED — never requested (S4)
    // The run instruction matches the flow that showed the panel: deep keeps --deep.
    expect(deepPanel).toContain('stripe-audit --deep --key')
    expect(panel).not.toContain('--deep')
  })
})

describe('no-key CLI path (built binary)', () => {
  it('exits 2 (configuration), never a thrown error', () => {
    const { status, stderr } = runNoKey()
    expect(status).toBe(2)
    expect(stderr).not.toMatch(/Error:/)
  })

  it('prints the branded read-only panel to stderr', () => {
    const { stderr } = runNoKey()
    expect(stderr.toLowerCase()).toMatch(/read-only|never writes/)
    expect(stderr).toContain('stripe-audit')
  })

  it('keeps stdout clean (panel is human copy → stderr only)', () => {
    const { stdout } = runNoKey()
    expect(stdout.trim()).toBe('')
  })
})
