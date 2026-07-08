/**
 * stripe-audit — plain-language Stripe error translation. Security-sensitive module.
 *
 * When a live-audit Stripe call fails, the CLI catches the error and renders a
 * PLAIN-LANGUAGE explanation + the restricted-key creation deep link —
 * never a raw stack trace, never the key value — then exits 3. Branches on the
 * error TYPE (`Stripe.errors.*`), never a message regex (the same discipline
 * fetcher.ts already uses for StripePermissionError).
 *
 * SECURITY (key redaction): the key value never appears in output. Any key shown is
 * routed through redact() (the single redaction chokepoint); the raw error
 * message is NOT echoed (it can carry SDK internals) — only fixed plain-language
 * copy. Every branch renders the read-only restricted-key fix, so the user always
 * gets a one-click recovery path regardless of which failure occurred.
 */
import Stripe from 'stripe'
import { redact } from './key'
import { buildRestrictedKeyLink } from './deep-link'

/** The shared "create a correctly-scoped key" fix block: deep link + the 6 read scopes. */
function fixBlock(): string[] {
  const link = buildRestrictedKeyLink()
  return [
    `Create a read-only restricted key with Read on exactly these ${link.scopes.length} scopes (everything else: None):`,
    `  ${link.scopes.join(', ')}`,
    `  ${link.url}`,
  ]
}

/**
 * Translate a caught Stripe error into a plain-language, key-safe message plus the
 * restricted-key deep link.
 *
 * @param err the caught error (branched on type, never message-parsed)
 * @param key optional — shown REDACTED only (never raw); omit to show no key
 */
export function translateStripeError(err: unknown, key?: string): string {
  const shown = key ? ` (${redact(key)})` : ''
  if (err instanceof Stripe.errors.StripeAuthenticationError) {
    return [
      `stripe-audit: authentication failed — the API key${shown} is invalid, expired, or revoked.`,
      ...fixBlock(),
    ].join('\n')
  }
  if (err instanceof Stripe.errors.StripePermissionError) {
    return [
      `stripe-audit: permission denied — the restricted key${shown} lacks one of the read-only scopes this audit needs.`,
      ...fixBlock(),
    ].join('\n')
  }
  if (err instanceof Stripe.errors.StripeConnectionError) {
    return [
      'stripe-audit: could not reach Stripe (network/transport error). ' +
        'Check your connection, then run again with a read-only restricted key.',
      ...fixBlock(),
    ].join('\n')
  }
  // A Stripe error that is none of the 3 typed branches above — still genuinely a
  // Stripe API problem, so keep the verify-your-key wording + restricted-key fix.
  // Branched on the SDK base class (every Stripe error extends StripeError), never
  // message-parsed; key-safe, no stack trace.
  if (err instanceof Stripe.errors.StripeError) {
    return [
      'stripe-audit: the audit could not complete due to a Stripe API error. ' +
        'Verify your read-only restricted key:',
      ...fixBlock(),
    ].join('\n')
  }
  // NOT a Stripe error — an unexpected internal fault (e.g. a stripe-audit bug, or
  // the SDK-internal unhandled rejection caught by the cli.ts backstop). Re-scoping a
  // key cannot fix this, so do NOT blame the key and do NOT render the restricted-key
  // fix. Stays generic — the raw error text (message/stack) is never echoed (S1).
  return (
    'stripe-audit: an unexpected internal error stopped the audit. This is a bug in ' +
    'stripe-audit, not a problem with your key. Please re-run; if it persists, report it.'
  )
}
