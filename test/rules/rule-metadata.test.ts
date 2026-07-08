/**
 * Rule-metadata meta-test (drift protection over the whole registry).
 *
 * Walks EVERY rule in ALL_RULES — base and deep — and asserts the metadata
 * contract a contributor could silently break: unique UPPER_SNAKE id, non-empty
 * name, valid severity/category enums, non-empty `requires` over known scopes.
 *
 * Ownership note: catalog-invariants.test.ts asserts an overlapping subset
 * (unique ids, id shape, requires validity) but is fixture-COUPLED — it also
 * needs the golden fixtures to exist and parse. This walk is deliberately
 * fixture-FREE so a malformed rule fails here even before its fixtures exist
 * (e.g. mid-iteration on a new deep rule). The redundancy is the point: this is
 * the early tripwire, catalog-invariants is the integration-level census.
 */
import { describe, it, expect } from 'vitest'
import { ALL_RULES } from '../../src/rules/index'
import type { Category, RuleScope, Severity } from '../../src/types'

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const CATEGORIES: Category[] = [
  'webhooks',
  'billing',
  'security',
  'configuration',
  'payments',
  'pricing',
]
const SCOPES: RuleScope[] = [
  'account',
  'webhook_endpoints',
  'products',
  'prices',
  'billing_portal',
  'tax',
  'subscriptions',
  'radar',
  'meters',
  'event_destinations',
  'coupons',
]

describe('rule-metadata — registry-wide contract', () => {
  it('ids are unique', () => {
    const ids = ALL_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const rule of ALL_RULES) {
    it(`${rule.id}: id shape, name, severity, category, requires`, () => {
      expect(rule.id).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(rule.name.trim().length).toBeGreaterThan(0)
      expect(SEVERITIES).toContain(rule.severity)
      expect(CATEGORIES).toContain(rule.category)
      expect(rule.requires.length).toBeGreaterThan(0)
      for (const scope of rule.requires) {
        expect(SCOPES).toContain(scope)
      }
      expect(typeof rule.check).toBe('function')
    })
  }
})
