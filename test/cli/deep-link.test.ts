import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildRestrictedKeyLink,
  buildDeepRestrictedKeyLink,
  RESTRICTED_KEY_READ_SCOPES,
  DEEP_SCOPE_PARAMS,
  DASHBOARD_APIKEYS_URL,
} from '../../src/deep-link'

/**
 * The restricted-key creation deep link. Verifies the stable URL-shape +
 * scope-count contract (independent of any future query-param prefill, which is
 * deliberately deferred): exactly the 6 least-privilege read scopes, zero over-scoping.
 */

/** Scopes a base read-only audit must NEVER request (over-scope / write grants). */
const FORBIDDEN_SCOPES = ['Customers', 'Subscriptions', 'Charges', 'PaymentIntents', 'Write']

describe('buildRestrictedKeyLink', () => {
  it('returns the documented dashboard.stripe.com/apikeys URL (no query-string prefill)', () => {
    const { url } = buildRestrictedKeyLink()
    expect(url).toBe(DASHBOARD_APIKEYS_URL)
    expect(url).toBe('https://dashboard.stripe.com/apikeys')
    expect(url).not.toContain('?') // stable contract: no prefill query string in v0.1.0
  })

  it('grants exactly 6 read scopes', () => {
    const { scopes } = buildRestrictedKeyLink()
    expect(scopes).toHaveLength(6)
    expect(scopes).toEqual([
      'Account',
      'Webhook Endpoints',
      'Products',
      'Prices',
      'Customer Portal',
      'Tax',
    ])
  })

  it('over-scopes nothing — no Customers/Subscriptions/Charges/PaymentIntents/Write', () => {
    const { scopes } = buildRestrictedKeyLink()
    for (const forbidden of FORBIDDEN_SCOPES) {
      expect(scopes).not.toContain(forbidden)
    }
  })

  it('exposes the same 6 scopes as the exported constant', () => {
    expect(buildRestrictedKeyLink().scopes).toEqual([...RESTRICTED_KEY_READ_SCOPES])
    expect(RESTRICTED_KEY_READ_SCOPES).toHaveLength(6)
  })
})

/**
 * The DEEP restricted-key link variant (security-sensitive).
 */
describe('buildDeepRestrictedKeyLink', () => {
  it('returns the same documented dashboard URL with NO query params', () => {
    const { url } = buildDeepRestrictedKeyLink()
    expect(url).toBe(DASHBOARD_APIKEYS_URL)
    expect(url).toMatch(/^https:\/\/dashboard\.stripe\.com\//)
    expect(url).not.toContain('?')
  })

  it('grants base-6 PLUS the four gate-approved deep scope names, in order', () => {
    const { scopes } = buildDeepRestrictedKeyLink()
    expect(scopes).toEqual([
      ...RESTRICTED_KEY_READ_SCOPES,
      'Subscriptions',
      'Billing Meters',
      'Event Destinations',
      'Coupons',
    ])
    expect(scopes).toHaveLength(10)
  })

  it('never requests a Radar permission (verify-gate DROPPED → least privilege, S4)', () => {
    const { scopes } = buildDeepRestrictedKeyLink()
    expect(scopes.some((s) => /radar/i.test(s))).toBe(false)
    expect(Object.keys(DEEP_SCOPE_PARAMS)).not.toContain('radar')
  })

  it('deep scope ids mirror the engine deep regions the fetcher actually reads', () => {
    expect(Object.keys(DEEP_SCOPE_PARAMS).sort()).toEqual([
      'coupons',
      'event_destinations',
      'meters',
      'subscriptions',
    ])
  })

  it('embeds no key material anywhere in the contract (S1)', () => {
    const link = buildDeepRestrictedKeyLink()
    const blob = JSON.stringify(link)
    expect(blob).not.toMatch(/rk_(test|live)_/)
    expect(blob).not.toMatch(/sk_(test|live)_/)
  })

  it('the builder source carries the PROVISIONAL caveat on the scope names', () => {
    const src = readFileSync(new URL('../../src/deep-link.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/PROVISIONAL/i)
    expect(src).toMatch(/one-line/)
  })
})
