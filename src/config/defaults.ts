/**
 * stripe-audit — single source of truth for the operational constants exposed as
 * `stripe-audit.config.json` knobs (C18).
 *
 * The zod schema's `.default(...)` values AND the runtime modules' own fallbacks
 * (stripe-client, fetcher) BOTH import from here. So a config that OMITS a knob
 * and a run with NO config file at all resolve to byte-identical numbers — the
 * schema default can never drift from the runtime fallback (Principle 1,
 * single-source). Change a default here and every consumer moves in lockstep.
 */

/**
 * Hard ceiling the Stripe SDK enforces on `autoPagingToArray({ limit })`: a
 * `limit > 10000` throws (node_modules/stripe/.../autoPagination.js:
 * `if (limit > 10000)`). The fetcher requests `cap + 1` to detect list overflow,
 * so the kept cap MUST sit one below this ceiling or the `cap + 1` request is
 * illegal and every list region throws against the real SDK.
 */
export const SDK_AUTOPAGE_MAX = 10_000

/**
 * The largest value the `maxListItems` knob may take — one below the SDK ceiling
 * so the fetcher's `cap + 1` overflow probe stays legal. Expressed as
 * `SDK_AUTOPAGE_MAX - 1` (NOT a bare `9999`) so the schema `.max()` bound and the
 * fetcher's `cap + 1` legality stay provably linked to the ceiling in one place
 * (E2 — a future ceiling change moves both together).
 */
export const LIST_ITEMS_CEILING = SDK_AUTOPAGE_MAX - 1

/** Default upper bound on each auto-paginated list (memory guard for large catalogs). */
export const MAX_LIST_ITEMS = LIST_ITEMS_CEILING

/** Default per-request timeout, in milliseconds. */
export const REQUEST_TIMEOUT_MS = 30_000

/** Default bounded automatic retry count for transient network / 5xx errors (SDK-level). */
export const MAX_NETWORK_RETRIES = 2
