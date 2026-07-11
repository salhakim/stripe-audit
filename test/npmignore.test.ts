import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  readFileSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

/**
 * Regression guard for the root .npmignore fallback (S1 pack guard).
 *
 * Normally the package.json `files` allowlist governs the tarball and the
 * root .npmignore is inert. Its load-bearing role is the FALLBACK: when
 * `files` is absent, npm consults the root .npmignore INSTEAD OF .gitignore —
 * so if the allowlist is ever removed, only this file stands between secrets
 * / local DBs / internal footprint and the published tarball. This suite
 * proves that fallback path: a repo skeleton with `files` stripped and
 * sensitive files seeded packs zero denylisted entries.
 *
 * IMPORTANT — this file SHIPS (test/ is exported), so it contains no
 * framework-brand token and no live-key-shaped literal; risky strings are
 * assembled by concatenation.
 */

const REPO = process.cwd()
const FAKE_LIVE_KEY = 'sk_' + 'live_' + 'Y'.repeat(30)

// Paths that must NEVER appear in a packed tarball, even in fallback mode.
// Seeded into the scratch skeleton below; asserted absent from pack output.
const DENYLIST_SEEDS = [
  '.env',
  '.env.production',
  'server.pem',
  'signing.key',
  'local-memory.db',
  '.claude/settings.json',
  'CLAUDE.md',
  'framework.config.json',
  'learnings/notes.md',
  'stack-documentation/api/vendor.md',
  'PRD.json',
  'secops.md',
  'knowledge-map.md',
  'LIBRARIAN.md',
  'progress.txt',
  '.husky/pre-commit',
  'templates/consumer.gitignore',
  'docs/approved-plans/plan.md',
  'docs/missions/brief.md',
  'src/index.ts',
  'test/engine.test.ts',
]

function pack(dir: string) {
  return spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: dir,
    encoding: 'utf8',
  })
}

function packedPaths(stdout: string): string[] {
  // stdout may carry npm notice noise before the JSON array — slice to it.
  const raw = stdout.slice(stdout.indexOf('['))
  const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>
  return parsed[0].files.map((f) => f.path)
}

const scratch: string[] = []
function freshDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(d)
  return d
}

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

describe('root .npmignore — fallback pack guard (files allowlist removed)', () => {
  let skeleton: string
  let paths: string[]

  beforeAll(() => {
    // scratch prefix stays lowercase — case-insensitive tmpfs collisions
    skeleton = freshDir('npmignore-guard-')

    // package.json with the `files` allowlist STRIPPED — the fallback scenario.
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    delete pkg.files
    delete pkg.scripts // no prepare/husky in the skeleton
    writeFileSync(join(skeleton, 'package.json'), JSON.stringify(pkg, null, 2))

    // The guard under test — the real file, not a fixture copy.
    copyFileSync(join(REPO, '.npmignore'), join(skeleton, '.npmignore'))

    // Legit product surface so the pack has something to ship.
    mkdirSync(join(skeleton, 'dist'), { recursive: true })
    writeFileSync(join(skeleton, 'dist', 'cli.js'), '#!/usr/bin/env node\n')
    writeFileSync(join(skeleton, 'README.md'), '# readme\n')
    writeFileSync(join(skeleton, 'LICENSE'), 'MIT\n')

    // Seed every denylisted path with harmless content (plus one key-shaped
    // literal inside .env to mirror the real leak scenario).
    for (const rel of DENYLIST_SEEDS) {
      const abs = join(skeleton, rel)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, rel === '.env' ? `STRIPE_KEY=${FAKE_LIVE_KEY}\n` : `seed: ${rel}\n`)
    }

    const r = pack(skeleton)
    expect(r.status, r.stderr).toBe(0)
    paths = packedPaths(r.stdout)
  }, 30_000)

  it('packs zero denylisted entries with `files` removed', () => {
    const leaked = paths.filter((p) =>
      DENYLIST_SEEDS.some((d) => p === d || p.startsWith(d.split('/')[0] + '/')),
    )
    expect(leaked, `leaked into tarball: ${leaked.join(', ')}`).toEqual([])
  })

  it('still ships the product surface', () => {
    expect(paths).toContain('dist/cli.js')
    expect(paths).toContain('README.md')
    expect(paths).toContain('package.json')
  })
})

describe('root .npmignore — real tree stays governed by `files`', () => {
  it('npm pack --dry-run on the repo shows zero framework-footprint entries', () => {
    const r = pack(REPO)
    expect(r.status, r.stderr).toBe(0)
    const paths = packedPaths(r.stdout)
    const footprint = paths.filter((p) =>
      /^(\.claude\/|CLAUDE\.md$|framework\.config\.json$|learnings\/|stack-documentation\/|PRD\.json$|secops\.md$|knowledge-map\.md$|LIBRARIAN\.md$|progress\.txt$|\.husky\/|templates\/|docs\/(approved-plans|missions|case-study)\/)/.test(
        p,
      ),
    )
    expect(footprint, `framework footprint in tarball: ${footprint.join(', ')}`).toEqual([])
  }, 30_000)
})
