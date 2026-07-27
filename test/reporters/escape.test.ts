/**
 * Canonical escaper contract — the regression net for CodeQL
 * `js/incomplete-sanitization`.
 *
 * These tests pin the two failure modes that class of bug takes:
 *   1. A lost global flag → only the FIRST occurrence is escaped. Every case
 *      below feeds REPEATED metacharacters so a non-global `.replace` regresses
 *      loudly (the existing reporter tests use single occurrences and would not).
 *   2. Escaping with `\` as the escape char WITHOUT first escaping `\` itself →
 *      a literal backslash in the input consumes the escaping and the delimiter
 *      breaks back out. `escapeMd`'s pipe handling is verified breakout-proof.
 */
import { describe, it, expect } from 'vitest'
import { escapeHtml, escapeAttr, escapeXml, escapeMd } from '../../src/report'

describe('escapeHtml / escapeXml — HTML/XML five-character set', () => {
  it('escapes EVERY occurrence (a lost /g would fail these)', () => {
    expect(escapeHtml('& & &')).toBe('&amp; &amp; &amp;')
    expect(escapeHtml('<<<')).toBe('&lt;&lt;&lt;')
    expect(escapeHtml('>>>')).toBe('&gt;&gt;&gt;')
    expect(escapeHtml('"a" "b"')).toBe('&quot;a&quot; &quot;b&quot;')
    expect(escapeHtml("'x' 'y'")).toBe('&#39;x&#39; &#39;y&#39;')
  })

  it('orders & first so entities are not double-escaped', () => {
    // A naive order (`<` before `&`) would turn `<` into `&lt;` then re-escape
    // that `&` → `&amp;lt;`. Correct output leaves each entity intact.
    expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;')
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d')
  })

  it('escapeXml and escapeAttr are the same escaper as escapeHtml', () => {
    const hostile = `Tom & "Jerry" <b> 'z'`
    expect(escapeXml(hostile)).toBe(escapeHtml(hostile))
    expect(escapeAttr(hostile)).toBe(escapeHtml(hostile))
  })
})

describe('escapeMd — Markdown body text', () => {
  it('escapes the backslash BEFORE the pipe so the delimiter cannot break out', () => {
    // The CodeQL defect: `\|` in → without escaping the `\` first, GFM renders
    // the doubled backslash as one literal `\` and the pipe survives bare.
    expect(escapeMd(String.raw`\|`)).toBe(String.raw`\\\|`)
    // Property form, robust to the exact backslash count: remove every escaped
    // backslash (`\\`) then every escaped pipe (`\|`); a residual `|` is a
    // cell-breaking breakout.
    for (const input of [String.raw`\|`, String.raw`a\|b`, String.raw`\\|`, '|||', 'x|y|z']) {
      const out = escapeMd(input)
      const residual = out.replace(/\\\\/g, '').replace(/\\\|/g, '')
      expect(residual).not.toContain('|')
    }
  })

  it('escapes every pipe occurrence, not just the first', () => {
    expect(escapeMd('a|b|c')).toBe(String.raw`a\|b\|c`)
  })

  it('escapes & first so a pre-encoded entity cannot decode past the <,> encoding', () => {
    // Input already looks like `&lt;`; leaving `&` raw would let a renderer
    // decode it back to `<`. With `&` escaped, it stays inert literal text.
    expect(escapeMd('&lt;img&gt;')).toBe('&amp;lt;img&amp;gt;')
    expect(escapeMd('a & b')).toBe('a &amp; b')
  })

  it('neutralizes raw angle brackets (every occurrence)', () => {
    expect(escapeMd('<img><img>')).toBe('&lt;img&gt;&lt;img&gt;')
  })

  it('collapses newlines so an embedded heading can never start a line', () => {
    const out = escapeMd('Pro\n## Grade A\r\ncleared')
    expect(out).toBe('Pro ## Grade A cleared')
    expect(out).not.toMatch(/^## /m)
  })

  it('leaves cosmetic markup (* _ backtick) so rule-authored text renders clean', () => {
    expect(escapeMd('`invoice.payment_failed`')).toBe('`invoice.payment_failed`')
    expect(escapeMd('*bold* _em_')).toBe('*bold* _em_')
  })
})
