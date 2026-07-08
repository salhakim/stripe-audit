/**
 * Reporter output-safety contract.
 *
 * Finding fields carry account-controlled strings today — `ep.url` (webhook
 * endpoint URL) and `product.name` flow into `finding.title` / `description`
 * across the catalog. This locks the rule that every reporter neutralizes hostile
 * metacharacters in that text: Markdown must not let a value forge a heading /
 * table / link or inject inline HTML into a PR comment; console must not let a
 * value emit terminal escape sequences; HTML escapes everything; JSON keeps it as
 * inert, structurally-encoded data. One hostile result, all four reporters.
 */
import { describe, it, expect } from 'vitest'
import {
  renderJson,
  renderMarkdown,
  renderHtml,
  renderConsole,
  stripAnsi,
} from '../../src/report'
import type { AuditResult } from '../../src/report'
import type { Finding } from '../../src/types'

/** The ESC control byte (U+001B) — the start of every terminal escape sequence. */
const ESC = '\x1b'

/** A finding whose account-derived fields carry every relevant injection vector. */
const HOSTILE_FINDING: Finding = {
  ruleId: 'PRICE_NO_LOOKUP_KEY',
  severity: 'high',
  category: 'pricing',
  // Embedded newline + a forged heading (block-injection vector).
  title: `Product "Pro\n## Grade A — all clear\n" has no lookup_key`,
  affectedResourceId: 'prod_x',
  affectedResourceType: 'product',
  // Inline HTML + a table-breaking pipe (a hostile webhook URL shape).
  description: `Webhook https://evil|table.test/h <img src=x onerror=alert(1)> is misconfigured`,
  // A terminal escape sequence (clear screen + recolor).
  remediation: `Set a lookup_key ${ESC}[2J${ESC}[31m(gotcha)`,
  // A non-http(s) scheme that must never become an active link.
  docsUrl: 'javascript:alert(document.domain)//',
  estimatedImpact: '~$9|99/mo',
}

/** A minimal AuditResult wrapping the single hostile finding (reporters only read fields). */
function hostileResult(): AuditResult {
  return {
    version: '0.1.0',
    stripeApiVersion: '2026-06-24.dahlia',
    accountMode: 'live',
    auditDate: '2026-06-24T00:00:00.000Z',
    summary: {
      critical: 0,
      high: 1,
      medium: 0,
      low: 0,
      info: 0,
      total: 1,
      rulesRun: 1,
      rulesPassed: 0,
      score: 90,
      grade: 'A',
      suppressed: 0,
    },
    findings: [HOSTILE_FINDING],
    skipped: [],
    truncated: [],
  }
}

describe('reporters neutralize hostile account-controlled finding text', () => {
  it('markdown: no forged heading, inline HTML neutralized, pipe escaped, hostile docsUrl not linked', () => {
    const md = renderMarkdown(hostileResult())
    // The embedded "## Grade A — all clear" must NOT become a real heading line.
    expect(md).not.toMatch(/^## Grade A — all clear$/m)
    // Inline HTML is neutralized (entity-encoded, not raw).
    expect(md).not.toContain('<img src=x onerror=')
    expect(md).toContain('&lt;img src=x onerror=')
    // The table-breaking pipe in a value is escaped.
    expect(md).toContain('evil\\|table.test')
    // A non-http(s) docsUrl renders as inert text, never an active link.
    expect(md).not.toContain('](javascript:')
  })

  it('console: terminal escape sequences are stripped from finding text', () => {
    // stripAnsi removes the reporter's OWN chalk SGR codes; any ESC that survives
    // is a hostile sequence stripControl failed to remove.
    const plain = stripAnsi(renderConsole(hostileResult()))
    expect(plain).not.toContain(ESC)
    // The visible remediation text remains, sans the escape payload.
    expect(plain).toContain('(gotcha)')
  })

  it('html: every hostile field is escaped and no static javascript: href is emitted', () => {
    const html = renderHtml(hostileResult())
    expect(html).not.toContain('<img src=x onerror=')
    expect(html).toContain('&lt;img')
    expect(html).not.toMatch(/href="javascript:/i)
  })

  it('json: hostile text is inert data — parses, control char structurally encoded', () => {
    const json = renderJson(hostileResult())
    const parsed = JSON.parse(json) as AuditResult
    // The text round-trips faithfully (data, not markup)…
    expect(parsed.findings[0].title).toContain('## Grade A')
    // …and the raw ESC byte is never emitted — JSON.stringify encodes it as \x1b.
    expect(json).not.toContain(ESC)
    expect(json).toContain('\\u001b')
  })
})
