/**
 * stripe-audit — webhook rule cluster.
 *
 * Eight pure `(snapshot) => Finding[]` rules over the `webhook_endpoints` (+ `account`)
 * base regions. Re-grounded against
 * the v1 rule-readability audit (which supersedes the original spec's
 * rule table) and the Stripe API reference:
 *   - `api/webhook_endpoint_object.md` — `enabled_events`, `status`, `url`, `api_version`
 *   - `webhook_endpoints.md` — classic `/v1/webhook_endpoints` (no numeric cap)
 *   - `accounts_object.md` / `api-keys.md` — accountMode (key prefix), account default version
 *
 * Every rule declares `requires` over BASE regions only, so the whole cluster
 * derives to base tier. Findings are built via {@link buildFinding} (schema-complete
 * by construction) and cite {@link DOCS}.
 */
import { defineRule } from '../define-rule'
import { STRIPE_API_VERSION } from '../stripe-client'
import type { Finding, Rule, RuleOptions, StripeAccountSnapshot } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'
import { compareApiVersions } from './version-order'

/**
 * Default trip count for {@link WEBHOOK_TOO_MANY_ENDPOINTS} when no
 * `options.threshold` is supplied. A SOFT advisory heuristic over an unusually
 * large *enabled-endpoint* count — deliberately NOT the v2 event-destinations
 * 16-cap (that limit does not apply to classic `/v1/webhook_endpoints`).
 */
export const DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD = 10

/** Billing-critical events that at least one enabled endpoint should subscribe to. */
export const BILLING_CRITICAL_EVENTS: readonly string[] = [
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'customer.subscription.deleted',
]

const TEST_HOST_EXACT = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])
const TEST_HOST_SUFFIX = [
  '.local',
  '.test',
  '.localhost',
  '.ngrok.io',
  '.ngrok-free.app',
  '.ngrok.app',
]

/** Parse a URL, returning null when it is malformed (the rule then skips it). */
function safeUrl(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** True when `host` looks like a local/tunnel/test target unfit for live traffic. */
function isTestHost(host: string): boolean {
  const h = host.toLowerCase()
  if (TEST_HOST_EXACT.has(h)) return true
  return TEST_HOST_SUFFIX.some((suffix) => h.endsWith(suffix))
}

const enabled = (snapshot: StripeAccountSnapshot) =>
  snapshot.webhookEndpoints.filter((ep) => ep.status === 'enabled')

// ─────────────────────────────────────────────────────────────────────────────
// Rules
// ─────────────────────────────────────────────────────────────────────────────

/** A live, enabled endpoint subscribing to all events (`*`) — over-broad, masks delivery gaps. */
export const WEBHOOK_SELECT_ALL: Rule = defineRule({
  id: 'WEBHOOK_SELECT_ALL',
  name: 'Webhook endpoint subscribes to all events',
  severity: 'critical',
  category: 'webhooks',
  requires: ['webhook_endpoints'],
  check: (snapshot) =>
    enabled(snapshot)
      .filter((ep) => ep.enabledEvents.includes('*'))
      .map((ep) =>
        buildFinding(WEBHOOK_SELECT_ALL, {
          title: `Webhook endpoint subscribes to all events (*)`,
          description: `Enabled endpoint ${ep.url} subscribes to all event types (\`*\`). A blanket subscription hides which revenue-critical events are actually consumed, so a silently dropped \`invoice.payment_failed\` looks identical to an event you never wanted.`,
          remediation:
            'Subscribe each endpoint to the explicit list of events it handles. Reserve `*` for debugging, never production billing.',
          docsUrl: DOCS.webhooks,
          affectedResourceId: ep.id,
          affectedResourceType: 'webhook_endpoint',
          estimatedImpact: 'Masked delivery failures of billing events can silently leak recurring revenue.',
        }),
      ),
})

/** A disabled endpoint — receives nothing, so any event it was meant to handle is dropped. */
export const WEBHOOK_ENDPOINT_DISABLED: Rule = defineRule({
  id: 'WEBHOOK_ENDPOINT_DISABLED',
  name: 'Webhook endpoint is disabled',
  severity: 'high',
  category: 'webhooks',
  requires: ['webhook_endpoints'],
  check: (snapshot) =>
    snapshot.webhookEndpoints
      .filter((ep) => ep.status === 'disabled')
      .map((ep) =>
        buildFinding(WEBHOOK_ENDPOINT_DISABLED, {
          title: `Webhook endpoint is disabled`,
          description: `Endpoint ${ep.url} is disabled, so every event it subscribes to is currently dropped. Stripe disables endpoints automatically after repeated delivery failures.`,
          remediation:
            'Re-enable the endpoint once the receiver is healthy, or delete it if it is obsolete so it no longer reads as a coverage gap.',
          docsUrl: DOCS.webhookBestPractices,
          affectedResourceId: ep.id,
          affectedResourceType: 'webhook_endpoint',
        }),
      ),
})

/**
 * An unusually large number of ENABLED endpoints (soft advisory). Trip count comes
 * from `options.threshold` (the engine's optional `check` 2nd arg) and falls back
 * to {@link DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD} when unset.
 */
export const WEBHOOK_TOO_MANY_ENDPOINTS: Rule = defineRule({
  id: 'WEBHOOK_TOO_MANY_ENDPOINTS',
  name: 'Unusually many enabled webhook endpoints',
  severity: 'medium',
  category: 'webhooks',
  requires: ['webhook_endpoints'],
  check: (snapshot: StripeAccountSnapshot, options?: RuleOptions): Finding[] => {
    // Only a finite, non-negative number tunes the advisory. A NaN/Infinity or
    // negative override (e.g. `{ threshold: NaN }` or `-1`) would otherwise turn a
    // soft heuristic into a false-positive machine (`count <= NaN` is always false;
    // a negative threshold fires on any account with ≥1 endpoint), so it falls back
    // to the documented built-in default instead.
    const override = options?.threshold
    const threshold =
      typeof override === 'number' && Number.isFinite(override) && override >= 0
        ? override
        : DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD
    const count = enabled(snapshot).length
    if (count <= threshold) return []
    return [
      buildFinding(WEBHOOK_TOO_MANY_ENDPOINTS, {
        title: `Unusually many enabled webhook endpoints (${count})`,
        description: `${count} enabled webhook endpoints exceed the advisory threshold of ${threshold}. A sprawl of endpoints is hard to keep version-consistent and is often a sign of stale test/integration endpoints left in place.`,
        remediation:
          'Audit the endpoint list and remove any that are no longer needed. Set `options.threshold` to tune this advisory for your integration.',
        docsUrl: DOCS.webhookEndpoints,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** Two or more ENABLED endpoints pointing at the same URL — duplicate delivery / config drift. */
export const WEBHOOK_DUPLICATE_URL: Rule = defineRule({
  id: 'WEBHOOK_DUPLICATE_URL',
  name: 'Duplicate webhook endpoint URL',
  severity: 'medium',
  category: 'webhooks',
  requires: ['webhook_endpoints'],
  check: (snapshot) => {
    const byUrl = new Map<string, number>()
    for (const ep of enabled(snapshot)) {
      byUrl.set(ep.url, (byUrl.get(ep.url) ?? 0) + 1)
    }
    const findings: Finding[] = []
    for (const [url, count] of byUrl) {
      if (count > 1) {
        findings.push(
          buildFinding(WEBHOOK_DUPLICATE_URL, {
            title: `Duplicate webhook endpoint URL`,
            description: `${count} enabled endpoints deliver to the same URL ${url}. Duplicate endpoints double-deliver every event and usually mean a forgotten copy is still live.`,
            remediation:
              'Consolidate to a single endpoint per URL and delete the duplicates, or give each a distinct URL if duplication is intentional.',
            docsUrl: DOCS.webhookEndpoints,
            affectedResourceId: null,
            affectedResourceType: 'webhook_endpoint',
          }),
        )
      }
    }
    return findings
  },
})

/** A non-HTTPS endpoint URL while the account is in LIVE mode — events sent in the clear. */
export const WEBHOOK_INSECURE_URL: Rule = defineRule({
  id: 'WEBHOOK_INSECURE_URL',
  name: 'Insecure (non-HTTPS) webhook URL in live mode',
  severity: 'high',
  category: 'webhooks',
  requires: ['webhook_endpoints', 'account'],
  check: (snapshot) => {
    if (snapshot.accountMode !== 'live') return []
    return snapshot.webhookEndpoints
      .filter((ep) => {
        const parsed = safeUrl(ep.url)
        return parsed !== null && parsed.protocol !== 'https:'
      })
      .map((ep) =>
        buildFinding(WEBHOOK_INSECURE_URL, {
          title: `Insecure (non-HTTPS) webhook URL`,
          description: `Endpoint ${ep.url} uses a non-HTTPS scheme on a live account. Event payloads (including signing material) travel unencrypted and can be intercepted or tampered with.`,
          remediation: 'Serve the receiver over HTTPS and update the endpoint URL to an `https://` origin.',
          docsUrl: DOCS.webhookBestPractices,
          affectedResourceId: ep.id,
          affectedResourceType: 'webhook_endpoint',
        }),
      )
  },
})

/** No enabled endpoint subscribes some billing-critical event — silent revenue gaps. */
export const WEBHOOK_SELECTION_REQUIRED_MISSED: Rule = defineRule({
  id: 'WEBHOOK_SELECTION_REQUIRED_MISSED',
  name: 'Billing-critical webhook events are not subscribed',
  severity: 'high',
  category: 'webhooks',
  requires: ['webhook_endpoints'],
  check: (snapshot) => {
    const enabledEndpoints = enabled(snapshot)
    // Only flag MISSING coverage among endpoints that exist — an account with zero
    // enabled endpoints is a different concern, not "your webhooks miss criticals".
    if (enabledEndpoints.length === 0) return []
    // A `*` subscription on any enabled endpoint covers every event.
    if (enabledEndpoints.some((ep) => ep.enabledEvents.includes('*'))) return []
    const covered = new Set(enabledEndpoints.flatMap((ep) => ep.enabledEvents))
    const missing = BILLING_CRITICAL_EVENTS.filter((evt) => !covered.has(evt))
    if (missing.length === 0) return []
    return [
      buildFinding(WEBHOOK_SELECTION_REQUIRED_MISSED, {
        title: `Billing-critical webhook events are not subscribed`,
        description: `No enabled endpoint subscribes to: ${missing.join(', ')}. Without these, failed payments and cancellations never reach your systems, so churn and dunning go unhandled.`,
        remediation: `Subscribe at least one enabled endpoint to each billing-critical event (${BILLING_CRITICAL_EVENTS.join(', ')}).`,
        docsUrl: DOCS.webhooks,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** An endpoint pointing at a localhost/tunnel/test host while the account is LIVE. */
export const WEBHOOK_TEST_ENDPOINT_IN_LIVE: Rule = defineRule({
  id: 'WEBHOOK_TEST_ENDPOINT_IN_LIVE',
  name: 'Test/local webhook endpoint on a live account',
  severity: 'high',
  category: 'webhooks',
  requires: ['webhook_endpoints', 'account'],
  check: (snapshot) => {
    if (snapshot.accountMode !== 'live') return []
    return snapshot.webhookEndpoints
      .filter((ep) => {
        const parsed = safeUrl(ep.url)
        return parsed !== null && isTestHost(parsed.hostname)
      })
      .map((ep) =>
        buildFinding(WEBHOOK_TEST_ENDPOINT_IN_LIVE, {
          title: `Test/local webhook endpoint on a live account`,
          description: `Endpoint ${ep.url} targets a local or tunnel host (e.g. localhost / ngrok / *.test) on a live account. Live events are being routed to a development target — they will be lost in production.`,
          remediation:
            'Point live endpoints at a production HTTPS origin. Use test-mode keys and local tunnels for development, never the live account.',
          docsUrl: DOCS.webhookBestPractices,
          affectedResourceId: ep.id,
          affectedResourceType: 'webhook_endpoint',
        }),
      )
  },
})

/**
 * An enabled endpoint pinned to an API version OLDER than the latest Stripe
 * release the audit knows ({@link STRIPE_API_VERSION}, the SDK's LatestApiVersion).
 *
 * The account's TRUE default version is not observable through stripe-node — an
 * "unpinned" client still sends `Stripe-Version: DEFAULT_API_VERSION` — so the SDK
 * pin is the comparison baseline (the latest the tool is aware of). A null endpoint
 * api_version means "not pinned" (inherits the account default) → never a mismatch.
 */
export const WEBHOOK_API_VERSION_MISMATCH: Rule = defineRule({
  id: 'WEBHOOK_API_VERSION_MISMATCH',
  name: 'Webhook endpoint pinned to an outdated API version',
  severity: 'medium',
  category: 'webhooks',
  requires: ['webhook_endpoints'],
  check: (snapshot) =>
    enabled(snapshot)
      .filter((ep) => {
        // A null endpoint api_version means "not pinned" — it inherits the account
        // default, so it is never a mismatch.
        if (ep.apiVersion === null) return false
        const cmp = compareApiVersions(ep.apiVersion, STRIPE_API_VERSION)
        return cmp !== null && cmp < 0
      })
      .map((ep) =>
        buildFinding(WEBHOOK_API_VERSION_MISMATCH, {
          title: `Webhook endpoint pinned to an outdated API version`,
          description: `Endpoint ${ep.url} is pinned to API version ${ep.apiVersion}, older than the latest Stripe release the audit knows (${STRIPE_API_VERSION}). Pinned endpoints receive event shapes from an older release, which drift from newer integration code.`,
          remediation:
            'Upgrade the endpoint to the latest API version after confirming your handler tolerates the newer event shapes, or intentionally re-pin it.',
          docsUrl: DOCS.apiVersions,
          affectedResourceId: ep.id,
          affectedResourceType: 'webhook_endpoint',
        }),
      ),
})

/** The webhook rule cluster, in stable order. Aggregated into ALL_RULES by `index.ts`. */
export const webhookRules: Rule[] = [
  WEBHOOK_SELECT_ALL,
  WEBHOOK_ENDPOINT_DISABLED,
  WEBHOOK_TOO_MANY_ENDPOINTS,
  WEBHOOK_DUPLICATE_URL,
  WEBHOOK_INSECURE_URL,
  WEBHOOK_SELECTION_REQUIRED_MISSED,
  WEBHOOK_TEST_ENDPOINT_IN_LIVE,
  WEBHOOK_API_VERSION_MISMATCH,
]
