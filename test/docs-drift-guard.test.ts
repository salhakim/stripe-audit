import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Unit guard for scripts/check-docs-drift.mjs — the script behind `npm run check:docs`.
 *
 * That script is the sole gate on three census surfaces (assets/demo.svg, the
 * Stripe API-version literals, and the rule-ID reconcile over docs/rules.md +
 * COVERAGE.md), and until now it had no test of its own: it was exercised only by
 * running it against the real repo in CI, which proves it PASSES on a clean tree
 * and proves nothing about whether it still FAILS on a dirty one. A gate that has
 * only ever been observed passing is not a verified gate — the same reasoning that
 * put a deliberate fail-probe behind the census reconcile when it was added.
 *
 * Design: every case runs against a HERMETIC SANDBOX ROOT, never the working tree.
 * The script derives its root from its own location (`<root>/scripts/…` → `<root>`),
 * so copying it into a temp dir alongside a stub `dist/cli.js` and a stub renderer
 * lets each check be driven with known-good and known-bad inputs. Consequences:
 * the suite cannot corrupt the real repo even if it dies mid-run (the alternative —
 * planting a bad token in a tracked file and restoring it — leaves the tree dirty
 * on a crash), it needs no `npm run build`, and it asserts the script's LOGIC
 * rather than today's doc content.
 *
 * IMPORTANT — this file SHIPS in the export (test/ is on the allowlist), so it must
 * carry no internal work-tracking ID and no key-shaped literal.
 */

const REPO = process.cwd()
const SCRIPT = join(REPO, 'scripts', 'check-docs-drift.mjs')
const PRESENT = existsSync(SCRIPT)

/** Canonical values the stub CLI reports; the sandbox docs are seeded to agree. */
const API_VERSION = '2099-01-01.testchannel'
const ACTIVE_ID = 'FAKE_RULE_ALPHA'
const DROPPED_ID = 'FAKE_RULE_BETA'
const DEMO_SVG_BODY = '<svg role="img"><title>stub</title></svg>\n'

const scratch: string[] = []
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

interface Overrides {
  /** Replaces the generated content of a sandbox file, keyed by root-relative path. */
  files?: Record<string, string>
  /** Root-relative paths to omit from the sandbox entirely. */
  omit?: string[]
  /** Rule IDs the stub CLI reports as active (default: the one canonical active id). */
  active?: string[]
}

/**
 * Build a sandbox root that check-docs-drift.mjs considers CLEAN, then apply
 * overrides. Every failing case is therefore exactly one seeded deviation from a
 * known-passing baseline — so a red assertion names the drift, not the scaffold.
 */
function sandbox(o: Overrides = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'docs-drift-'))
  scratch.push(root)
  const active = o.active ?? [ACTIVE_ID]

  // Stub CLI: answers only the two invocations the script makes.
  const cli = `
const args = process.argv.slice(2)
if (args.includes('--list-rules')) {
  process.stdout.write(JSON.stringify({
    active: ${JSON.stringify(active)}.map((id) => ({ id })),
    dropped: [{ id: ${JSON.stringify(DROPPED_ID)} }],
  }))
} else {
  process.stdout.write('stripe-audit 9.9.9 (Stripe API ${API_VERSION})\\n')
}
`
  // Stub renderer: writes the same bytes every run, so a byte-compare against a
  // matching assets/demo.svg passes and against any other content fails.
  const render = `
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
writeFileSync(join(root, 'assets', 'demo.svg'), ${JSON.stringify(DEMO_SVG_BODY)})
`
  // A census doc must contain EXACTLY the active ∪ dropped id set. The markdown
  // link below is deliberate: the script strips link DESTINATIONS before matching,
  // so `MISSING_FROM_CENSUS.md` inside a destination must contribute no token —
  // the convention that lets census docs cite verify-gate files by path.
  const census = `# Census\n\n- ${ACTIVE_ID} — active\n- ${DROPPED_ID} — dropped, see [verdict](verify-gates/MISSING_FROM_CENSUS.md)\n`

  const files: Record<string, string> = {
    'scripts/check-docs-drift.mjs': '', // copied from the repo below, not generated
    'scripts/render-demo-svg.mjs': render,
    'dist/cli.js': cli,
    'assets/demo.svg': DEMO_SVG_BODY,
    'docs/rules.md': census,
    'COVERAGE.md': census,
    'README.md': `Pinned to the \`${API_VERSION}\` Stripe API version.\n`,
    ...(o.files ?? {}),
  }

  for (const [relPath, body] of Object.entries(files)) {
    if (o.omit?.includes(relPath)) continue
    const abs = join(root, relPath)
    mkdirSync(join(abs, '..'), { recursive: true })
    if (relPath === 'scripts/check-docs-drift.mjs') copyFileSync(SCRIPT, abs)
    else writeFileSync(abs, body)
  }
  return root
}

function run(root: string) {
  return spawnSync('node', [join(root, 'scripts', 'check-docs-drift.mjs')], {
    encoding: 'utf8',
    cwd: root,
  })
}

describe.runIf(PRESENT)('check-docs-drift.mjs — passes on a clean tree', () => {
  it('exits 0 and names every reconciled surface', () => {
    const r = run(sandbox())
    expect(r.status, r.stderr).toBe(0)
    expect(r.stdout).toContain('docs in sync')
    expect(r.stdout).toContain('docs/rules.md')
    expect(r.stdout).toContain('COVERAGE.md')
  })

  it('leaves the tree byte-identical after Check A regenerates in place', () => {
    // Seeded STALE on purpose: Check A regenerates demo.svg in place to compare,
    // so the restore is only observable when the rendered bytes differ from the
    // committed ones. Asserting this on a clean tree would pass even with the
    // `finally` restore deleted — the check would be inert.
    const stale = '<svg>stale</svg>\n'
    const root = sandbox({ files: { 'assets/demo.svg': stale } })
    expect(run(root).status).toBe(1) // drift IS reported…
    expect(readFileSync(join(root, 'assets', 'demo.svg'), 'utf8')).toBe(stale) // …and nothing is rewritten
  })

  it('refuses to run at all without a built dist/', () => {
    const r = run(sandbox({ omit: ['dist/cli.js'] }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('npm run build')
  })
})

describe.runIf(PRESENT)('check-docs-drift.mjs — Check A (demo.svg vs --demo)', () => {
  it('fails when the committed SVG is stale vs the renderer', () => {
    const r = run(sandbox({ files: { 'assets/demo.svg': '<svg>stale</svg>\n' } }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('assets/demo.svg')
    expect(r.stderr).toContain('render-demo-svg')
  })

  it('fails when the committed SVG is absent', () => {
    const r = run(sandbox({ omit: ['assets/demo.svg'] }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('is missing')
  })
})

describe.runIf(PRESENT)('check-docs-drift.mjs — Check B (API-version literals)', () => {
  it('fails on a doc literal that does not match the CLI', () => {
    const r = run(sandbox({ files: { 'README.md': 'Pinned to `2020-01-01.oldchannel`.\n' } }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('stale API version')
    expect(r.stderr).toContain('2020-01-01.oldchannel')
  })

  it('accepts the shields-escaped double-dash badge form as canonical', () => {
    const badge = API_VERSION.replace(/-/g, '--')
    const r = run(
      sandbox({ files: { 'README.md': `![api](https://img.shields.io/badge/${badge}-blue)\n` } }),
    )
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails when NO literal is found at all (guard mis-targeted / docs restructured)', () => {
    const r = run(sandbox({ files: { 'README.md': 'No version literal here.\n' } }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('no Stripe API-version literals found')
  })
})

describe.runIf(PRESENT)('check-docs-drift.mjs — Checks C + D (census ↔ --list-rules)', () => {
  // Both directions matter: a missing id means the census under-reports the
  // shipped catalogue, an extra one means it advertises a rule that does not exist.
  for (const doc of ['docs/rules.md', 'COVERAGE.md']) {
    it(`fails when ${doc} is MISSING a shipped rule id`, () => {
      const r = run(sandbox({ files: { [doc]: `# Census\n\n- ${ACTIVE_ID} only\n` } }))
      expect(r.status).toBe(1)
      expect(r.stderr).toContain(`${doc} is missing rule ID(s): ${DROPPED_ID}`)
    })

    it(`fails when ${doc} carries an EXTRA screaming-snake token`, () => {
      const r = run(
        sandbox({
          files: { [doc]: `# Census\n\n- ${ACTIVE_ID}\n- ${DROPPED_ID}\n- GHOST_RULE_ID\n` },
        }),
      )
      expect(r.status).toBe(1)
      expect(r.stderr).toContain('GHOST_RULE_ID')
    })
  }

  it('does NOT count tokens that appear only inside a markdown link destination', () => {
    // The clean baseline already cites verify-gates/MISSING_FROM_CENSUS.md as a
    // link destination. If destinations leaked tokens, the baseline would fail as
    // an EXTRA — so the passing clean-tree case above is this rule's proof, and
    // this case pins the inverse: the same token in link TEXT is counted.
    const r = run(
      sandbox({
        files: {
          'COVERAGE.md': `# Census\n\n- ${ACTIVE_ID}\n- ${DROPPED_ID}\n- [GHOST_RULE_ID](x.md)\n`,
        },
      }),
    )
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('GHOST_RULE_ID')
  })

  it('flags a rule id with no underscore as invisible to the reconcile regex', () => {
    const r = run(sandbox({ active: [ACTIVE_ID, 'SINGLEWORD'] }))
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('without an underscore')
    expect(r.stderr).toContain('SINGLEWORD')
  })

  it('skips the reconcile entirely when no census doc exists', () => {
    const r = run(sandbox({ omit: ['docs/rules.md', 'COVERAGE.md'] }))
    expect(r.status, r.stderr).toBe(0)
  })
})
