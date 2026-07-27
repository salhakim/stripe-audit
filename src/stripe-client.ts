/**
 * stripe-audit — the pinned, read-only Stripe client (SECURITY).
 *
 * This module is the SINGLE place the Stripe API version is pinned and the only
 * place a client is constructed. `STRIPE_API_VERSION` is typed
 * `Stripe.LatestApiVersion`, so a literal that drifts from the installed SDK
 * fails typecheck — the version can never silently diverge from the SDK's own
 * `ApiVersion`. The public barrel re-exports this constant rather than
 * re-declaring it, keeping a single source of truth.
 */
import Stripe from 'stripe'
import { MAX_NETWORK_RETRIES, REQUEST_TIMEOUT_MS } from './config/defaults'

/**
 * The exact `apiVersion` literal the installed SDK accepts, derived from its own
 * constructor config type. This is the SDK's `LatestApiVersion` (= `typeof
 * ApiVersion`); the SDK does not re-export that alias on the `Stripe` namespace,
 * so we recover it from the constructor signature. A drifted literal fails typecheck.
 */
type PinnedApiVersion = NonNullable<
  NonNullable<ConstructorParameters<typeof Stripe>[1]>['apiVersion']
>

/**
 * The single pinned Stripe API version. Typed to the SDK's accepted version
 * literal, so a value that drifts from the installed SDK fails typecheck. Tracks
 * the installed `stripe` SDK's exported `ApiVersion` — bump this and the SDK
 * together (and re-capture any version-stamped fixtures).
 */
export const STRIPE_API_VERSION: PinnedApiVersion = '2026-06-24.dahlia'

/**
 * Test-only base-URL seam, LOOPBACK-ONLY by construction.
 *
 * `STRIPE_AUDIT_TEST_BASE_URL` lets the end-to-end tests point the BUILT CLI at
 * a local fixture server (recorded 401 / recorded snapshot responses) so the
 * real fetch → error-translation → exit-code seam is exercised without any
 * network. SECURITY: only 127.0.0.1 / localhost / ::1 are honored — a
 * non-loopback value is ignored with a warning, so this env var can never be
 * used to redirect a real API key off-box. Unset (the normal case) means the
 * SDK default host, api.stripe.com.
 */
const TEST_BASE_URL_ENV = 'STRIPE_AUDIT_TEST_BASE_URL'

function testBaseOverride(): { host: string; port: number; protocol: 'http' | 'https' } | null {
  const raw = process.env[TEST_BASE_URL_ENV]
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    process.stderr.write(`stripe-audit: ${TEST_BASE_URL_ENV} is not a valid URL — ignored.\n`)
    return null
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)
  if (!loopback) {
    process.stderr.write(
      `stripe-audit: ${TEST_BASE_URL_ENV} must be a loopback address (test-only seam) — ignored.\n`,
    )
    return null
  }
  const protocol = url.protocol === 'https:' ? 'https' : 'http'
  const port = url.port !== '' ? Number(url.port) : protocol === 'https' ? 443 : 80
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port, protocol }
}

/**
 * Construct a Stripe client pinned to {@link STRIPE_API_VERSION}.
 *
 * The audit only ever issues read calls; the client carries no write helpers of
 * its own, and the fetcher is asserted to call no write methods. The
 * key is passed straight to the SDK and never logged — route any display of it
 * through `redact()` (src/key.ts).
 *
 * Telemetry is disabled: the SDK's default behavior appends anonymous
 * request-timing headers to every call. A read-only audit tool touches nothing
 * it doesn't need to, so we opt out and keep the client's footprint to the reads
 * the audit actually performs.
 *
 * `opts.maxNetworkRetries` / `opts.timeout` are the C18 config knobs threaded in
 * by the CLI. Each falls back to its {@link ./config/defaults} constant on
 * `undefined` (no config file, or a config that omits the knob), so a config-free
 * call is byte-unchanged. A `0` retry count is honored (it disables SDK retries)
 * — `??` substitutes only on `undefined`, never on a valid `0`.
 */
export function createStripeClient(
  key: string,
  opts?: { maxNetworkRetries?: number; timeout?: number },
): Stripe {
  const override = testBaseOverride()
  return new Stripe(key, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: opts?.maxNetworkRetries ?? MAX_NETWORK_RETRIES,
    timeout: opts?.timeout ?? REQUEST_TIMEOUT_MS,
    typescript: true,
    telemetry: false,
    ...(override !== null && {
      host: override.host,
      port: override.port,
      protocol: override.protocol,
    }),
  })
}

/**
 * Read the API version Stripe actually served a given response under, off the
 * SDK's `lastResponse` envelope. This is the genuine source for any
 * "API version in use" signal — it replaces the unreadable phantom field the
 * original audit assumed.
 */
export function responseApiVersion<T>(response: Stripe.Response<T>): string | undefined {
  return response.lastResponse.apiVersion
}
