/**
 * stripe-audit — Markdown reporter.
 *
 * A pure `(AuditResult) -> string` that renders GitHub-flavored Markdown for a PR
 * comment or `$GITHUB_STEP_SUMMARY`: a score/grade header, a pipe-delimited
 * severity table, one section per ACTIVE finding (leading with the human/$
 * consequence, never the bare rule id) with its Stripe docs link, an
 * always-rendered "Skipped rules" section (so a not-run deep rule is never read
 * as passed), and an always-rendered "Suppressed (N)" footnote. The optional
 * baseline delta renders only when present.
 *
 * Pure: no key material, no network. The result carries no Stripe key, so the
 * output can never leak one.
 */
import { describeFilter } from './result'
import { escapeMd } from './escape'
import type { AuditResult, BaselineDelta } from './result'
import type { Finding, Severity } from '../types'

/** Severity render order, worst → mildest. */
const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

/** Human label per severity (Title-cased for headings). */
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

/** A small colored glyph per severity for scannability. */
const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🔵',
  info: '⚪',
}

/**
 * A docs URL safe to place inside a Markdown link target `(...)`, or null when
 * it must not be linked. Mirrors the HTML reporter's scheme guard: only http(s)
 * URLs are linked; anything else (`javascript:`, `data:`, a relative string from
 * a future plugin rule) returns null so the caller renders plain text instead of
 * an active link. The `()`, angle-bracket and space characters that could break
 * out of the link target are percent-encoded.
 */
function mdUrl(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null
  return url.replace(/[()<> ]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Group active findings by severity, preserving input order within a band. */
function bySeverity(findings: readonly Finding[]): Record<Severity, Finding[]> {
  const groups: Record<Severity, Finding[]> = {
    critical: [],
    high: [],
    medium: [],
    low: [],
    info: [],
  }
  for (const finding of findings) groups[finding.severity].push(finding)
  return groups
}

/** The score/grade header + run-meta line. */
function renderHeader(result: AuditResult): string[] {
  const { summary } = result
  return [
    '# Stripe Audit Report',
    '',
    `**Score: ${summary.score} / 100 — Grade ${summary.grade}${result.filter ? ' (filtered)' : ''}**`,
    '',
    `Stripe API \`${result.stripeApiVersion}\` · account \`${result.accountMode}\` · ${result.auditDate}`,
    '',
  ]
}

/** The pipe-delimited severity summary table (header + separator + rows). */
function renderSummaryTable(result: AuditResult): string[] {
  const s = result.summary
  return [
    '## Summary',
    '',
    '| Severity | Count |',
    '| --- | --- |',
    `| ${SEVERITY_EMOJI.critical} Critical | ${s.critical} |`,
    `| ${SEVERITY_EMOJI.high} High | ${s.high} |`,
    `| ${SEVERITY_EMOJI.medium} Medium | ${s.medium} |`,
    `| ${SEVERITY_EMOJI.low} Low | ${s.low} |`,
    `| ${SEVERITY_EMOJI.info} Info | ${s.info} |`,
    `| **Total** | **${s.total}** |`,
    '',
    `_Rules run: ${s.rulesRun} · passed: ${s.rulesPassed} · suppressed: ${s.suppressed}_`,
    '',
  ]
}

/**
 * The always-rendered coverage line(s). A filtered run must never read "Full
 * audit": the FILTERED callout replaces it. A non-empty `truncated`
 * means a list region overflowed the fetch cap, so the audit saw only the first
 * `MAX_LIST_ITEMS` — a PARTIAL audit; it still renders its own warning, so a
 * filtered + truncated run shows BOTH. Rendered right under the summary (not at
 * the bottom with Skipped/Suppressed) because it qualifies the score/grade:
 * never present a complete-looking grade over a partially-read (or partially-
 * run) account. Region names are known `RuleScope` identifiers and filter
 * values are validated enum tokens (not account input), so no escaping needed.
 */
function renderCoverage(result: AuditResult): string[] {
  const lines: string[] = []
  if (result.filter) {
    lines.push(
      `> ⚠️ **Coverage: FILTERED** (${describeFilter(result.filter)}) — higher-severity rules were not run.`,
      '',
    )
  }
  if (result.truncated.length === 0) {
    if (!result.filter) lines.push('_Full audit — every region scanned within limits._', '')
    return lines
  }
  const regions = result.truncated.map((r) => `\`${r}\``).join(', ')
  lines.push(
    `> ⚠️ **Partial audit** — ${result.truncated.length} region(s) exceeded the fetch cap and were truncated: ${regions}. Findings in those regions may be incomplete; the score reflects only the data that was read.`,
    '',
  )
  return lines
}

/** One section per active finding, leading with the consequence (title), grouped by severity. */
function renderFindings(result: AuditResult): string[] {
  const lines: string[] = ['## Findings', '']
  if (result.findings.length === 0) {
    lines.push('No active findings — your billing configuration looks healthy. 🎉', '')
    return lines
  }
  const groups = bySeverity(result.findings)
  for (const severity of SEVERITY_ORDER) {
    const findings = groups[severity]
    if (findings.length === 0) continue
    lines.push(`### ${SEVERITY_EMOJI[severity]} ${SEVERITY_LABEL[severity]} (${findings.length})`, '')
    for (const finding of findings) {
      // Lead with the human/$ consequence (the title), not the bare rule id.
      // Every account-derived field is escaped at this reporter boundary.
      lines.push(`#### ${escapeMd(finding.title)}`)
      lines.push('')
      lines.push(escapeMd(finding.description))
      if (finding.estimatedImpact) lines.push('', `_Impact: ${escapeMd(finding.estimatedImpact)}_`)
      lines.push('', `**Fix:** ${escapeMd(finding.remediation)}`)
      // Scheme-guard the docs link: a non-http(s) docsUrl renders as inert text.
      const docs = mdUrl(finding.docsUrl)
      const docsPart = docs
        ? `[Stripe docs](${docs})`
        : `Stripe docs: ${escapeMd(finding.docsUrl)}`
      lines.push('', `${docsPart} · rule \`${escapeMd(finding.ruleId)}\``)
      lines.push('')
    }
  }
  return lines
}

/** The always-rendered "Skipped rules" section (skipped ≠ passed). */
function renderSkipped(result: AuditResult): string[] {
  const lines: string[] = ['## Skipped rules', '']
  if (result.skipped.length === 0) {
    lines.push('_None — every applicable rule ran. (A skipped rule is never counted as passed.)_', '')
    return lines
  }
  for (const entry of result.skipped) {
    lines.push(`- \`${entry.ruleId}\` — ${entry.reason}`)
  }
  lines.push('')
  return lines
}

/** The always-rendered "Suppressed (N)" footnote — never hidden, even at N=0. */
function renderSuppressed(result: AuditResult): string[] {
  const n = result.summary.suppressed
  const note =
    n === 0
      ? '_No findings were suppressed._'
      : `_${n} finding(s) were suppressed and excluded from the score._`
  return [`## Suppressed (${n})`, '', note, '']
}

/**
 * The optional baseline delta block; rendered only when present. Leads with a
 * one-line gate verdict so a non-JSON CI user sees the regression result at a
 * glance, then the counts.
 */
function renderBaseline(baseline: BaselineDelta): string[] {
  const delta = `${baseline.scoreDelta >= 0 ? '+' : ''}${baseline.scoreDelta}`
  const verdict = baseline.regression ? '🔴 REGRESSION' : '🟢 no regression'
  return [
    '## Baseline',
    '',
    `**${verdict}** — +${baseline.newFindings.length} new / -${baseline.resolvedFindings.length} resolved / Δscore ${delta}`,
    '',
    `- New findings: ${baseline.newFindings.length}`,
    `- Resolved findings: ${baseline.resolvedFindings.length}`,
    `- Score delta: ${delta}`,
    `- Regression: ${baseline.regression ? 'yes' : 'no'}`,
    '',
  ]
}

/** Render an {@link AuditResult} as GitHub-flavored Markdown. */
export function renderMarkdown(result: AuditResult): string {
  const lines: string[] = [
    ...renderHeader(result),
    ...renderSummaryTable(result),
    ...renderCoverage(result),
    ...(result.baseline ? renderBaseline(result.baseline) : []),
    ...renderFindings(result),
    ...renderSkipped(result),
    ...renderSuppressed(result),
  ]
  return lines.join('\n')
}
