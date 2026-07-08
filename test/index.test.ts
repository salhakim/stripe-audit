import { describe, it, expect, expectTypeOf } from 'vitest'
import { VERSION, STRIPE_API_VERSION, CORE_API_VERSION, defineRule } from '../src/index'
import type { Rule, RuleScope, Finding } from '../src/index'

describe('package metadata', () => {
  it('exposes a semver VERSION', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('pins the Stripe API version (re-exported from the single source)', () => {
    expect(STRIPE_API_VERSION).toBe('2026-06-24.dahlia')
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/)
  })

  it('exposes the numeric core contract version', () => {
    expect(CORE_API_VERSION).toBe(1)
  })
})

describe('defineRule', () => {
  const literal = {
    id: 'WEBHOOK_NONE',
    name: 'No webhook endpoints configured',
    severity: 'high',
    category: 'webhooks',
    requires: ['webhook_endpoints'],
    check: () => [],
  } satisfies Rule

  it('returns its argument unchanged (identity helper, zero runtime cost)', () => {
    expect(defineRule(literal)).toBe(literal)
  })

  it('preserves the Rule contract types (ELEVATION 3)', () => {
    const rule = defineRule(literal)
    expectTypeOf(rule).toEqualTypeOf<Rule>()
    expectTypeOf(rule.requires).toEqualTypeOf<RuleScope[]>()
    expectTypeOf(rule.check).toEqualTypeOf<Rule['check']>()
    expectTypeOf(rule.check).returns.toEqualTypeOf<Finding[]>()
  })
})
