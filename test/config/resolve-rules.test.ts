import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolveRules, RuleResolutionError, CONFIG_USAGE_EXIT } from '../../src/config/resolve-rules'
import { ALL_RULES } from '../../src/rules/index'
import { runRules } from '../../src/engine'
import type { Rule, StripeAccountSnapshot } from '../../src/types'

/** A minimal valid plugin rule (override the id). */
function pluginRule(id: string): Rule {
  return {
    id,
    name: `Plugin rule ${id}`,
    severity: 'low',
    category: 'configuration',
    requires: ['account'],
    check: () => [],
  }
}

const cleanSnapshot = () =>
  JSON.parse(readFileSync('test/fixtures/snapshots/clean-account@2026-06-24.dahlia.json', 'utf8')) as StripeAccountSnapshot

describe('resolveRules — core-only (default, zero plugins)', () => {
  it('returns exactly ALL_RULES (same length and same ids) for an empty/absent config', () => {
    for (const cfg of [undefined, {}, { plugins: [] }]) {
      const resolved = resolveRules(cfg)
      expect(resolved).toHaveLength(ALL_RULES.length)
      expect(resolved.map((r) => r.id)).toEqual(ALL_RULES.map((r) => r.id))
    }
  })
})

describe('resolveRules — namespacing', () => {
  it("prefixes a plugin rule id as 'pluginKey/RULE_ID' and never rewrites core ids", () => {
    const resolved = resolveRules({ plugins: [{ key: 'acme', rules: [pluginRule('CUSTOM_RULE')] }] })
    const ids = resolved.map((r) => r.id)
    expect(ids).toContain('acme/CUSTOM_RULE')
    // core ids are untouched and never carry a '/'
    for (const core of ALL_RULES) {
      expect(ids).toContain(core.id)
      expect(core.id).not.toContain('/')
    }
    expect(resolved).toHaveLength(ALL_RULES.length + 1)
  })

  it('namespacing keeps a plugin rule distinct from a same-named core rule', () => {
    // 'WEBHOOK_SELECT_ALL' is a core id; 'acme/WEBHOOK_SELECT_ALL' must not collide.
    const resolved = resolveRules({ plugins: [{ key: 'acme', rules: [pluginRule('WEBHOOK_SELECT_ALL')] }] })
    expect(resolved.map((r) => r.id)).toContain('acme/WEBHOOK_SELECT_ALL')
    expect(resolved.map((r) => r.id)).toContain('WEBHOOK_SELECT_ALL')
  })
})

describe('resolveRules — collision is fail-loud (exit 2)', () => {
  it('throws RuleResolutionError naming the colliding id (never de-dupes / last-wins)', () => {
    const cfg = { plugins: [{ key: 'p', rules: [pluginRule('DUP'), pluginRule('DUP')] }] }
    expect(() => resolveRules(cfg)).toThrow(RuleResolutionError)
    expect(() => resolveRules(cfg)).toThrow(/p\/DUP/)
  })

  it('the thrown error carries the config/usage exit code (2)', () => {
    try {
      resolveRules({ plugins: [{ key: 'p', rules: [pluginRule('X'), pluginRule('X')] }] })
      expect.unreachable('expected a collision throw')
    } catch (err) {
      expect(err).toBeInstanceOf(RuleResolutionError)
      expect((err as RuleResolutionError).exitCode).toBe(CONFIG_USAGE_EXIT)
      expect(CONFIG_USAGE_EXIT).toBe(2)
    }
  })

  it('rejects a plugin rule with an empty requires (the contract applies to plugins too)', () => {
    const bad: Rule = { ...pluginRule('NO_SCOPES'), requires: [] }
    expect(() => resolveRules({ plugins: [{ key: 'p', rules: [bad] }] })).toThrow(/empty requires/)
  })
})

describe('resolveRules — output is a valid runRules 2nd arg', () => {
  it('every resolved entry satisfies the Rule contract (non-empty requires) and runs', () => {
    const resolved = resolveRules({ plugins: [{ key: 'acme', rules: [pluginRule('CUSTOM_RULE')] }] })
    for (const rule of resolved) {
      expect(rule.requires.length).toBeGreaterThan(0)
    }
    // Acceptable as the engine's 2nd arg — no throw, returns the {findings,skipped} shape.
    const result = runRules(cleanSnapshot(), resolved)
    expect(Array.isArray(result.findings)).toBe(true)
    expect(Array.isArray(result.skipped)).toBe(true)
  })
})
