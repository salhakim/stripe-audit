/**
 * stripe-audit — Stripe API-version ordering (Layer-5 first-principles helper).
 *
 * Stripe API versions are `YYYY-MM-DD.codename` strings, and a *major* release is
 * identified by its codename (assigned ALPHABETICALLY — Acacia, Basil, Clover,
 * Dahlia, …), NOT by semver. Two facts follow:
 *
 *   1. You cannot semver-compare these strings; `'2025-03-31.basil' > '2024-…'`
 *      happens to work as a date compare, but "how many MAJORS apart" needs the
 *      ordered list of majors — dates alone can't tell you a major boundary.
 *   2. The changelog cache (`stripe/api-changelog.md`) enumerates every release
 *      heading: codenames begin at `2024-09-30.acacia` (line 1370) and every
 *      earlier version is DATE-ONLY (`YYYY-MM-DD`, last: `2024-06-20`, line
 *      1494). This module still carries a hand-maintained ordered constant of
 *      the majors — the single thing bumped when `STRIPE_API_VERSION` advances
 *      to a new major — now grounded by that enumeration rather than the
 *      scheme-description page alone (`upgrades-api-versions.md:17`).
 *
 * Ordering is by major-release INDEX (the canonical major identifier). A
 * date-only version parses with `codename: null` and orders as major index −1 —
 * older than every codenamed major (safe by the acacia boundary above). The
 * date is informational; an unknown codename (a future,
 * unlisted major) falls back to ISO-date string comparison (ISO-8601 dates sort
 * chronologically as plain strings).
 *
 * Sole production consumer: WEBHOOK_API_VERSION_MISMATCH (via
 * `compareApiVersions`). API_VERSION_OUTDATED was DROPPED as specced
 * (see `src/rules/dropped.ts` — re-scoped to the lastResponse.apiVersion echo
 * signal); `majorsBehind` / `CEILING_CODENAME` are retained fully tested for
 * that re-scoped work.
 */

/** One Stripe major release. `date` is the public release date (informational). */
export interface StripeMajorRelease {
  codename: string
  /** Public release date `YYYY-MM-DD`, or null when not published in our cache. */
  date: string | null
}

/**
 * Stripe major releases, oldest → newest. The ARRAY ORDER is the source of truth
 * for "how many majors apart" two versions are. Maintained by hand; bump it (and
 * `STRIPE_API_VERSION` in stripe-client.ts) together when Stripe ships a new major.
 *
 * Grounded by Stripe's API-upgrades documentation (https://docs.stripe.com/upgrades).
 * `dahlia` is the current ceiling — it equals the pinned `STRIPE_API_VERSION`
 * (`2026-06-24.dahlia`). `clover` sits between basil and dahlia by Stripe's
 * alphabetical codename scheme; its exact date is not in our cache (ordering uses
 * the codename index, not this date), so it is recorded null rather than invented.
 */
export const MAJOR_RELEASES: readonly StripeMajorRelease[] = [
  { codename: 'acacia', date: '2024-09-30' },
  { codename: 'basil', date: '2025-03-31' },
  { codename: 'clover', date: null },
  { codename: 'dahlia', date: '2026-06-24' },
]

/** The current API-version ceiling — the newest known major (== STRIPE_API_VERSION's major). */
export const CEILING_CODENAME: string = MAJOR_RELEASES[MAJOR_RELEASES.length - 1].codename

/**
 * A parsed API version. `codename: null` marks a legacy DATE-ONLY version
 * (`YYYY-MM-DD`, pre-acacia — e.g. the pins long-lived webhook endpoints carry).
 */
export interface ParsedApiVersion {
  date: string
  codename: string | null
}

const VERSION_RE = /^(\d{4}-\d{2}-\d{2})(?:\.([a-z]+))?$/

/**
 * Parse a `YYYY-MM-DD.codename` or legacy date-only `YYYY-MM-DD` string (the
 * latter yields `codename: null`). Returns null for null/undefined/malformed
 * input — callers treat null as "not determinable" (no finding, no crash).
 */
export function parseApiVersion(version: string | null | undefined): ParsedApiVersion | null {
  if (typeof version !== 'string') return null
  const match = VERSION_RE.exec(version.trim())
  if (!match) return null
  return { date: match[1], codename: match[2] ?? null }
}

/** Index of a codename in {@link MAJOR_RELEASES}, or -1 if unknown. */
function majorIndex(codename: string): number {
  return MAJOR_RELEASES.findIndex((r) => r.codename === codename)
}

/**
 * The ladder position of a parsed version, or null when not placeable.
 * `codename: null` (date-only, pre-acacia) ⇒ −1: older than every codenamed
 * major by the changelog boundary (see the header). A codename not in
 * {@link MAJOR_RELEASES} (a future, unlisted major) ⇒ null — callers fall back
 * to date comparison or report "not determinable".
 */
function effectiveMajorIndex(parsed: ParsedApiVersion): number | null {
  if (parsed.codename === null) return -1
  const index = majorIndex(parsed.codename)
  return index >= 0 ? index : null
}

/** Plain ISO-date string comparison (dates are chronologically sortable as strings). */
function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Compare two Stripe API versions chronologically.
 *
 * Returns a negative number if `a` is older than `b`, 0 if they are the same
 * version, a positive number if `a` is newer — or `null` if EITHER side is
 * null/malformed (the caller treats null as not-determinable).
 *
 * Primary ordering is by major-release index (the canonical major identifier), so
 * a same-date / different-codename pair still orders correctly. Within one major
 * (monthly releases share a codename) the date breaks the tie — as does a pair of
 * date-only versions (both index −1, the pre-major era). An unrecognized codename
 * falls back to a pure date comparison.
 */
export function compareApiVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const pa = parseApiVersion(a)
  const pb = parseApiVersion(b)
  if (!pa || !pb) return null

  const ia = effectiveMajorIndex(pa)
  const ib = effectiveMajorIndex(pb)
  if (ia !== null && ib !== null) {
    if (ia !== ib) return ia - ib
    return compareDates(pa.date, pb.date)
  }
  // At least one codename is unknown (a future/unreleased major) — order by date.
  return compareDates(pa.date, pb.date)
}

/**
 * True iff `a` is strictly older than `b`. False when equal, newer, or when either
 * side is not determinable (null/malformed) — an undeterminable comparison never
 * counts as "older".
 */
export function isOlderApiVersion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const cmp = compareApiVersions(a, b)
  return cmp !== null && cmp < 0
}

/**
 * How many MAJOR releases `version` is behind `ceiling`.
 *
 * Returns 0 when `version` is the same major as (or newer than) `ceiling`, and
 * `null` when either side is null/malformed or carries a codename not in
 * {@link MAJOR_RELEASES} (not determinable — the count would be a guess).
 *
 * A date-only version counts as index −1 (pre-acacia), so it reads as the FULL
 * ladder depth behind the ceiling — `ceiling index + 1` majors (the most
 * outdated pins fire maximally, e.g.
 * `majorsBehind('2022-08-01', '2026-06-24.dahlia') === 4`).
 */
export function majorsBehind(
  version: string | null | undefined,
  ceiling: string | null | undefined,
): number | null {
  const pv = parseApiVersion(version)
  const pc = parseApiVersion(ceiling)
  if (!pv || !pc) return null

  const iv = effectiveMajorIndex(pv)
  const ic = effectiveMajorIndex(pc)
  if (iv === null || ic === null) return null
  return Math.max(0, ic - iv)
}
