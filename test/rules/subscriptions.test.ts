/**
 * Subscription-health cluster unit tests.
 *
 * TRIAL_WITHOUT_PAYMENT_COLLECTION — trigger ('cancel' and/or 'pause' non-zero) /
 * clean ('create_invoice' only, empty aggregate, summary null) / metadata shape.
 * It reads ONLY `subscriptionSummary.byTrialEndBehavior`, the bounded aggregate the
 * deep fetcher derives from `trial_settings.end_behavior.missing_payment_method`
 * (docs/verify-gates/TRIAL_END_BEHAVIOR.md), never a per-subscription list.
 *
 * SUBSCRIPTIONS_PAST_DUE_ACCUMULATING — trigger (past_due and/or unpaid non-zero) /
 * clean (neither present, summary null). It reads ONLY `byStatus`, which the deep
 * fetcher already computed for every prior mission, so the rule adds no projection.
 *
 * SUBSCRIPTION_COLLECTION_PAUSED — trigger (pausedCollectionCount > 0) / clean
 * (zero, summary null). It reads a COUNT rather than a status bucket precisely
 * because Stripe leaves `status` unchanged while collection is paused
 * (docs/verify-gates/PAUSE_COLLECTION.md); a status-derived check cannot see it.
 */
import { describe, it, expect } from 'vitest'
import {
  SUBSCRIPTION_COLLECTION_PAUSED,
  SUBSCRIPTIONS_PAST_DUE_ACCUMULATING,
  TRIAL_WITHOUT_PAYMENT_COLLECTION,
} from '../../src/rules/subscriptions'
import { isDeepRule } from '../../src/engine'
import type { StripeAccountSnapshot, SubscriptionSummary } from '../../src/types'

function snapWith(summary: SubscriptionSummary | null): StripeAccountSnapshot {
  return {
    auditScope: 'deep',
    accountMode: 'test',
    livemode: false,
    account: {
      id: 'acct_1',
      defaultAccountTaxIds: [],
      statementDescriptor: null,
      branding: { icon: null, logo: null },
      defaultAccountTaxIdsSet: false,
      chargesEnabled: true,
      requirements: null,
    },
    webhookEndpoints: [],
    prices: [],
    portalConfigurations: [],
    taxSettings: null,
    subscriptionSummary: summary,
    meters: null,
    thinEventDestinations: null,
    radarSettings: null,
    coupons: null,
    scopeProbe: [{ scope: 'subscriptions', granted: summary !== null }],
    truncated: [],
  }
}

/** A fleet whose trialing slice carries the given end-behavior aggregate. */
const fleet = (byTrialEndBehavior: Record<string, number>): SubscriptionSummary => ({
  total: 10,
  byStatus: { active: 7, trialing: 3 },
  byBillingMode: { flexible: 10 },
  byTrialEndBehavior,
  pausedCollectionCount: 0,
})

describe('TRIAL_WITHOUT_PAYMENT_COLLECTION', () => {
  it("fires ONE medium finding when trials are set to 'cancel'", () => {
    const findings = TRIAL_WITHOUT_PAYMENT_COLLECTION.check(fleetSnap({ cancel: 2 }))
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.ruleId).toBe('TRIAL_WITHOUT_PAYMENT_COLLECTION')
    expect(finding.severity).toBe('medium')
    expect(finding.category).toBe('billing')
    expect(finding.title).toContain('2')
    expect(finding.description).toContain("'cancel'")
    expect(finding.remediation).toContain('create_invoice')
    expect(finding.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
    expect(finding.affectedResourceId).toBeNull()
  })

  it("fires when trials are set to 'pause'", () => {
    const findings = TRIAL_WITHOUT_PAYMENT_COLLECTION.check(fleetSnap({ pause: 1 }))
    expect(findings).toHaveLength(1)
    expect(findings[0].description).toContain("'pause'")
    expect(findings[0].description).not.toContain("'cancel'")
  })

  it("sums cancel + pause into one finding and names both behaviors", () => {
    const findings = TRIAL_WITHOUT_PAYMENT_COLLECTION.check(fleetSnap({ cancel: 2, pause: 3 }))
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toContain('5')
    expect(findings[0].description).toContain("2 set to 'cancel'")
    expect(findings[0].description).toContain("3 set to 'pause'")
  })

  it("counts an at-risk trial alongside healthy ones without inflating the count", () => {
    const findings = TRIAL_WITHOUT_PAYMENT_COLLECTION.check(
      fleetSnap({ cancel: 1, create_invoice: 9 }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toContain('1 trialing subscription ')
  })

  it("is clean when every trial ends with 'create_invoice' (the healthy path)", () => {
    expect(TRIAL_WITHOUT_PAYMENT_COLLECTION.check(fleetSnap({ create_invoice: 3 }))).toEqual([])
  })

  it('is clean when no subscription is trialing (empty aggregate)', () => {
    expect(TRIAL_WITHOUT_PAYMENT_COLLECTION.check(fleetSnap({}))).toEqual([])
  })

  it('is clean when the summary is null (region denied / base mode)', () => {
    expect(TRIAL_WITHOUT_PAYMENT_COLLECTION.check(snapWith(null))).toEqual([])
  })

  it('is clean on an empty fleet (zero subscriptions)', () => {
    expect(
      TRIAL_WITHOUT_PAYMENT_COLLECTION.check(
        snapWith({
          total: 0,
          byStatus: {},
          byBillingMode: {},
          byTrialEndBehavior: {},
          pausedCollectionCount: 0,
        }),
      ),
    ).toEqual([])
  })

  it("declares requires: ['subscriptions'] and derives to deep tier", () => {
    expect(TRIAL_WITHOUT_PAYMENT_COLLECTION.requires).toEqual(['subscriptions'])
    expect(isDeepRule(TRIAL_WITHOUT_PAYMENT_COLLECTION)).toBe(true)
  })
})

function fleetSnap(byTrialEndBehavior: Record<string, number>): StripeAccountSnapshot {
  return snapWith(fleet(byTrialEndBehavior))
}

/** A fleet whose statuses are the given aggregate; trials all healthy. */
function statusSnap(byStatus: Record<string, number>): StripeAccountSnapshot {
  const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0)
  return snapWith({
    total,
    byStatus,
    byBillingMode: { flexible: total },
    byTrialEndBehavior: {},
    pausedCollectionCount: 0,
  })
}

describe('SUBSCRIPTIONS_PAST_DUE_ACCUMULATING', () => {
  it('fires ONE low finding when subscriptions are past_due', () => {
    const findings = SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.check(
      statusSnap({ active: 8, past_due: 2 }),
    )
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.ruleId).toBe('SUBSCRIPTIONS_PAST_DUE_ACCUMULATING')
    expect(finding.severity).toBe('low')
    expect(finding.category).toBe('billing')
    expect(finding.title).toContain('2')
    expect(finding.description).toContain('2 past_due')
    expect(finding.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
    expect(finding.affectedResourceId).toBeNull()
  })

  it('counts unpaid alongside past_due in a single finding', () => {
    const findings = SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.check(
      statusSnap({ active: 6, past_due: 2, unpaid: 1 }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toContain('3')
    expect(findings[0].description).toContain('2 past_due and 1 unpaid')
  })

  it('fires on unpaid alone (retry schedule already exhausted)', () => {
    const findings = SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.check(statusSnap({ active: 4, unpaid: 1 }))
    expect(findings).toHaveLength(1)
    expect(findings[0].description).toContain('1 unpaid')
    expect(findings[0].description).not.toContain('past_due of')
  })

  it('stays advisory — it never asserts a misconfiguration it cannot observe', () => {
    const [finding] = SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.check(statusSnap({ active: 1, past_due: 1 }))
    // The retry policy is Dashboard-only (SMART_RETRIES_DISABLED is unbuildable),
    // so the copy must say "verify", never "you have not configured retries".
    expect(finding.description).toContain('not proof of a misconfiguration')
    expect(finding.remediation).toContain('confirm')
  })

  it('is clean when no subscription is past_due or unpaid', () => {
    expect(
      SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.check(statusSnap({ active: 5, trialing: 2, canceled: 3 })),
    ).toEqual([])
  })

  it('is clean when the summary is null (region denied / base mode)', () => {
    expect(SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.check(snapWith(null))).toEqual([])
  })

  it('is clean on an empty fleet (zero subscriptions)', () => {
    expect(
      SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.check(
        snapWith({
          total: 0,
          byStatus: {},
          byBillingMode: {},
          byTrialEndBehavior: {},
          pausedCollectionCount: 0,
        }),
      ),
    ).toEqual([])
  })

  it("declares requires: ['subscriptions'] and derives to deep tier", () => {
    expect(SUBSCRIPTIONS_PAST_DUE_ACCUMULATING.requires).toEqual(['subscriptions'])
    expect(isDeepRule(SUBSCRIPTIONS_PAST_DUE_ACCUMULATING)).toBe(true)
  })
})

/** A fleet of `total` all-active subscriptions, `paused` of them pause_collection'd. */
function pausedSnap(total: number, paused: number): StripeAccountSnapshot {
  return snapWith({
    total,
    byStatus: { active: total },
    byBillingMode: { flexible: total },
    byTrialEndBehavior: {},
    pausedCollectionCount: paused,
  })
}

describe('SUBSCRIPTION_COLLECTION_PAUSED', () => {
  it('fires ONE medium finding when any subscription has collection paused', () => {
    const findings = SUBSCRIPTION_COLLECTION_PAUSED.check(pausedSnap(12, 2))
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.ruleId).toBe('SUBSCRIPTION_COLLECTION_PAUSED')
    expect(finding.severity).toBe('medium')
    expect(finding.category).toBe('billing')
    expect(finding.title).toContain('2')
    expect(finding.description).toContain('2 of 12')
    expect(finding.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
    expect(finding.affectedResourceId).toBeNull()
  })

  it('reads pausedCollectionCount, NOT a status bucket', () => {
    // The whole point of the rule: every paused subscription still reads active,
    // so a fleet with zero non-active statuses must still fire.
    const snap = pausedSnap(3, 3)
    expect(snap.subscriptionSummary?.byStatus['paused']).toBeUndefined()
    expect(SUBSCRIPTION_COLLECTION_PAUSED.check(snap)).toHaveLength(1)
  })

  it('names the invisibility in the copy (why a status filter cannot find these)', () => {
    const [finding] = SUBSCRIPTION_COLLECTION_PAUSED.check(pausedSnap(5, 1))
    expect(finding.description).toContain('status stays')
    expect(finding.description).toContain('resumes_at')
    expect(finding.remediation).toContain('pause_collection')
  })

  it('singularizes a lone paused subscription', () => {
    const [finding] = SUBSCRIPTION_COLLECTION_PAUSED.check(pausedSnap(5, 1))
    expect(finding.title).toContain('1 subscription has')
  })

  it('is clean when nothing is paused', () => {
    expect(SUBSCRIPTION_COLLECTION_PAUSED.check(pausedSnap(9, 0))).toEqual([])
  })

  it('is clean when the summary is null (region denied / base mode)', () => {
    expect(SUBSCRIPTION_COLLECTION_PAUSED.check(snapWith(null))).toEqual([])
  })

  it("declares requires: ['subscriptions'] and derives to deep tier", () => {
    expect(SUBSCRIPTION_COLLECTION_PAUSED.requires).toEqual(['subscriptions'])
    expect(isDeepRule(SUBSCRIPTION_COLLECTION_PAUSED)).toBe(true)
  })
})
