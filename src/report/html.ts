/**
 * stripe-audit — self-contained HTML reporter (the PRIMARY visual).
 *
 * A pure `(AuditResult) -> string` that emits ONE shareable `.html` file with
 * inline `<style>` and inline `<script>` and ZERO external `http(s)` resource
 * references — no `<link href>`, no `<script src>`, no `<img src>`, and crucially
 * no static `<a href="https://…">`.
 *
 * First-principles design (the self-contained ⊕ clickable-docs tension): a docs
 * link is rendered as `<a class="docs-link" data-docs="https://…">` with NO href
 * attribute. The inline JS copies `data-docs` onto `href` at load time, so the
 * static file carries no `href="https://…"` (the self-contained grep stays empty)
 * yet every link is clickable once opened. Each finding also carries
 * `data-severity` / `data-category` so the inline JS can client-side filter
 * without a network call.
 *
 * The Skipped section and the "Suppressed (N)" badge are rendered STATICALLY as
 * contiguous text (the count is never split into a child tag) so they survive a
 * pre-JS scan. Pure: no key material, no network — the output carries no key.
 */
import { describeFilter } from './result'
import { escapeHtml, escapeAttr } from './escape'
import type { AuditResult, BaselineDelta } from './result'
import type { Category, Finding, Severity } from '../types'

const SEVERITY_ORDER: readonly Severity[] = ['critical', 'high', 'medium', 'low', 'info']
const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

/** Distinct finding categories present, in first-seen order. */
function distinctCategories(findings: readonly Finding[]): Category[] {
  const seen: Category[] = []
  for (const finding of findings) {
    if (!seen.includes(finding.category)) seen.push(finding.category)
  }
  return seen
}

/** One finding card — data attributes drive filtering; the docs link has no static href. */
function renderFindingCard(finding: Finding): string {
  const impact = finding.estimatedImpact
    ? `<p class="impact">Impact: ${escapeHtml(finding.estimatedImpact)}</p>`
    : ''
  return [
    `<article class="finding sev-${finding.severity}" data-severity="${finding.severity}" data-category="${escapeAttr(finding.category)}">`,
    `  <h3>${escapeHtml(finding.title)}</h3>`,
    `  <p class="meta"><span class="badge">${SEVERITY_LABEL[finding.severity]}</span> · ${escapeHtml(finding.category)} · rule ${escapeHtml(finding.ruleId)}</p>`,
    `  <p class="desc">${escapeHtml(finding.description)}</p>`,
    impact,
    `  <p class="fix"><strong>Fix:</strong> ${escapeHtml(finding.remediation)}</p>`,
    `  <p><a class="docs-link" data-docs="${escapeAttr(finding.docsUrl)}">Stripe docs &rarr;</a></p>`,
    `</article>`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * The always-rendered coverage surface. A non-empty `truncated` is a PARTIAL
 * audit (a list region overflowed the fetch cap) and is shown right under the
 * header — it qualifies the grade, so it must be co-visible with the score, not
 * buried at the bottom. Region names are known `RuleScope` identifiers, but they
 * pass through `escapeHtml` for defense-in-depth consistency with every other
 * text node (and to stay robust if the scope set ever grows from external input).
 */
function renderCoverage(result: AuditResult): string {
  const sections: string[] = []
  // A filtered run must never read "Full audit": the FILTERED box
  // replaces it; truncation still renders its own partial warning, so a
  // filtered + truncated run shows BOTH. The filtered box is styled INLINE
  // rather than via STYLE so unfiltered output stays byte-identical (the
  // committed reporter snapshots must stay green unchanged).
  if (result.filter) {
    sections.push(
      [
        '<section class="coverage coverage-filtered" style="border:1px solid #9a6700;background:#9a67001a;border-radius:8px;padding:0.75rem 1rem;margin-bottom:1.5rem">',
        `  <strong>⚠️ Coverage: FILTERED</strong> (${escapeHtml(describeFilter(result.filter))}) — higher-severity rules were not run.`,
        '</section>',
      ].join('\n'),
    )
  }
  if (result.truncated.length === 0) {
    if (!result.filter) {
      sections.push('<p class="coverage coverage-full">Full audit — every region scanned within limits.</p>')
    }
    return sections.join('\n')
  }
  const regions = result.truncated.map((r) => `<code>${escapeHtml(r)}</code>`).join(', ')
  sections.push(
    [
      '<section class="coverage coverage-partial">',
      `  <strong>⚠️ Partial audit</strong> — ${result.truncated.length} region(s) exceeded the fetch cap and were truncated: ${regions}.`,
      '  Findings in those regions may be incomplete; the score reflects only the data that was read.',
      '</section>',
    ].join('\n'),
  )
  return sections.join('\n')
}

/** The findings region, grouped by severity band (each band a section). */
function renderFindings(result: AuditResult): string {
  if (result.findings.length === 0) {
    return '<p class="empty">No active findings — your billing configuration looks healthy. 🎉</p>'
  }
  const sections: string[] = []
  for (const severity of SEVERITY_ORDER) {
    const inBand = result.findings.filter((f) => f.severity === severity)
    if (inBand.length === 0) continue
    sections.push(
      `<section class="band band-${severity}">`,
      `<h2>${SEVERITY_LABEL[severity]} (${inBand.length})</h2>`,
      ...inBand.map(renderFindingCard),
      `</section>`,
    )
  }
  return sections.join('\n')
}

/** The filter controls (the inline JS reads these). */
function renderFilters(result: AuditResult): string {
  const categories = distinctCategories(result.findings)
  const catOptions = ['<option value="all">All categories</option>']
    .concat(categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`))
    .join('')
  const sevOptions = ['<option value="all">All severities</option>']
    .concat(SEVERITY_ORDER.map((s) => `<option value="${s}">${SEVERITY_LABEL[s]}</option>`))
    .join('')
  return [
    '<div class="filters">',
    `  <label>Filter by severity <select id="filter-severity">${sevOptions}</select></label>`,
    `  <label>Filter by category <select id="filter-category">${catOptions}</select></label>`,
    '</div>',
  ].join('\n')
}

/** The always-rendered Skipped section (skipped ≠ passed). */
function renderSkipped(result: AuditResult): string {
  if (result.skipped.length === 0) {
    return '<section class="skipped"><h2>Skipped rules</h2><p>None — every applicable rule ran. A skipped rule is never counted as passed.</p></section>'
  }
  const items = result.skipped
    .map((entry) => `<li><code>${escapeHtml(entry.ruleId)}</code> — ${escapeHtml(entry.reason)}</li>`)
    .join('')
  return `<section class="skipped"><h2>Skipped rules</h2><ul>${items}</ul></section>`
}

/**
 * The always-rendered "Suppressed (N)" badge. The count is rendered as CONTIGUOUS
 * text inside the heading — never split into a child tag — so a pre-JS scan reads
 * "Suppressed (0)" with no `<` between the word and the number.
 */
function renderSuppressed(result: AuditResult): string {
  const n = result.summary.suppressed
  const note =
    n === 0
      ? 'No findings were suppressed.'
      : `${n} finding(s) were suppressed and excluded from the score.`
  return `<section class="suppressed"><h2>Suppressed (${n})</h2><p>${escapeHtml(note)}</p></section>`
}

/** The optional baseline block, rendered only when present. */
function renderBaseline(baseline: BaselineDelta): string {
  const delta = `${baseline.scoreDelta >= 0 ? '+' : ''}${baseline.scoreDelta}`
  return [
    '<section class="baseline"><h2>Baseline</h2><ul>',
    `<li>New findings: ${baseline.newFindings.length}</li>`,
    `<li>Resolved findings: ${baseline.resolvedFindings.length}</li>`,
    `<li>Score delta: ${escapeHtml(delta)}</li>`,
    `<li>Regression: ${baseline.regression ? 'yes' : 'no'}</li>`,
    '</ul></section>',
  ].join('')
}

/** Inline stylesheet — system fonts only, no external resources. */
const STYLE = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 2rem; line-height: 1.5; }
  header { border-bottom: 2px solid #8884; padding-bottom: 1rem; margin-bottom: 1.5rem; }
  .score { font-size: 2.5rem; font-weight: 700; }
  .grade-A { color: #1a7f37; } .grade-B { color: #1f883d; } .grade-C { color: #9a6700; }
  .grade-D { color: #bc4c00; } .grade-F { color: #cf222e; }
  .filters { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
  .finding { border: 1px solid #8884; border-radius: 8px; padding: 1rem; margin: 0.75rem 0; }
  .sev-critical { border-left: 5px solid #cf222e; } .sev-high { border-left: 5px solid #bc4c00; }
  .sev-medium { border-left: 5px solid #9a6700; } .sev-low { border-left: 5px solid #0969da; }
  .sev-info { border-left: 5px solid #6e7781; }
  .badge { font-weight: 700; text-transform: uppercase; font-size: 0.75rem; }
  .meta { color: #6e7781; font-size: 0.85rem; }
  code { background: #8882; padding: 0.1em 0.3em; border-radius: 4px; }
  .coverage-partial { border: 1px solid #bc4c00; background: #bc4c001a; border-radius: 8px; padding: 0.75rem 1rem; margin-bottom: 1.5rem; }
  .coverage-full { color: #6e7781; font-size: 0.85rem; margin: 0 0 1.5rem; }
`.trim()

/** Inline behavior — filter findings + activate docs links without a static href. */
const SCRIPT = `
  (function () {
    var cards = Array.prototype.slice.call(document.querySelectorAll('.finding'));
    var sev = document.getElementById('filter-severity');
    var cat = document.getElementById('filter-category');
    function apply() {
      var s = sev ? sev.value : 'all';
      var c = cat ? cat.value : 'all';
      cards.forEach(function (el) {
        var okS = s === 'all' || el.getAttribute('data-severity') === s;
        var okC = c === 'all' || el.getAttribute('data-category') === c;
        el.style.display = okS && okC ? '' : 'none';
      });
    }
    if (sev) sev.addEventListener('change', apply);
    if (cat) cat.addEventListener('change', apply);
    Array.prototype.slice.call(document.querySelectorAll('a.docs-link')).forEach(function (a) {
      var u = a.getAttribute('data-docs');
      // Only http(s) URLs become clickable — never javascript:/data: (defense in
      // depth against a future plugin rule supplying a hostile docsUrl).
      if (u && /^https?:\/\//i.test(u)) { a.setAttribute('href', u); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); }
    });
  })();
`.trim()

/** Render an {@link AuditResult} as one self-contained HTML document. */
export function renderHtml(result: AuditResult): string {
  const { summary } = result
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stripe Audit Report</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="score grade-${summary.grade}">${summary.score} / 100 &middot; Grade ${summary.grade}${result.filter ? ' (filtered)' : ''}</div>
  <p class="meta">Stripe API ${escapeHtml(result.stripeApiVersion)} &middot; account ${escapeHtml(result.accountMode)} &middot; ${escapeHtml(result.auditDate)}</p>
  <p class="meta">${summary.total} active findings &middot; rules run ${summary.rulesRun} &middot; passed ${summary.rulesPassed}</p>
</header>
${renderCoverage(result)}
${renderFilters(result)}
${result.baseline ? renderBaseline(result.baseline) : ''}
<main>
${renderFindings(result)}
</main>
${renderSkipped(result)}
${renderSuppressed(result)}
<script>${SCRIPT}</script>
</body>
</html>`
}
