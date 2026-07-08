/**
 * stripe-audit — JSON reporter.
 *
 * The canonical machine-readable surface: a pure `(AuditResult) -> string` that
 * serializes the result verbatim. The CI Action, the baseline gate, and any
 * downstream tooling consume this shape, so it is a faithful, stable dump of the
 * {@link AuditResult} — no derived prose, no reformatting of fields.
 *
 * Pure: it touches no key material and makes no network call. The result it
 * serializes carries no Stripe key (findings reference resource ids and a
 * key-mode enum, never the key), so the output can never leak one.
 */
import type { AuditResult } from './result'

/** Serialize an {@link AuditResult} as pretty-printed (2-space) JSON. */
export function renderJson(result: AuditResult): string {
  return JSON.stringify(result, null, 2)
}
