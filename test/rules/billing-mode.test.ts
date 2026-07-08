/**
 * BILLING_MODE_NOT_MIGRATED unit tests.
 *
 * Trigger (any classic count) / clean (all flexible) / clean (summary null —
 * region denied or base mode) / metadata shape. The rule reads ONLY
 * `subscriptionSummary.byBillingMode` — no phantom fields
 * (a source-level grep guard enforces this).
 */
import { describe, it, expect } from 'vitest'
import { BILLING_MODE_NOT_MIGRATED } from '../../src/rules/billing-mode'
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

describe('BILLING_MODE_NOT_MIGRATED', () => {
  it('fires ONE medium finding when any subscription is classic (mixed fleet)', () => {
    const findings = BILLING_MODE_NOT_MIGRATED.check(
      snapWith({ total: 5, byStatus: { active: 5 }, byBillingMode: { classic: 2, flexible: 3 } }),
    )
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.ruleId).toBe('BILLING_MODE_NOT_MIGRATED')
    expect(finding.severity).toBe('medium')
    expect(finding.title).toBeTruthy()
    expect(finding.description).toBeTruthy()
    expect(finding.remediation).toBeTruthy()
    expect(finding.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
  })

  it('is clean when every subscription is flexible', () => {
    expect(
      BILLING_MODE_NOT_MIGRATED.check(
        snapWith({ total: 3, byStatus: { active: 3 }, byBillingMode: { flexible: 3 } }),
      ),
    ).toEqual([])
  })

  it('is clean when the summary is null (region denied / base mode)', () => {
    expect(BILLING_MODE_NOT_MIGRATED.check(snapWith(null))).toEqual([])
  })

  it('is clean on an empty fleet (zero subscriptions)', () => {
    expect(
      BILLING_MODE_NOT_MIGRATED.check(snapWith({ total: 0, byStatus: {}, byBillingMode: {} })),
    ).toEqual([])
  })

  it("declares requires: ['subscriptions'] and derives to deep tier", () => {
    expect(BILLING_MODE_NOT_MIGRATED.requires).toEqual(['subscriptions'])
    expect(isDeepRule(BILLING_MODE_NOT_MIGRATED)).toBe(true)
  })
})
