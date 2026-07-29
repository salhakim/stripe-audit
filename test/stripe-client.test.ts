import { describe, it, expect } from 'vitest'
import Stripe from 'stripe'
import { STRIPE_API_VERSION, createStripeClient, responseApiVersion } from '../src/stripe-client'
import { fakeKey } from './fixtures/fake-keys'

// Placeholder key — NOT a real credential. Runtime-assembled so the source
// never matches a provider key pattern.
const TEST_KEY = fakeKey('sk', 'test')

describe('STRIPE_API_VERSION', () => {
  it('equals the installed SDK API_VERSION (a drifted SDK bump fails CI)', () => {
    expect(STRIPE_API_VERSION).toBe(Stripe.API_VERSION)
  })

  it('is the pinned date.major literal', () => {
    expect(STRIPE_API_VERSION).toBe('2026-06-24.dahlia')
    expect(STRIPE_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.[a-z]+$/)
  })
})

describe('createStripeClient', () => {
  it('constructs a Stripe client pinned to STRIPE_API_VERSION', () => {
    const client = createStripeClient(TEST_KEY)
    expect(client).toBeInstanceOf(Stripe)
    // The SDK records the configured version on its internal api field.
    expect(client.getApiField('version')).toBe(STRIPE_API_VERSION)
  })

  it('disables anonymous SDK telemetry', () => {
    const client = createStripeClient(TEST_KEY)
    expect(client.getTelemetryEnabled()).toBe(false)
  })

  // ── config-file knobs: maxNetworkRetries / timeout overrides ──
  it('applies the built-in defaults when no overrides are passed (byte-unchanged)', () => {
    const client = createStripeClient(TEST_KEY)
    expect(client.getMaxNetworkRetries()).toBe(2)
    expect(client.getApiField('timeout')).toBe(30_000)
  })

  it('honors overridden maxNetworkRetries and timeout', () => {
    const client = createStripeClient(TEST_KEY, { maxNetworkRetries: 5, timeout: 12_345 })
    expect(client.getMaxNetworkRetries()).toBe(5)
    expect(client.getApiField('timeout')).toBe(12_345)
  })

  it('honors maxNetworkRetries: 0 (disables SDK retries) — a valid 0, not a fallback', () => {
    const client = createStripeClient(TEST_KEY, { maxNetworkRetries: 0 })
    expect(client.getMaxNetworkRetries()).toBe(0)
  })
})

describe('responseApiVersion', () => {
  it('reads lastResponse.apiVersion off a Stripe.Response', () => {
    const response = {
      id: 'acct_1',
      lastResponse: {
        headers: {},
        requestId: 'req_1',
        statusCode: 200,
        apiVersion: STRIPE_API_VERSION,
      },
    } as Stripe.Response<{ id: string }>
    expect(responseApiVersion(response)).toBe(STRIPE_API_VERSION)
  })

  it('returns undefined when the response carries no apiVersion', () => {
    const response = {
      id: 'acct_1',
      lastResponse: { headers: {}, requestId: 'req_1', statusCode: 200 },
    } as Stripe.Response<{ id: string }>
    expect(responseApiVersion(response)).toBeUndefined()
  })
})
