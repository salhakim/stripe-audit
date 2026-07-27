/**
 * stripe-audit — SVG health-score badge reporter.
 *
 * A pure `(AuditResult) -> string` that emits ONE self-contained shields.io-style
 * SVG badge for a README / CI status line. The left box reads `Stripe Health`; the
 * right box reads `<grade> (<score>)` and is filled by the WORST severity present.
 *
 * Self-contained by construction (mirroring `scripts/render-demo-svg.mjs`): no
 * external `http(s)` reference, no `<image>`/`<use href>`, `role="img"` + a full
 * `aria-label` for assistive tech, and every interpolated text node is
 * XML-escaped (defense-in-depth — grade ∈ A–F and score ∈ 0–100 are already
 * safe, but the escape keeps the render robust if the source ever widens).
 *
 * Pure: it renders `AuditResult.summary` only — a severity tally + score/grade —
 * and never touches key material, so the output can never leak a Stripe key.
 */
import { escapeXml } from './escape'
import type { AuditResult, AuditSummary } from './result'
import type { Severity } from '../types'

/** Worst-severity-first order — the first non-zero band wins the badge color. */
const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']

/**
 * Badge fill color keyed to the worst severity present, exported as a single
 * `Record<Severity, string>` so the mapping is reusable and directly unit-testable.
 * shields.io's flat palette: red → orange → yellow → green as severity eases.
 * `low`/`info` are minor, so they read green — the same "healthy" signal as clean.
 */
export const BADGE_SEVERITY_COLOR: Record<Severity, string> = {
  critical: '#e05d44', // red
  high: '#fe7d37', // orange
  medium: '#dfb317', // yellow
  low: '#4c1', // green
  info: '#4c1', // green
}

/** Fill when there are zero active findings (nothing to color by). */
export const BADGE_CLEAN_COLOR = '#4c1' // brightgreen

/**
 * The worst severity present in a summary tally, or null when the account is
 * clean. Derived from the `summary` counts (not `scoreFindings`) because the
 * reporter seam only carries the {@link AuditSummary}, which holds per-severity
 * counts but not the pre-computed `worstSeverity`.
 */
export function worstSeverityOf(summary: AuditSummary): Severity | null {
  for (const severity of SEVERITY_ORDER) {
    if (summary[severity] > 0) return severity
  }
  return null
}

/** The right-box fill for a summary: worst-severity color, or clean-green. */
export function badgeColorOf(summary: AuditSummary): string {
  const worst = worstSeverityOf(summary)
  return worst ? BADGE_SEVERITY_COLOR[worst] : BADGE_CLEAN_COLOR
}

// Flat-badge geometry (shields.io "flat" style): 20px tall, 11px Verdana-ish text.
// Widths are estimated from character count — an over-estimate just adds padding,
// which is harmless for a status badge.
const HEIGHT = 20
const CHAR_WIDTH = 7 // px per character at 11px font (generous)
const SIDE_PAD = 6 // px of padding on each side of a box's text

/** Box pixel width for a piece of text: text run + symmetric padding. */
function boxWidth(text: string): number {
  return text.length * CHAR_WIDTH + SIDE_PAD * 2
}

/**
 * Render an {@link AuditResult} as a self-contained SVG health badge.
 *
 * Left box `Stripe Health` (neutral gray), right box `<grade> (<score>)` filled by
 * the worst severity present. The full `aria-label` reads
 * `Stripe Health: <grade> (<score>)` so screen readers announce the whole badge.
 */
export function renderBadge(result: AuditResult): string {
  const { summary } = result
  const labelText = 'Stripe Health'
  // A filtered run's badge is annotated so a README badge can never
  // present a filtered grade as the full-audit grade — the same false-assurance
  // hole the other reporters close with their FILTERED coverage line.
  const valueText = `${summary.grade} (${summary.score})${result.filter ? ' (filtered)' : ''}`
  const ariaLabel = `Stripe Health: ${valueText}`

  const labelW = boxWidth(labelText)
  const valueW = boxWidth(valueText)
  const totalW = labelW + valueW

  const color = badgeColorOf(summary)
  const labelMid = labelW / 2
  const valueMid = labelW + valueW / 2
  const textY = 14 // baseline for 11px text in a 20px box

  const el = {
    label: escapeXml(labelText),
    value: escapeXml(valueText),
    aria: escapeXml(ariaLabel),
    fill: escapeXml(color),
  }

  // Two-box flat badge: a rounded clip, a gray label box, a colored value box, and
  // a subtle drop-shadow behind each text run (shields.io's readability trick).
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${HEIGHT}" viewBox="0 0 ${totalW} ${HEIGHT}" role="img" aria-label="${el.aria}">
  <title>${el.aria}</title>
  <clipPath id="r"><rect width="${totalW}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${HEIGHT}" fill="#555"/>
    <rect x="${labelW}" width="${valueW}" height="${HEIGHT}" fill="${el.fill}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana, Geneva, DejaVu Sans, sans-serif" font-size="11">
    <text x="${labelMid}" y="${textY + 1}" fill="#010101" fill-opacity=".3">${el.label}</text>
    <text x="${labelMid}" y="${textY}">${el.label}</text>
    <text x="${valueMid}" y="${textY + 1}" fill="#010101" fill-opacity=".3">${el.value}</text>
    <text x="${valueMid}" y="${textY}">${el.value}</text>
  </g>
</svg>`
}
