/**
 * METER_ERROR_NOT_MONITORED unit tests.
 *
 * Trigger (active meters, no listener) / clean-with-listener (exact event and
 * '*') / clean-no-meters (null region, empty list, inactive-only) / disabled
 * destinations don't count / metadata shape + deep tier.
 */
import { describe, it, expect } from 'vitest'
import { METER_ERROR_NOT_MONITORED } from '../../src/rules/meter-error'
import { isDeepRule } from '../../src/engine'
import type { SnapshotMeter, StripeAccountSnapshot, ThinEventDestination } from '../../src/types'

const ACTIVE_METER: SnapshotMeter = {
  id: 'mtr_1',
  displayName: 'API calls',
  status: 'active',
  eventName: 'api_call',
}
const INACTIVE_METER: SnapshotMeter = { ...ACTIVE_METER, id: 'mtr_2', status: 'inactive' }

const listener = (events: string[], status = 'enabled'): ThinEventDestination => ({
  id: 'ed_1',
  name: 'sink',
  status,
  enabledEvents: events,
})

function snapWith(
  meters: SnapshotMeter[] | null,
  destinations: ThinEventDestination[] | null,
): StripeAccountSnapshot {
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
    subscriptionSummary: null,
    meters,
    thinEventDestinations: destinations,
    radarSettings: null,
    coupons: null,
    scopeProbe: [
      { scope: 'meters', granted: meters !== null },
      { scope: 'event_destinations', granted: destinations !== null },
    ],
    truncated: [],
  }
}

describe('METER_ERROR_NOT_MONITORED', () => {
  it('fires ONE high finding when active meters have no meter-error listener', () => {
    const findings = METER_ERROR_NOT_MONITORED.check(
      snapWith([ACTIVE_METER], [listener(['charge.succeeded'])]),
    )
    expect(findings).toHaveLength(1)
    const finding = findings[0]
    expect(finding.ruleId).toBe('METER_ERROR_NOT_MONITORED')
    expect(finding.severity).toBe('high')
    expect(finding.title).toBeTruthy()
    expect(finding.description).toContain('v1.billing.meter.error_report_triggered')
    expect(finding.remediation).toBeTruthy()
    expect(finding.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
  })

  it('is clean when an enabled destination listens for the exact meter-error event', () => {
    expect(
      METER_ERROR_NOT_MONITORED.check(
        snapWith([ACTIVE_METER], [listener(['v1.billing.meter.error_report_triggered'])]),
      ),
    ).toEqual([])
  })

  it("is clean when an enabled destination listens for '*'", () => {
    expect(METER_ERROR_NOT_MONITORED.check(snapWith([ACTIVE_METER], [listener(['*'])]))).toEqual([])
  })

  it('a disabled destination does NOT count as a listener', () => {
    expect(
      METER_ERROR_NOT_MONITORED.check(
        snapWith([ACTIVE_METER], [listener(['v1.billing.meter.error_report_triggered'], 'disabled')]),
      ),
    ).toHaveLength(1)
  })

  it('is clean with no meters: null region, empty list, or inactive-only', () => {
    expect(METER_ERROR_NOT_MONITORED.check(snapWith(null, null))).toEqual([])
    expect(METER_ERROR_NOT_MONITORED.check(snapWith([], []))).toEqual([])
    expect(METER_ERROR_NOT_MONITORED.check(snapWith([INACTIVE_METER], []))).toEqual([])
  })

  it('fires when destinations region is null (unreadable) but active meters exist', () => {
    // No readable listener evidence = not monitored as far as the audit can prove.
    expect(METER_ERROR_NOT_MONITORED.check(snapWith([ACTIVE_METER], null))).toHaveLength(1)
  })

  it("declares requires: ['meters','event_destinations'] and derives to deep tier", () => {
    expect(METER_ERROR_NOT_MONITORED.requires).toEqual(['meters', 'event_destinations'])
    expect(isDeepRule(METER_ERROR_NOT_MONITORED)).toBe(true)
  })
})
