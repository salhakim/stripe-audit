/**
 * Coupon cluster unit tests.
 *
 * HIGH_PERCENT_COUPON: trigger at/above threshold (default 90), threshold
 * override + garbage-override fallback, clean below threshold / invalid /
 * amount-based / null region. FOREVER_COUPON_STILL_VALID: trigger on valid
 * forever coupons, clean on expired-or-bounded / null region. Both deep tier.
 */
import { describe, it, expect } from 'vitest'
import {
  HIGH_PERCENT_COUPON,
  HIGH_AMOUNT_COUPON,
  FOREVER_COUPON_STILL_VALID,
  DEFAULT_HIGH_PERCENT_THRESHOLD,
  DEFAULT_HIGH_AMOUNT_THRESHOLD,
} from '../../src/rules/coupons'
import { isDeepRule } from '../../src/engine'
import type { SnapshotCoupon, StripeAccountSnapshot } from '../../src/types'

const coupon = (over: Partial<SnapshotCoupon> = {}): SnapshotCoupon => ({
  id: 'co_1',
  name: null,
  percentOff: null,
  amountOff: null,
  currency: null,
  duration: 'once',
  valid: true,
  ...over,
})

function snapWith(coupons: SnapshotCoupon[] | null): StripeAccountSnapshot {
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
    meters: null,
    thinEventDestinations: null,
    radarSettings: null,
    coupons,
    scopeProbe: [{ scope: 'coupons', granted: coupons !== null }],
    truncated: [],
  }
}

describe('HIGH_PERCENT_COUPON', () => {
  it(`fires per valid coupon at/above the default ${DEFAULT_HIGH_PERCENT_THRESHOLD}% threshold`, () => {
    const findings = HIGH_PERCENT_COUPON.check(
      snapWith([
        coupon({ id: 'co_90', percentOff: 90 }),
        coupon({ id: 'co_100', percentOff: 100, name: 'FREE4EVER' }),
        coupon({ id: 'co_50', percentOff: 50 }),
      ]),
    )
    expect(findings.map((f) => f.affectedResourceId).sort()).toEqual(['co_100', 'co_90'])
    for (const finding of findings) {
      expect(finding.severity).toBe('medium')
      expect(finding.affectedResourceType).toBe('coupon')
      expect(finding.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
      expect(finding.title).toBeTruthy()
      expect(finding.remediation).toBeTruthy()
    }
  })

  it('honors a finite 0..100 threshold override; garbage overrides fall back', () => {
    const snap = snapWith([coupon({ percentOff: 60 })])
    expect(HIGH_PERCENT_COUPON.check(snap, { threshold: 50 })).toHaveLength(1)
    expect(HIGH_PERCENT_COUPON.check(snap, { threshold: NaN })).toEqual([])
    expect(HIGH_PERCENT_COUPON.check(snap, { threshold: 101 })).toEqual([])
    expect(HIGH_PERCENT_COUPON.check(snap, { threshold: -1 })).toEqual([])
  })

  it('is clean for invalid, amount-based, below-threshold, and null-region cases', () => {
    expect(
      HIGH_PERCENT_COUPON.check(
        snapWith([
          coupon({ percentOff: 95, valid: false }),
          coupon({ amountOff: 5000, currency: 'usd' }),
          coupon({ percentOff: 89.9 }),
        ]),
      ),
    ).toEqual([])
    expect(HIGH_PERCENT_COUPON.check(snapWith(null))).toEqual([])
  })

  it("declares requires: ['coupons'] and derives to deep tier", () => {
    expect(HIGH_PERCENT_COUPON.requires).toEqual(['coupons'])
    expect(isDeepRule(HIGH_PERCENT_COUPON)).toBe(true)
  })
})

describe('HIGH_AMOUNT_COUPON', () => {
  it(`fires per valid coupon at/above the default ${DEFAULT_HIGH_AMOUNT_THRESHOLD} minor-unit threshold`, () => {
    const findings = HIGH_AMOUNT_COUPON.check(
      snapWith([
        coupon({ id: 'co_500', amountOff: 50_000, currency: 'usd' }),
        coupon({ id: 'co_1k', amountOff: 100_000, currency: 'usd', name: 'BIGDEAL' }),
        coupon({ id: 'co_5', amountOff: 500, currency: 'usd' }),
      ]),
    )
    expect(findings.map((f) => f.affectedResourceId).sort()).toEqual(['co_1k', 'co_500'])
    for (const finding of findings) {
      expect(finding.severity).toBe('medium')
      expect(finding.affectedResourceType).toBe('coupon')
      expect(finding.docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
      expect(finding.title).toBeTruthy()
      expect(finding.remediation).toBeTruthy()
    }
  })

  it('honors a finite ≥0 threshold override; garbage overrides fall back', () => {
    const snap = snapWith([coupon({ amountOff: 5_000, currency: 'usd' })])
    expect(HIGH_AMOUNT_COUPON.check(snap, { threshold: 1_000 })).toHaveLength(1)
    expect(HIGH_AMOUNT_COUPON.check(snap, { threshold: NaN })).toEqual([]) // 5_000 < default 50_000
    expect(HIGH_AMOUNT_COUPON.check(snap, { threshold: -1 })).toEqual([])
    expect(HIGH_AMOUNT_COUPON.check(snap, { threshold: Infinity })).toEqual([])
  })

  it('renders a null-currency amount without crashing (minor-unit fallback)', () => {
    const findings = HIGH_AMOUNT_COUPON.check(
      snapWith([coupon({ id: 'co_nc', amountOff: 90_000, currency: null })]),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].title).toContain('minor units')
  })

  it('is clean for invalid, percent-based, below-threshold, and null-region cases', () => {
    expect(
      HIGH_AMOUNT_COUPON.check(
        snapWith([
          coupon({ amountOff: 99_999, currency: 'usd', valid: false }),
          coupon({ percentOff: 95 }),
          coupon({ amountOff: 49_999, currency: 'usd' }),
        ]),
      ),
    ).toEqual([])
    expect(HIGH_AMOUNT_COUPON.check(snapWith(null))).toEqual([])
  })

  it("declares requires: ['coupons'] and derives to deep tier", () => {
    expect(HIGH_AMOUNT_COUPON.requires).toEqual(['coupons'])
    expect(isDeepRule(HIGH_AMOUNT_COUPON)).toBe(true)
  })
})

describe('FOREVER_COUPON_STILL_VALID', () => {
  it('fires per valid forever coupon', () => {
    const findings = FOREVER_COUPON_STILL_VALID.check(
      snapWith([
        coupon({ id: 'co_forever', duration: 'forever', percentOff: 20 }),
        coupon({ id: 'co_once', duration: 'once' }),
      ]),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].affectedResourceId).toBe('co_forever')
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].docsUrl).toMatch(/^https:\/\/(stripe\.com|docs\.stripe\.com)\//)
  })

  it('is clean when forever coupons are no longer valid, or region is null', () => {
    expect(
      FOREVER_COUPON_STILL_VALID.check(snapWith([coupon({ duration: 'forever', valid: false })])),
    ).toEqual([])
    expect(FOREVER_COUPON_STILL_VALID.check(snapWith(null))).toEqual([])
  })

  it("declares requires: ['coupons'] and derives to deep tier", () => {
    expect(FOREVER_COUPON_STILL_VALID.requires).toEqual(['coupons'])
    expect(isDeepRule(FOREVER_COUPON_STILL_VALID)).toBe(true)
  })
})
