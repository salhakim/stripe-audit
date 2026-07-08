/**
 * stripe-audit — coupon rule cluster (deep tier).
 *
 * Routed to deep mode by the verify-gate DEEP-SCOPE verdict
 * (`docs/verify-gates/COUPON_SCOPE.md`): the Coupon is its own API resource
 * outside the base-6 read scopes, so coupon reads need their own restricted-key
 * permission. Both rules declare `requires: ['coupons']` and are SKIPPED in
 * base mode. The third coupon rule from the original spec (the coupon→price
 * linkage one) is a permanent non-goal — no such linkage exists in Stripe's
 * model; see `src/rules/dropped.ts` and the verify-gate.
 */
import { defineRule } from '../define-rule'
import type { Finding, Rule, RuleOptions, StripeAccountSnapshot } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/**
 * Default trip threshold for {@link HIGH_PERCENT_COUPON} — a still-valid coupon
 * at or above this percent_off is treated as a giveaway-grade discount.
 */
export const DEFAULT_HIGH_PERCENT_THRESHOLD = 90

/**
 * Default trip threshold for {@link HIGH_AMOUNT_COUPON}, in the coupon's currency
 * MINOR unit (e.g. cents) — 50 000 ≈ 500.00 in a two-decimal currency.
 *
 * CURRENCY-NAIVE BY DESIGN: `amount_off` is an absolute minor-unit value and there
 * is NO coupon→price linkage in Stripe's model (that linkage is a permanent
 * non-goal — see `dropped.ts` COUPON_FOREVER_ON_ALL_PRICES), so the rule cannot
 * judge a discount relative to what it discounts. It flags any still-valid
 * fixed-amount coupon at/above this raw threshold in ANY currency's minor unit; a
 * zero-decimal currency (e.g. JPY) therefore trips at a smaller nominal value. Tune
 * per-account via the guarded `threshold` override, exactly like the percent rule.
 */
export const DEFAULT_HIGH_AMOUNT_THRESHOLD = 50_000

/** A currently-valid coupon whose percent_off is at giveaway level. */
export const HIGH_PERCENT_COUPON: Rule = defineRule({
  id: 'HIGH_PERCENT_COUPON',
  name: 'Valid coupon with a giveaway-level percent discount',
  severity: 'medium',
  category: 'pricing',
  requires: ['coupons'],
  check: (snapshot: StripeAccountSnapshot, options?: RuleOptions): Finding[] => {
    // Same guarded-override idiom as WEBHOOK_TOO_MANY_ENDPOINTS: only a finite
    // 0..100 number tunes the trip point; anything else keeps the default.
    const override = options?.threshold
    const threshold =
      typeof override === 'number' && Number.isFinite(override) && override >= 0 && override <= 100
        ? override
        : DEFAULT_HIGH_PERCENT_THRESHOLD
    return (snapshot.coupons ?? [])
      .filter((c) => c.valid && c.percentOff !== null && c.percentOff >= threshold)
      .map((coupon) =>
        buildFinding(HIGH_PERCENT_COUPON, {
          title: `Coupon ${coupon.name ?? coupon.id} takes ${coupon.percentOff}% off and is still redeemable`,
          description:
            `Coupon '${coupon.name ?? coupon.id}' is valid with percent_off ${coupon.percentOff} ` +
            `(≥ ${threshold}%). A leaked or forgotten giveaway-grade coupon silently erases revenue on ` +
            'every invoice it touches.',
          remediation:
            'If the coupon is no longer meant to circulate, delete it or let it expire (set redeem_by / ' +
            'max_redemptions). Keep steep discounts on short-lived, single-use promotion codes instead.',
          docsUrl: DOCS.coupons,
          affectedResourceId: coupon.id,
          affectedResourceType: 'coupon',
        }),
      )
  },
})

/** A currently-valid coupon whose fixed amount_off is at giveaway level. */
export const HIGH_AMOUNT_COUPON: Rule = defineRule({
  id: 'HIGH_AMOUNT_COUPON',
  name: 'Valid coupon with a giveaway-level fixed discount',
  severity: 'medium',
  category: 'pricing',
  requires: ['coupons'],
  check: (snapshot: StripeAccountSnapshot, options?: RuleOptions): Finding[] => {
    // Same guarded-override idiom as HIGH_PERCENT_COUPON, but the trip point is an
    // absolute minor-unit amount (no 0..100 ceiling): any finite non-negative number
    // tunes it, anything else keeps the default.
    const override = options?.threshold
    const threshold =
      typeof override === 'number' && Number.isFinite(override) && override >= 0
        ? override
        : DEFAULT_HIGH_AMOUNT_THRESHOLD
    return (snapshot.coupons ?? [])
      .filter((c) => c.valid && c.amountOff !== null && c.amountOff >= threshold)
      .map((coupon) => {
        // amount_off is minor units; render major units for humans. Currency may be
        // null on some coupons — fall back to the raw minor-unit value then.
        const major = coupon.currency
          ? `${(coupon.amountOff! / 100).toFixed(2)} ${coupon.currency.toUpperCase()}`
          : `${coupon.amountOff} (minor units)`
        return buildFinding(HIGH_AMOUNT_COUPON, {
          title: `Coupon ${coupon.name ?? coupon.id} takes ${major} off and is still redeemable`,
          description:
            `Coupon '${coupon.name ?? coupon.id}' is valid with a fixed amount_off of ${coupon.amountOff} ` +
            `minor units (≥ ${threshold}). A leaked or forgotten large fixed discount silently erases ` +
            'revenue on every invoice it touches. (This is an absolute, currency-naive threshold — there ' +
            'is no coupon→price linkage in Stripe to size it against; tune it to your pricing.)',
          remediation:
            'If the coupon is no longer meant to circulate, delete it or bound it (redeem_by / ' +
            'max_redemptions). Keep steep discounts on short-lived, single-use promotion codes instead.',
          docsUrl: DOCS.coupons,
          affectedResourceId: coupon.id,
          affectedResourceType: 'coupon',
        })
      })
  },
})

/** A duration:'forever' coupon that is still valid — a permanent discount. */
export const FOREVER_COUPON_STILL_VALID: Rule = defineRule({
  id: 'FOREVER_COUPON_STILL_VALID',
  name: 'Forever-duration coupon is still valid',
  severity: 'medium',
  category: 'pricing',
  requires: ['coupons'],
  check: (snapshot) =>
    (snapshot.coupons ?? [])
      .filter((c) => c.valid && c.duration === 'forever')
      .map((coupon) =>
        buildFinding(FOREVER_COUPON_STILL_VALID, {
          title: `Coupon ${coupon.name ?? coupon.id} discounts forever and is still redeemable`,
          description:
            `Coupon '${coupon.name ?? coupon.id}' has duration 'forever': once applied, it discounts ` +
            'every invoice for that customer indefinitely. While it stays valid, every new redemption is ' +
            'a permanent revenue reduction.',
          remediation:
            "Audit whether the forever discount is intentional. If not, delete the coupon or bound it " +
            "(redeem_by / max_redemptions); prefer duration 'once' or 'repeating' for promotions.",
          docsUrl: DOCS.coupons,
          affectedResourceId: coupon.id,
          affectedResourceType: 'coupon',
        }),
      ),
})

/** The coupon cluster (deep tier — skipped in base mode). */
export const couponRules: Rule[] = [HIGH_PERCENT_COUPON, HIGH_AMOUNT_COUPON, FOREVER_COUPON_STILL_VALID]
