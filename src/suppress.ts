/**
 * stripe-audit — finding suppression.
 *
 * `applyIgnore` is the body of the spine's `applySuppressions` stage: a
 * PURE synchronous partition of findings into `{ active, suppressed }`. It issues
 * NO network call, NO Stripe call, NO filesystem write, and NEVER mutates its
 * input — the exit-code gate computes over `active` only, and the
 * reporters render the `suppressed` tally already wired into them.
 *
 * Three suppression forms, gitignore-style (one per line; blank and `#` lines
 * skipped):
 *   - by rule id          `WEBHOOK_SELECT_ALL`         — every finding of that rule
 *   - by resource         `:we_123` or `*:we_123`      — every finding on that resource
 *   - by rule + resource  `PRICE_NO_LOOKUP_KEY:price_a`— only that rule on that resource
 *
 * Resource matching keys off `Finding.affectedResourceId` (no Finding-shape
 * change). The `.stripeauditignore` file and the `--ignore <pattern...>` flag feed
 * the SAME `Suppression[]` (`loadIgnoreFile` reads the file; the CLI concatenates
 * the flag patterns). A pattern that matches nothing is reported in `unmatched`
 * so the CLI can surface an info-level warning without changing the exit code.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Finding } from './types'

/** A parsed suppression rule. `null` on a side means "match any". */
export interface Suppression {
  /** The original pattern text, surfaced verbatim in unmatched-pattern warnings. */
  raw: string
  /** Rule id to match, or `null` to match any rule. */
  ruleId: string | null
  /** Resource id to match, or `null` to match any resource. */
  resourceId: string | null
}

/** The partition `applyIgnore` returns. */
export interface IgnoreResult {
  /** Findings that survived (fed to score + exit gate). */
  active: Finding[]
  /** Findings a suppression matched (counted in the reporters' tally; never scored). */
  suppressed: Finding[]
  /** Patterns that matched no finding — the CLI surfaces these as info warnings. */
  unmatched: string[]
}

/** The minimal shape `applyIgnore` reads off a finding (full {@link Finding} satisfies it). */
type SuppressibleFinding = Pick<Finding, 'ruleId' | 'affectedResourceId'>

/**
 * Parse one pattern line into a {@link Suppression}, or `null` for a blank/comment
 * line (gitignore-style). A bare token is a rule id; a leading `:` (or `*:`) is a
 * resource match; `rule:resource` constrains both. `*`/empty on a side means "any".
 */
export function parseSuppression(line: string): Suppression | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  const colon = trimmed.indexOf(':')
  if (colon === -1) {
    return { raw: trimmed, ruleId: trimmed, resourceId: null }
  }
  const rulePart = trimmed.slice(0, colon).trim()
  const resourcePart = trimmed.slice(colon + 1).trim()
  const ruleId = rulePart === '' || rulePart === '*' ? null : rulePart
  const resourceId = resourcePart === '' || resourcePart === '*' ? null : resourcePart
  return { raw: trimmed, ruleId, resourceId }
}

/** True when `sup` matches `finding`. A suppression with no constraint matches nothing. */
function matchesSuppression(sup: Suppression, finding: SuppressibleFinding): boolean {
  if (sup.ruleId === null && sup.resourceId === null) return false
  if (sup.ruleId !== null && sup.ruleId !== finding.ruleId) return false
  if (sup.resourceId !== null && sup.resourceId !== finding.affectedResourceId) return false
  return true
}

/**
 * Partition `findings` into `{ active, suppressed, unmatched }` against the
 * suppression `lines` (raw file/flag patterns). Pure and total: does not mutate
 * `findings` or its elements, issues no I/O, and never throws on a malformed line
 * (it is simply skipped).
 */
export function applyIgnore(findings: readonly Finding[], lines: readonly string[]): IgnoreResult {
  const suppressions = lines
    .map(parseSuppression)
    .filter((s): s is Suppression => s !== null)

  const active: Finding[] = []
  const suppressed: Finding[] = []
  const matched = new Set<string>()

  for (const finding of findings) {
    const hit = suppressions.find((s) => matchesSuppression(s, finding))
    if (hit) {
      suppressed.push(finding)
      matched.add(hit.raw)
    } else {
      active.push(finding)
    }
  }

  const unmatched = suppressions.filter((s) => !matched.has(s.raw)).map((s) => s.raw)
  return { active, suppressed, unmatched }
}

/**
 * Find the declared suppressions that suppressed NOTHING in this run — stale/dead
 * entries a user can safely delete. A suppression is *unused* iff no finding in the
 * `suppressed` set matches it (a suppression can only ever match a suppressed finding —
 * an active finding is, by definition, one no suppression matched). Advisory only:
 * this is a report over {@link applyIgnore}'s existing output, NOT a second partition;
 * it reuses the same {@link parseSuppression} + match logic, so it can never diverge
 * from how suppression actually behaves. Like `applyIgnore`, it is pure and total —
 * no I/O, no mutation, never throws.
 *
 * A suppression that redundantly matches a finding another suppression already caught
 * still counts as USED (it matches a suppressed finding), mirroring the first-match
 * semantics — the report flags only genuinely dead entries.
 */
export function findUnusedSuppressions(
  lines: readonly string[],
  suppressed: readonly SuppressibleFinding[],
): Suppression[] {
  const suppressions = lines
    .map(parseSuppression)
    .filter((s): s is Suppression => s !== null)
  return suppressions.filter(
    (sup) => !suppressed.some((finding) => matchesSuppression(sup, finding)),
  )
}

/**
 * Read `.stripeauditignore` from `cwd`, returning its lines (gitignore-style; the
 * caller passes them to {@link applyIgnore}). Returns `[]` when the file is absent.
 * This is the ONLY filesystem read in the suppression path; the matching itself
 * ({@link applyIgnore}) is pure.
 */
export function loadIgnoreFile(cwd: string): string[] {
  const path = join(cwd, '.stripeauditignore')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split(/\r?\n/)
}
