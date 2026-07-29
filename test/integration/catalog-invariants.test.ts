import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runRules, isDeepRule } from '../../src/engine'
import { ALL_RULES, RULE_MAP, deepRules } from '../../src/rules/index'
import type { Finding, RuleScope, StripeAccountSnapshot } from '../../src/types'

const BASE_REGIONS = new Set<RuleScope>([
  'account',
  'webhook_endpoints',
  'products',
  'prices',
  'billing_portal',
  'tax',
])

const DEEP_REGIONS = new Set<RuleScope>([
  'subscriptions',
  'radar',
  'meters',
  'event_destinations',
  'coupons',
])

/** Deep rules shipped so far (grows as new deep rules land). */
const EXPECTED_DEEP_IDS = new Set([
  'BILLING_MODE_NOT_MIGRATED',
  'TRIAL_WITHOUT_PAYMENT_COLLECTION',
  'SUBSCRIPTIONS_PAST_DUE_ACCUMULATING',
  'SUBSCRIPTION_COLLECTION_PAUSED',
  'METER_ERROR_NOT_MONITORED',
  'HIGH_PERCENT_COUPON',
  'HIGH_AMOUNT_COUPON',
  'FOREVER_COUPON_STILL_VALID',
])

/**
 * Rule IDs that must NOT appear in ALL_RULES right now: permanent drops
 * (COVERAGE.md non-goals + src/rules/dropped.ts) plus planned deep rules that
 * have not landed yet — those move to EXPECTED_DEEP_IDS as they ship.
 * (API_VERSION_OUTDATED was dropped during early scoping.)
 */
const DROPPED_IDS = [
  'WEBHOOK_NO_SIGNING_SECRET',
  'WEBHOOK_HIGH_FAILURE_RATE',
  'WEBHOOK_NO_RETRY_EVIDENCE',
  'SMART_RETRIES_DISABLED',
  // TRIAL_WITHOUT_PAYMENT_COLLECTION is NOT here: the catalog re-grounding pass
  // corrected the drop verdict (the setting is readable) and promoted it — it now
  // lives in EXPECTED_DEEP_IDS above.
  'SUBSCRIPTION_DEFAULT_INCOMPLETE',
  'COUPON_FOREVER_ON_ALL_PRICES',
  'API_VERSION_NOT_PINNED',
  'API_VERSION_OUTDATED',
  'NO_RECEIPT_EMAIL',
  'INVOICE_FOOTER_EMPTY',
  'CUSTOMER_DEFAULT_CURRENCY_MISSING',
  // Residuals that were tracked only in COVERAGE prose until v0.3 landed them in
  // the registry proper — the drift class Check D now guards against.
  'STRIPE_VERSION_ECHO',
  'INVOICE_WINDOW_NOT_USED',
  // RADAR_SETUP_INTENTS_NOT_ENABLED is a PERMANENT drop (verify-gate DROPPED,
  // docs/verify-gates/RADAR_SETUP_INTENTS.md + src/rules/dropped.ts).
  'RADAR_SETUP_INTENTS_NOT_ENABLED',
]

const loadSnap = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as StripeAccountSnapshot
const findingsFor = (p: string): Finding[] => runRules(loadSnap(p), ALL_RULES).findings

describe('catalog-invariants — ALL_RULES contract', () => {
  it('has no duplicate IDs and a RULE_MAP entry for each rule', () => {
    const ids = ALL_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(RULE_MAP.size).toBe(ids.length)
    for (const rule of ALL_RULES) {
      expect(RULE_MAP.get(rule.id)).toBe(rule)
    }
  })

  it('every core rule ID is UPPER_SNAKE with no "/" namespace separator', () => {
    for (const rule of ALL_RULES) {
      expect(rule.id).toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(rule.id).not.toContain('/')
    }
  })

  it('every rule requires a non-empty array of valid RuleScopes; base/deep split is exact', () => {
    for (const rule of ALL_RULES) {
      expect(Array.isArray(rule.requires)).toBe(true)
      expect(rule.requires.length).toBeGreaterThan(0)
      for (const scope of rule.requires) {
        expect(BASE_REGIONS.has(scope) || DEEP_REGIONS.has(scope)).toBe(true)
      }
      if (EXPECTED_DEEP_IDS.has(rule.id)) {
        // Shipped deep rules require ≥1 deep region → engine SKIPS them in base mode.
        expect(isDeepRule(rule)).toBe(true)
      } else {
        // Everything else stays base-tier: only base regions, never skipped.
        for (const scope of rule.requires) {
          expect(BASE_REGIONS.has(scope)).toBe(true)
        }
        expect(isDeepRule(rule)).toBe(false)
      }
    }
  })

  it('contains none of the DROPPED ids; shipped ids (incl. every deep rule) are present', () => {
    const ids = new Set(ALL_RULES.map((r) => r.id))
    for (const dropped of DROPPED_IDS) {
      expect(ids.has(dropped)).toBe(false)
    }
    expect(ids.has('WEBHOOK_API_VERSION_MISMATCH')).toBe(true)
    // Presence half of the deep split: a silently de-registered deep rule fails
    // here instead of letting the tier invariant pass vacuously.
    for (const id of EXPECTED_DEEP_IDS) {
      expect(ids.has(id)).toBe(true)
    }
  })

  it('deepRules is exactly the isDeepRule slice of ALL_RULES (E2 parity export)', () => {
    expect(new Set(deepRules.map((r) => r.id))).toEqual(EXPECTED_DEEP_IDS)
    expect(deepRules).toEqual(ALL_RULES.filter(isDeepRule))
  })

  it('every rule has a clean fixture (clean → 0) and a trigger fixture (fires on a committed golden fixture)', () => {
    expect(findingsFor('test/fixtures/snapshots/clean-account@2026-06-24.dahlia.json')).toEqual([])
    expect(findingsFor('test/fixtures/snapshots/deep-all-clean@2026-06-24.dahlia.json')).toEqual([])
    const triggered = new Set<string>([
      ...findingsFor('test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/edge@2026-06-24.dahlia.json').map((f) => f.ruleId),
      // Deep trigger fixtures — one per built deep rule.
      ...findingsFor('test/fixtures/snapshots/classic-billing-mode@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/trial-missing-payment-method@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/subscription-collection-paused@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/subscriptions-past-due@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/meters-no-thin-destination@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/high-percent-coupon@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/high-amount-coupon@2026-06-24.dahlia.json').map((f) => f.ruleId),
      ...findingsFor('test/fixtures/snapshots/forever-coupon@2026-06-24.dahlia.json').map((f) => f.ruleId),
    ])
    for (const rule of ALL_RULES) {
      expect(triggered.has(rule.id)).toBe(true)
    }
  })

  it('every emitted finding is schema-complete', () => {
    const findings = [
      ...findingsFor('test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/edge@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/classic-billing-mode@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/trial-missing-payment-method@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/subscription-collection-paused@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/subscriptions-past-due@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/meters-no-thin-destination@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/high-percent-coupon@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/high-amount-coupon@2026-06-24.dahlia.json'),
      ...findingsFor('test/fixtures/snapshots/forever-coupon@2026-06-24.dahlia.json'),
    ]
    expect(findings.length).toBeGreaterThan(0)
    const severities = new Set(['critical', 'high', 'medium', 'low', 'info'])
    for (const f of findings) {
      expect(f.ruleId).toBeTruthy()
      expect(severities.has(f.severity)).toBe(true)
      expect(f.category).toBeTruthy()
      expect(f.title).toBeTruthy()
      expect(f.description).toBeTruthy()
      expect(f.remediation).toBeTruthy()
      expect(typeof f.affectedResourceType).toBe('string')
      // Strict host-allowlist: a finding's docsUrl must point at Stripe's own docs
      // (stripe.com or docs.stripe.com), never an arbitrary https host. The census
      // above proves the base fixtures ∪ the deep trigger fixtures fire
      // every rule in ALL_RULES, so this single walk covers the whole registry.
      expect(f.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
    }
  })
})
