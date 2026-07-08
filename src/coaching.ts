/**
 * stripe-audit — local key-prefix coaching. Security-sensitive module.
 *
 * A PURE local classifier that inspects ONLY a key's literal prefix (via
 * `detectKeyMode`) and emits tailored, NON-BLOCKING coaching. It NEVER transmits
 * the key anywhere to classify it — no network, no API call — and the full key
 * value NEVER appears in any line: every key display routes through `redact()`
 * (the single redaction chokepoint). Classification alone never changes the
 * exit code; the CLI writes these lines to stderr and proceeds.
 *
 * Threat model: live-key exposure (redact every display), plus
 * over-broad scope (steer secret keys toward a least-privilege restricted key).
 *
 * Four branches (grounded in Stripe's API-keys documentation,
 * https://docs.stripe.com/keys: rk_ = restricted, sk_ = unrestricted):
 *   - rk_test_ / rk_live_  → celebrate (correct least-privilege restricted key)
 *   - sk_live_             → warn + suggest a read-only restricted key
 *   - sk_test_             → accept + the same restricted-key suggestion
 *   - prefix-vs-expected-mode mismatch → an informational note (seam: the optional
 *     `expectedMode` arg; the CLI has no --mode flag, so it passes none)
 */
import { detectKeyMode, redact } from './key'

/** Build non-blocking coaching lines for a key, from its prefix alone. */
export function coachKeyPrefix(key: string, expectedMode?: 'test' | 'live'): string[] {
  const shown = redact(key)
  let mode: ReturnType<typeof detectKeyMode>
  try {
    mode = detectKeyMode(key)
  } catch {
    // Unrecognized format — a gentle note, never the raw value. Non-blocking.
    return [`stripe-audit: key format not recognized (${shown}) — expected an rk_/sk_ key.`]
  }

  const lines: string[] = []
  if (mode.kind === 'restricted') {
    lines.push(
      `stripe-audit: ✓ ${shown} is a restricted key — least privilege, exactly right for a read-only audit.`,
    )
  } else if (mode.mode === 'live') {
    lines.push(
      `stripe-audit: warning — ${shown} is a full-access secret key. ` +
        `Consider a read-only restricted key instead — stripe-audit only needs Read access.`,
    )
  } else {
    lines.push(
      `stripe-audit: ${shown} is a full-access secret key (accepted). ` +
        `Consider a read-only restricted key — stripe-audit only needs Read access.`,
    )
  }

  // Mismatch note (seam): the key's mode disagrees with an expected-mode hint.
  if (expectedMode && mode.mode !== expectedMode) {
    lines.push(
      `stripe-audit: note — this is a ${mode.mode}-mode key, but ${expectedMode} mode was expected.`,
    )
  }

  return lines
}
