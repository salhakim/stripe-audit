/**
 * stripe-audit — API key format detection + redaction (SECURITY).
 *
 * Threat model: live-key exposure and over-broad key scope.
 *
 * Two invariants this module exists to hold:
 *   1. Key mode/kind is derived LOCALLY from the key PREFIX — never from a live
 *      API field like `charges_enabled`. No network call is needed (or made) to
 *      classify a key, and the format is validated BEFORE any API call.
 *   2. `redact()` is the single chokepoint every reporter/error path uses to show
 *      a key. It reveals no more than the (non-secret) type prefix + last 4 and
 *      always masks the entropy in between — the full key can never be
 *      reconstructed from its output, and the raw key is never logged.
 */

/** What a key is: live vs test mode, and restricted (scoped) vs secret (full-access). */
export interface KeyMode {
  mode: 'live' | 'test'
  kind: 'restricted' | 'secret'
}

/** Prefix → classification. `rk_` = restricted (least-privilege), `sk_` = secret (full-access). */
const PREFIX_TABLE: ReadonlyArray<readonly [string, KeyMode]> = [
  ['sk_live_', { mode: 'live', kind: 'secret' }],
  ['sk_test_', { mode: 'test', kind: 'secret' }],
  ['rk_live_', { mode: 'live', kind: 'restricted' }],
  ['rk_test_', { mode: 'test', kind: 'restricted' }],
]

/** The recognized key prefixes (the non-secret, type-identifying head of a key). */
export const KEY_PREFIXES: readonly string[] = PREFIX_TABLE.map(([prefix]) => prefix)

/**
 * Classify a Stripe API key from its prefix alone.
 *
 * @throws TypeError when `key` is not a string.
 * @throws Error when `key` does not match a recognized `sk_`/`rk_` prefix with a
 *   non-empty body (malformed / unsupported, e.g. a publishable `pk_` key).
 *
 * The thrown message never contains the key value (S1) — only the expected prefixes.
 */
export function detectKeyMode(key: string): KeyMode {
  if (typeof key !== 'string') {
    throw new TypeError('detectKeyMode: key must be a string')
  }
  const trimmed = key.trim()
  for (const [prefix, meta] of PREFIX_TABLE) {
    if (trimmed.startsWith(prefix) && trimmed.length > prefix.length) {
      return { ...meta }
    }
  }
  throw new Error(
    `detectKeyMode: unrecognized key format — expected one of ${KEY_PREFIXES.join(', ')}<body>`,
  )
}

/** Fixed-width mask — a constant so the redacted form leaks no length information. */
const MASK = '******'

/**
 * Mask a key for safe display. Reveals at most the type prefix + the last 4
 * characters, with a fixed mask between. Defensive and total: it never throws
 * (it is used in error paths) and accepts any input. A key too short to leave a
 * masked gap is fully redacted rather than partially exposed.
 *
 * This is the ONLY sanctioned way to put a key (or key-like value) into any
 * string a human or log might see.
 */
export function redact(key: unknown): string {
  if (typeof key !== 'string') return '<redacted>'
  const trimmed = key.trim()
  if (trimmed.length === 0) return '<redacted>'

  const prefix = KEY_PREFIXES.find((p) => trimmed.startsWith(p))

  // Reveal prefix + last4 only when a genuine masked gap remains; otherwise a
  // short string would be (almost) fully exposed by the "redaction".
  if (prefix && trimmed.length > prefix.length + 8) {
    return `${prefix}${MASK}${trimmed.slice(-4)}`
  }
  if (trimmed.length > 12) {
    return `${MASK}${trimmed.slice(-4)}`
  }
  return '<redacted>'
}
