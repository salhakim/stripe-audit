import { describe, it, expect } from 'vitest'
import Stripe from 'stripe'
import { translateStripeError } from '../../src/errors'

/**
 * Plain-language Stripe error translation. Unit-tested
 * network-free with constructed Stripe error instances: every branch yields plain
 * language + the restricted-key deep link, never a raw stack trace, never the key
 * value (concatenated so no key literal lands in source).
 */
const FAKE_KEY = 'rk_' + 'test_' + 'Z'.repeat(24)
const DEEP_LINK = /https:\/\/dashboard\.stripe\.com\/apikeys/
const STACK_MARKERS = /at Object|node_modules|stripe\/lib|StripeError: /

describe('translateStripeError', () => {
  it('authentication error → invalid/expired + deep link, redacted key, no stack', () => {
    const err = new Stripe.errors.StripeAuthenticationError({
      type: 'invalid_request_error',
      message: 'Invalid API Key provided',
    })
    const out = translateStripeError(err, FAKE_KEY)
    expect(out.toLowerCase()).toMatch(/invalid|expired|authentication/)
    expect(out).toMatch(DEEP_LINK)
    expect(out).not.toContain(FAKE_KEY)
    expect(out).not.toMatch(STACK_MARKERS)
  })

  it('permission error → scope/read-only language + deep link', () => {
    const err = new Stripe.errors.StripePermissionError({
      type: 'invalid_request_error',
      message: 'restricted key lacks a scope',
    })
    const out = translateStripeError(err, FAKE_KEY)
    expect(out.toLowerCase()).toMatch(/permission|scope|read-only/)
    expect(out).toMatch(DEEP_LINK)
    expect(out).not.toContain(FAKE_KEY)
  })

  it('connection/transport error → plain message + deep link, no stack', () => {
    const err = new Stripe.errors.StripeConnectionError({
      message: 'ECONNREFUSED',
    })
    const out = translateStripeError(err)
    expect(out.toLowerCase()).toMatch(/network|transport|reach/)
    expect(out).toMatch(DEEP_LINK)
    expect(out).not.toMatch(STACK_MARKERS)
  })

  it('Stripe error of an untyped kind → Stripe API error + verify-key + deep link', () => {
    const err = new Stripe.errors.StripeRateLimitError({
      type: 'rate_limit_error',
      message: 'Too many requests',
    })
    const out = translateStripeError(err, FAKE_KEY)
    expect(out.toLowerCase()).toMatch(/stripe api error|could not complete/)
    expect(out).toMatch(DEEP_LINK)
    expect(out).not.toContain(FAKE_KEY)
    expect(out).not.toMatch(STACK_MARKERS)
  })

  it('non-Stripe internal error → internal-bug wording, never blames the key, raw message not echoed', () => {
    const out = translateStripeError(new Error('boom internals'))
    expect(out.toLowerCase()).toMatch(/internal error|bug in stripe-audit/)
    expect(out.toLowerCase()).not.toContain('verify')
    expect(out.toLowerCase()).not.toContain('restricted key')
    expect(out).not.toContain('boom internals')
    expect(out).not.toMatch(DEEP_LINK)
    expect(out).not.toMatch(STACK_MARKERS)
  })

  it('shows at most a redacted key — never the secret body', () => {
    const err = new Stripe.errors.StripeAuthenticationError({
      type: 'invalid_request_error',
      message: 'x',
    })
    const out = translateStripeError(err, FAKE_KEY)
    expect(out).not.toContain(FAKE_KEY)
    expect(out).not.toMatch(/rk_test_Z{12,}/)
  })
})
