/**
 * End-to-end integration test of the plugin seam.
 *
 * Proves the reference plugin (`examples/stripe-audit-plugin-example/`) wires through
 * the PUBLIC seam exactly as an external author would: the manifest is bridged into
 * the host via `resolveRules({ plugins: [{ key, rules }] })`, and each resolved rule is
 * exercised through its public `rule.check(snapshot)` contract over a trigger + clean
 * fixture (the same golden pattern the core rule tests use). Also asserts the resolved
 * plugin rule id is namespaced (`key/RULE_ID`), so it can never collide with a core id.
 */
import { describe, it, expect } from 'vitest'
import { resolveRules } from '../../src/index'
import type { StripeAccountSnapshot } from '../../src/index'
import plugin from '../../examples/stripe-audit-plugin-example/index'

/** A snapshot with a set statement descriptor — clean for the example rule. */
function makeSnapshot(over: Partial<StripeAccountSnapshot> = {}): StripeAccountSnapshot {
  return {
    auditScope: 'base',
    accountMode: 'test',
    livemode: false,
    account: {
      id: 'acct_1',
      defaultAccountTaxIds: [],
      statementDescriptor: 'ACME INC',
      branding: { icon: null, logo: null },
      defaultAccountTaxIdsSet: false,
      chargesEnabled: true,
      requirements: null,
    },
    webhookEndpoints: [],
    prices: [],
    portalConfigurations: [],
    taxSettings: { status: 'active', defaultTaxBehavior: null },
    subscriptionSummary: null,
    meters: null,
    thinEventDestinations: null,
    radarSettings: null,
    coupons: null,
    scopeProbe: [],
    truncated: [],
    ...over,
  }
}

/** Trigger fixture: no statement descriptor → the example rule fires. */
const triggerSnapshot = makeSnapshot({
  account: { ...makeSnapshot().account, statementDescriptor: null },
})

/** Clean fixture: a statement descriptor is set → the example rule stays silent. */
const cleanSnapshot = makeSnapshot()

const PLUGIN_KEY = plugin.meta.name
const RULE_ID = 'STATEMENT_DESCRIPTOR_MISSING'
const EFFECTIVE_ID = `${PLUGIN_KEY}/${RULE_ID}`

describe('plugin example — end-to-end through resolveRules', () => {
  it('the manifest pins meta.apiVersion to the host CORE_API_VERSION', async () => {
    const { CORE_API_VERSION } = await import('../../src/index')
    expect(plugin.meta.apiVersion).toBe(CORE_API_VERSION)
    expect(plugin.rules.length).toBeGreaterThan(0)
  })

  it('resolves the plugin rule into the unified rule set via the public seam', () => {
    const resolved = resolveRules({ plugins: [{ key: PLUGIN_KEY, rules: plugin.rules }] })
    const pluginRule = resolved.find((r) => r.id === EFFECTIVE_ID)
    expect(pluginRule).toBeDefined()
    // The core catalog is still present and untouched (resolved ⊃ core).
    const coreOnly = resolveRules()
    expect(resolved.length).toBe(coreOnly.length + plugin.rules.length)
  })

  it('fires the expected Finding on its trigger fixture', () => {
    const resolved = resolveRules({ plugins: [{ key: PLUGIN_KEY, rules: plugin.rules }] })
    const pluginRule = resolved.find((r) => r.id === EFFECTIVE_ID)!
    const findings = pluginRule.check(triggerSnapshot)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe(RULE_ID)
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].affectedResourceId).toBe('acct_1')
  })

  it('returns [] on its clean fixture', () => {
    const resolved = resolveRules({ plugins: [{ key: PLUGIN_KEY, rules: plugin.rules }] })
    const pluginRule = resolved.find((r) => r.id === EFFECTIVE_ID)!
    expect(pluginRule.check(cleanSnapshot)).toEqual([])
  })

  it('namespaces the resolved plugin rule id so it cannot collide with a core id', () => {
    const resolved = resolveRules({ plugins: [{ key: PLUGIN_KEY, rules: plugin.rules }] })
    const pluginRule = resolved.find((r) => r.id === EFFECTIVE_ID)!
    // The plugin rule carries the namespace separator...
    expect(pluginRule.id).toContain('/')
    expect(pluginRule.id).toBe(EFFECTIVE_ID)
    // ...while every core rule id (zero-plugin resolution) is un-namespaced.
    for (const core of resolveRules()) {
      expect(core.id).not.toContain('/')
    }
  })
})
