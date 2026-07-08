/**
 * stripe-audit — the canonical CLI exit-code contract.
 *
 * The CLI is the single owner of the documented 0/1/2/3 contract:
 *
 *   0  audit completed, NO active finding at/above the --fail-on threshold
 *   1  audit completed, one or more active findings at/above the threshold
 *   2  configuration error (no/invalid key, bad --output/--severity/--category/--fail-on)
 *   3  Stripe API / transport error
 *
 * Exit codes 2 and 3 are control-flow outcomes the CLI sets directly (a config
 * error never reaches the engine; a Stripe error is caught on the live
 * path). This module owns the 0↔1 decision: it is computed over the ACTIVE
 * (post-suppression) findings only, gated by `--fail-on`. Suppressed findings
 * and skipped deep rules are excluded from `result.findings`, so they
 * can never trip the gate.
 *
 * `--fail-on high` is the default and reproduces the original 0/1 behaviour
 * exactly (exit 1 on any active critical/high finding), so existing CI does not
 * change on upgrade.
 */
import type { Finding, Severity } from './types'

/** Audit completed with nothing at/above the fail-on threshold. */
export const EXIT_OK = 0
/** Audit completed with one or more active findings at/above the threshold. */
export const EXIT_FINDINGS = 1
/** Configuration error — no/invalid key, or an invalid flag value. */
export const EXIT_CONFIG = 2
/** Stripe API / transport error (the live-audit failure path). */
export const EXIT_RUNTIME = 3

/** The accepted `--fail-on` thresholds. `none` never trips the gate. */
export type FailOnLevel = 'critical' | 'high' | 'medium' | 'low' | 'none'

/** Every accepted `--fail-on` value, for CLI validation + help text. */
export const FAIL_ON_LEVELS: readonly FailOnLevel[] = ['critical', 'high', 'medium', 'low', 'none']

/** Default gate threshold — preserves the original exit-1-on-critical/high contract. */
export const DEFAULT_FAIL_ON: FailOnLevel = 'high'

/** True when `value` is a recognized {@link FailOnLevel}. */
export function isFailOnLevel(value: string): value is FailOnLevel {
  return (FAIL_ON_LEVELS as readonly string[]).includes(value)
}

/** Severity ordering (highest → lowest). `info` is the floor; `--fail-on` never targets it. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
}

/** Threshold rank per fail-on level. `none` sits above every severity, so it never trips. */
const FAIL_ON_RANK: Record<FailOnLevel, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  none: Number.POSITIVE_INFINITY,
}

/**
 * Decide the completed-audit exit code over the ACTIVE findings and the gate level.
 *
 * @returns {@link EXIT_FINDINGS} (1) when any active finding's severity is at or
 *   above the `--fail-on` threshold, else {@link EXIT_OK} (0). `--fail-on none`
 *   always returns {@link EXIT_OK}.
 */
export function exitCodeForFindings(
  active: readonly Finding[],
  failOn: FailOnLevel,
): typeof EXIT_OK | typeof EXIT_FINDINGS {
  const threshold = FAIL_ON_RANK[failOn]
  const trips = active.some((f) => SEVERITY_RANK[f.severity] >= threshold)
  return trips ? EXIT_FINDINGS : EXIT_OK
}
