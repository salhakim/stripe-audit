#!/usr/bin/env node
// render-demo-svg.mjs — regenerate assets/demo.svg from the live `--demo` output.
//
// Offline & deterministic by design:
//   • runs `node dist/cli.js --demo` (no key, no network),
//   • strips any ANSI escape codes,
//   • normalizes the run timestamp so the committed asset is stable across regens,
//   • emits a self-contained terminal-style SVG that renders inline on GitHub.
//
// Usage:  node scripts/render-demo-svg.mjs
// Output: assets/demo.svg
//
// Re-run whenever the `--demo` output changes; commit the regenerated SVG.

import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'dist', 'cli.js');
const OUT = join(ROOT, 'assets', 'demo.svg');

if (!existsSync(CLI)) {
  console.error(`✗ ${CLI} not found — run \`npm run build\` first.`);
  process.exit(1);
}

// 1. Capture the keyless demo output (non-TTY → chalk emits plain text).
//    The CLI exits non-zero when findings exist (eslint-style), so read the
//    report off stdout whether the process exits 0 or non-zero.
let raw;
try {
  raw = execFileSync('node', [CLI, '--demo'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });
} catch (err) {
  if (err.stdout == null) throw err; // real failure (spawn error, no output)
  raw = err.stdout;
}

// 2. Strip any residual ANSI SGR escape sequences. Color is forced off above, so
//    this is defensive — but match the full ESC[…m form so a stray escape byte
//    can never leak into the SVG.
raw = raw.replace(/\x1b\[[0-9;]*m/g, '');

// 3. Normalize the non-deterministic ISO run timestamp to a stable label so the
//    committed SVG does not churn on every regeneration.
raw = raw.replace(
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g,
  '<run timestamp>',
);

const lines = raw.replace(/\s+$/g, '').split('\n');

// 4. Layout metrics (monospace grid).
const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const CHAR_WIDTH = 8.4;
const PAD_X = 20;
const PAD_Y = 18;
const TITLE_BAR = 28;

const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
const width = Math.ceil(PAD_X * 2 + cols * CHAR_WIDTH);
const height = Math.ceil(TITLE_BAR + PAD_Y * 2 + lines.length * LINE_HEIGHT);

// 5. Severity-aware coloring keyed off line content (no ANSI parsing needed).
const COLORS = {
  bg: '#0d1117',
  fg: '#c9d1d9',
  dim: '#8b949e',
  critical: '#f85149',
  high: '#ff9800',
  medium: '#e3b341',
  low: '#58a6ff',
  info: '#8b949e',
  score: '#f0f6fc',
  ok: '#3fb950',
};

function colorFor(line) {
  const t = line.trimStart();
  if (/^Critical \(/.test(t)) return COLORS.critical;
  if (/^High \(/.test(t)) return COLORS.high;
  if (/^Medium \(/.test(t)) return COLORS.medium;
  if (/^Low \(/.test(t)) return COLORS.low;
  if (/^Info \(/.test(t)) return COLORS.info;
  if (/^Score:/.test(t)) return COLORS.score;
  if (/^Coverage:/.test(t)) return COLORS.ok;
  if (/^stripe-audit/.test(t) && !/demo mode/.test(t)) return COLORS.ok;
  if (/^(Stripe API|Point it at|stripe-audit · demo)/.test(t)) return COLORS.dim;
  return COLORS.fg;
}

const esc = (s) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const textEls = lines
  .map((line, i) => {
    const y = TITLE_BAR + PAD_Y + i * LINE_HEIGHT + FONT_SIZE;
    if (line.length === 0) return '';
    return `  <text x="${PAD_X}" y="${y}" fill="${colorFor(line)}">${esc(line)}</text>`;
  })
  .filter(Boolean)
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="stripe-audit --demo terminal output">
  <rect width="${width}" height="${height}" rx="8" fill="${COLORS.bg}"/>
  <rect width="${width}" height="${TITLE_BAR}" rx="8" fill="#161b22"/>
  <rect y="${TITLE_BAR - 8}" width="${width}" height="8" fill="#161b22"/>
  <circle cx="18" cy="14" r="5" fill="#ff5f56"/>
  <circle cx="36" cy="14" r="5" fill="#ffbd2e"/>
  <circle cx="54" cy="14" r="5" fill="#27c93f"/>
  <text x="${width / 2}" y="18" fill="${COLORS.dim}" text-anchor="middle" font-size="12">stripe-audit --demo</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace" font-size="${FONT_SIZE}" xml:space="preserve">
${textEls}
  </g>
</svg>
`;

writeFileSync(OUT, svg, 'utf8');
console.log(`✓ wrote ${OUT} (${width}×${height}, ${lines.length} lines)`);
