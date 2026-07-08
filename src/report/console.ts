/**
 * stripe-audit — terminal dashboard console reporter (the default).
 *
 * A pure `(AuditResult) -> string` for the terminal. v0.2 upgrades the original
 * basic severity-grouped list into a dashboard:
 *   1. a score/grade GAUGE line,
 *   2. per-severity BARS proportional to the finding counts,
 *   3. a category HEAT-STRIP across the configured categories,
 * followed by the (retained) per-finding detail list and the always-printed
 * no-false-assurance lines — Coverage, Skipped, Suppressed.
 *
 * Colorized via chalk v4 (the last CJS-compatible major).
 * chalk auto-disables color when stdout is not a TTY, so piped output stays
 * readable. Every gauge/bar/label carries a contiguous plain-text count so the
 * dashboard survives {@link stripAnsi} for a piped consumer (and snapshots).
 * The block glyphs (█ / ░) are not ANSI, so they persist through the strip.
 *
 * Pure: no key material, no network — the output carries no Stripe key. Account-
 * derived finding text is run through {@link stripControl} before printing so a
 * hostile product name / webhook URL cannot manipulate the terminal.
 */
import chalk from 'chalk'
import { stripControl } from './tty'
import { describeFilter } from './result'
import type { AuditResult, AuditSummary } from './result'
import type { Grade } from '../score'
import type { Category, Severity } from '../types'

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

/**
 * Category display order for the heat-strip — the same canonical set the CLI's
 * `--category` filter validates against (mirrors `CATEGORIES` in `cli.ts`; the
 * project keeps per-module ordered constants, as with {@link SEVERITY_ORDER}).
 */
const CATEGORY_ORDER: readonly Category[] = [
  'webhooks',
  'billing',
  'security',
  'configuration',
  'payments',
  'pricing',
]

/** Per-severity heading + bar paint. */
const SEVERITY_PAINT: Record<Severity, (text: string) => string> = {
  critical: (t) => chalk.red.bold(t),
  high: (t) => chalk.red(t),
  medium: (t) => chalk.yellow(t),
  low: (t) => chalk.blue(t),
  info: (t) => chalk.gray(t),
}

/** Grade paint — green (healthy) → red (failing). */
const GRADE_PAINT: Record<Grade, (text: string) => string> = {
  A: (t) => chalk.green.bold(t),
  B: (t) => chalk.green(t),
  C: (t) => chalk.yellow(t),
  D: (t) => chalk.yellow(t),
  F: (t) => chalk.red.bold(t),
}

const GAUGE_WIDTH = 24
const BAR_WIDTH = 24
const FILLED = '█'
const EMPTY = '░'

/**
 * A proportional bar of {@link FILLED} glyphs for `count` relative to `max`,
 * capped at `width`. A non-zero count always renders at least one cell so a
 * small-but-present band is never invisible; a zero count renders nothing.
 */
function bar(count: number, max: number, width: number): string {
  if (count <= 0 || max <= 0) return ''
  const cells = Math.max(1, Math.round((count / max) * width))
  return FILLED.repeat(Math.min(cells, width))
}

/** A `[████░░░░]` gauge for a 0–100 score: filled proportional to the score. */
function gauge(score: number): string {
  const filled = Math.max(0, Math.min(GAUGE_WIDTH, Math.round((score / 100) * GAUGE_WIDTH)))
  return FILLED.repeat(filled) + EMPTY.repeat(GAUGE_WIDTH - filled)
}

/** Heat paint for a category cell, keyed to its share of the hottest category. */
function heatPaint(ratio: number): (text: string) => string {
  if (ratio <= 0) return (t) => chalk.dim(t)
  if (ratio < 0.34) return (t) => chalk.blue(t)
  if (ratio < 0.67) return (t) => chalk.yellow(t)
  return (t) => chalk.red(t)
}

/** Right-pad `text` to `width` columns (plain text only — apply color after). */
function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

/** The score/grade gauge line; a filtered run's grade is annotated `(filtered)`. */
function renderGauge(summary: AuditSummary, filtered: boolean): string {
  const painted = GRADE_PAINT[summary.grade]
  const suffix = filtered ? ' (filtered)' : ''
  return `Score  ${painted(`[${gauge(summary.score)}]`)} ${summary.score}/100 — Grade ${painted(
    summary.grade,
  )}${suffix}`
}

/** The per-severity bar block (counts from the authoritative summary tally). */
function renderSeverityBars(summary: AuditSummary): string[] {
  const counts: Record<Severity, number> = {
    critical: summary.critical,
    high: summary.high,
    medium: summary.medium,
    low: summary.low,
    info: summary.info,
  }
  const max = Math.max(0, ...SEVERITY_ORDER.map((s) => counts[s]))
  const labelWidth = Math.max(...SEVERITY_ORDER.map((s) => SEVERITY_LABEL[s].length))
  const lines = ['Findings by severity']
  for (const severity of SEVERITY_ORDER) {
    const glyphs = bar(counts[severity], max, BAR_WIDTH)
    lines.push(`  ${pad(SEVERITY_LABEL[severity], labelWidth)}  ${SEVERITY_PAINT[severity](glyphs)} ${counts[severity]}`)
  }
  return lines
}

/** The category heat-strip block (counts derived from the active findings). */
function renderCategoryHeatStrip(result: AuditResult): string[] {
  const counts: Record<Category, number> = {
    webhooks: 0,
    billing: 0,
    security: 0,
    configuration: 0,
    payments: 0,
    pricing: 0,
  }
  for (const finding of result.findings) counts[finding.category]++
  const max = Math.max(0, ...CATEGORY_ORDER.map((c) => counts[c]))
  const labelWidth = Math.max(...CATEGORY_ORDER.map((c) => c.length))
  const lines = ['Findings by category']
  for (const category of CATEGORY_ORDER) {
    const count = counts[category]
    const paint = heatPaint(max > 0 ? count / max : 0)
    const glyphs = bar(count, max, BAR_WIDTH)
    lines.push(`  ${pad(category, labelWidth)}  ${paint(glyphs)} ${count}`)
  }
  return lines
}

/** Render an {@link AuditResult} as a terminal dashboard report. */
export function renderConsole(result: AuditResult): string {
  const { summary } = result
  const lines: string[] = []

  // Header — the pinned API version is plain contiguous text (survives ANSI strip).
  lines.push(chalk.bold('stripe-audit'))
  lines.push(
    chalk.dim(
      `Stripe API ${result.stripeApiVersion} · account ${result.accountMode} · ${result.auditDate}`,
    ),
  )
  lines.push('')

  // 1. Score/grade gauge.
  lines.push(renderGauge(summary, Boolean(result.filter)))

  // Baseline gate verdict — a one-liner so a non-JSON CI user sees the gate
  // result without parsing the JSON block. Rendered only when a baseline was supplied.
  if (result.baseline) {
    const b = result.baseline
    const delta = `${b.scoreDelta >= 0 ? '+' : ''}${b.scoreDelta}`
    const verdict = b.regression ? chalk.red('REGRESSION') : chalk.green('no regression')
    lines.push(
      `Baseline: ${verdict} — +${b.newFindings.length} new / -${b.resolvedFindings.length} resolved / Δscore ${delta}`,
    )
  }

  // Coverage — sits with the score (not at the bottom) because it qualifies the
  // grade. A filtered run must never read "Coverage: full": the FILTERED
  // line replaces it. A non-empty truncated[] is a PARTIAL audit and still gets its
  // own warning — filtered + partial shows BOTH lines.
  if (result.filter) {
    lines.push(
      chalk.yellow(
        `Coverage: FILTERED (${describeFilter(result.filter)}) — higher-severity rules were not run.`,
      ),
    )
  }
  if (result.truncated.length > 0) {
    lines.push(
      chalk.yellow(
        `⚠ Partial audit — truncated regions: ${result.truncated.join(', ')} ` +
          '(findings there may be incomplete).',
      ),
    )
  } else if (!result.filter) {
    lines.push(chalk.dim('Coverage: full — every region scanned within limits.'))
  }
  lines.push('')

  // 2. Per-severity bars.
  lines.push(...renderSeverityBars(summary))
  lines.push('')

  // 3. Category heat-strip.
  lines.push(...renderCategoryHeatStrip(result))
  lines.push('')

  // Retained detail — active findings grouped by severity band. The dashboard
  // summarizes; this is the actionable detail (title + remediation) a user fixes.
  if (result.findings.length === 0) {
    lines.push(chalk.green('No active findings — your billing configuration looks healthy.'))
  } else {
    for (const severity of SEVERITY_ORDER) {
      const inBand = result.findings.filter((f) => f.severity === severity)
      if (inBand.length === 0) continue
      lines.push(SEVERITY_PAINT[severity](`${SEVERITY_LABEL[severity]} (${inBand.length})`))
      for (const finding of inBand) {
        // Strip terminal control sequences from account-derived finding text so a
        // hostile product name / webhook URL can't manipulate the terminal.
        lines.push(`  • ${stripControl(finding.title)}`)
        lines.push(chalk.dim(`    ${stripControl(finding.remediation)}`))
      }
      lines.push('')
    }
  }

  // Skipped line — a not-run deep rule is never read as passed.
  const skippedLine =
    result.skipped.length === 0
      ? 'Skipped rules: none (every applicable rule ran)'
      : `Skipped rules: ${result.skipped.map((s) => `${s.ruleId} (${s.reason})`).join(', ')}`
  lines.push(chalk.dim(skippedLine))

  // Suppressed (N) line — always printed, never hidden.
  lines.push(chalk.dim(`Suppressed (${summary.suppressed})`))

  return lines.join('\n')
}
