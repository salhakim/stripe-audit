/**
 * stripe-audit — reporter dispatch.
 *
 * `renderReport` maps an {@link AuditResult} + a chosen `--output` format to a
 * rendered string. All four reporters are pure `(AuditResult) -> string`; this
 * module is the single switch the CLI calls so adding a format is one case here
 * plus one reporter module.
 *
 * The reporters: JSON (here), Markdown, self-contained HTML, and the
 * basic severity-grouped console. Formats not yet implemented throw a clear
 * error rather than emitting a wrong shape.
 */
import type { AuditResult } from './result'
import { renderJson } from './json'
import { renderMarkdown } from './markdown'
import { renderHtml } from './html'
import { renderConsole } from './console'
import { renderBadge } from './badge'

/** The `--output` formats the CLI accepts (`badge` = SVG health badge). */
export type OutputFormat = 'json' | 'markdown' | 'html' | 'console' | 'badge'

/** Every accepted `--output` value, for CLI validation + help text. */
export const OUTPUT_FORMATS: readonly OutputFormat[] = [
  'json',
  'markdown',
  'html',
  'console',
  'badge',
]

/** True when `value` is a recognized {@link OutputFormat}. */
export function isOutputFormat(value: string): value is OutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value)
}

/** Render an {@link AuditResult} in the requested `format`. */
export function renderReport(result: AuditResult, format: OutputFormat): string {
  switch (format) {
    case 'json':
      return renderJson(result)
    case 'markdown':
      return renderMarkdown(result)
    case 'html':
      return renderHtml(result)
    case 'console':
      return renderConsole(result)
    case 'badge':
      return renderBadge(result)
    default: {
      // Exhaustiveness guard — a new OutputFormat must add a case above.
      const exhaustive: never = format
      throw new Error(`unknown output format: ${String(exhaustive)}`)
    }
  }
}

export { renderJson } from './json'
export { renderMarkdown } from './markdown'
export { renderHtml } from './html'
export { renderConsole } from './console'
export {
  renderBadge,
  badgeColorOf,
  worstSeverityOf,
  BADGE_SEVERITY_COLOR,
  BADGE_CLEAN_COLOR,
} from './badge'
export { stripAnsi, isColorTty, stripControl } from './tty'
export { buildAuditResult, describeFilter } from './result'
export type {
  AuditResult,
  AuditSummary,
  BaselineDelta,
  BuildAuditResultOptions,
} from './result'
