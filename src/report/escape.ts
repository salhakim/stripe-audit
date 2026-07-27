/**
 * stripe-audit — canonical reporter output-encoding helpers.
 *
 * ONE home for the character-escaping every reporter shares, so the escape
 * tables can't silently diverge between the HTML, SVG, and Markdown reporters —
 * a divergent or incomplete copy is exactly how an escaping bug slips back in.
 * `html.ts`, `badge.ts`, and `markdown.ts` all import from here. The only other
 * copy is the standalone build-time `scripts/render-demo-svg.mjs` (a `.mjs` that
 * cannot import this TS module — see the note there), which escapes the tool's
 * own trusted `--demo` output into SVG text content.
 *
 * Every replace is global (`/g`) and the stages are ordered so none can undo an
 * earlier one (see the inline notes). All escapers are pure `(string) -> string`
 * with no key material and no network.
 */

/** Escape text for safe interpolation into HTML element content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;') // & FIRST — keeps every entity emitted below literal
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Escape a value for safe interpolation into a double-quoted HTML attribute.
 * Identical to {@link escapeHtml} — the five-character set neutralizes both the
 * element-content and the double-quoted-attribute context — kept as a named
 * alias so attribute call sites read intently.
 */
export const escapeAttr = escapeHtml

/**
 * Escape text for safe interpolation into SVG/XML element content or attributes.
 * XML shares HTML's five-character escape set (`&`, `<`, `>`, `"`, `'`), so this
 * is {@link escapeHtml} under an XML-intent name.
 */
export const escapeXml = escapeHtml

/**
 * Escape an UNTRUSTED value for safe interpolation into Markdown body text.
 *
 * Finding fields carry account-controlled strings (`ep.url`, `product.name`)
 * that flow into a PR comment / `$GITHUB_STEP_SUMMARY`. Left raw, an embedded
 * newline + `## …` can inject a forged heading, a `|` can break a table cell,
 * and inline HTML can reach a non-sanitizing Markdown renderer. It is surgical:
 * it collapses newlines (the main block-injection vector — once a value can't
 * introduce a line, an embedded `#`/`>`/`-` is inert mid-line), entity-encodes
 * `&`/`<`/`>`, and backslash-escapes the `|` table delimiter. The escape
 * character (`\`) is itself escaped FIRST, so a literal backslash in the input
 * can't consume the `\|` escaping and break the pipe back out
 * (CodeQL js/incomplete-sanitization). Cosmetic markup (`*` `_` backtick) is
 * deliberately LEFT so legitimate rule-authored text (e.g.
 * `` `invoice.payment_failed` ``) still renders clean; account-derived fields
 * are the threat surface, and the rule id is rule-authored + naming-guarded so
 * it never carries a backtick.
 */
export function escapeMd(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, ' ') // collapse newlines (the block-injection vector)
    .replace(/&/g, '&amp;') // & FIRST so a pre-encoded `&lt;` can't decode past the <,> encoding below
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\') // escape the escape char BEFORE it is used to escape `|` below
    .replace(/\|/g, '\\|') // neutralize the table-cell delimiter
}
