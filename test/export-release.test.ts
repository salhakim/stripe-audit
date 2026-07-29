import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

/**
 * Regression guard for the public-release tooling
 * (scripts/export-public.sh + scripts/verify-export-clean.sh). A one-off smoke
 * check verified these once at build time, then evaporated;
 * this test keeps them honest for every future edit to the allowlist or guard.
 *
 * IMPORTANT — this file SHIPS in the export (test/ is on the allowlist), so it is
 * itself scanned by the three guards. It therefore must contain NO framework-brand
 * token and NO live-key-shaped literal: brand strings and fake keys are assembled
 * by concatenation so no complete token lands in source.
 */

const REPO = process.cwd()
const EXPORT = join(REPO, 'scripts', 'export-public.sh')
const VERIFY = join(REPO, 'scripts', 'verify-export-clean.sh')

// The release tooling is deliberately NOT exported (a public clone gets the
// shipped product, not the private export pipeline), so on a public clone this
// suite has nothing to test — skip it instead of failing on the missing scripts.
const TOOLING_PRESENT = existsSync(EXPORT) && existsSync(VERIFY)

// Assembled so the literal token never appears in this (shipped) source file.
const BRAND = 'orchestr' + 'ator'
const FAKE_LIVE_KEY = 'sk_' + 'live_' + 'Z'.repeat(30)
const FAKE_WEBHOOK = 'whsec_' + 'Q'.repeat(40)
// Internal work-tracking ID shapes the mission-vocabulary guard must refuse —
// assembled so this shipped file cannot trip the guard on itself.
const FAKE_STORY_ID = ['C', '11-', '010'].join('')
const FAKE_OBS_REF = 'obs' + '-' + '42'
// A STANDALONE camp ID above the range an earlier revision of the guard capped at.
// That ceiling was the live blind spot: ids past it passed silently and reached the
// public mirror, so the range is now unbounded and this pins it.
const FAKE_HIGH_CAMP_ID = 'C' + '87'

function sh(script: string, args: string[], env?: NodeJS.ProcessEnv) {
  return spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
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

describe.runIf(TOOLING_PRESENT)('export-public.sh', () => {
  let out: string

  // export-public.sh shells verify-export-clean.sh, whose gitleaks step falls back
  // to gitleaks-in-Docker when no binary is on PATH — and that first image pull can
  // exceed vitest's default 10s hook timeout on a cold CI runner (flaky: the same SHA
  // has both passed and failed the coverage gate). The export itself is ~0.5s; the
  // 60s ceiling absorbs a cold Docker pull without weakening any assertion.
  beforeAll(() => {
    out = join(freshDir('c7-export-'), 'tree')
    const r = sh(EXPORT, [out])
    expect(r.status, r.stderr).toBe(0)
  }, 60_000)

  it('produces exactly one commit on a deterministic `main` branch', () => {
    const count = spawnSync('git', ['-C', out, 'rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
    })
    expect(count.stdout.trim()).toBe('1')
    const branch = spawnSync('git', ['-C', out, 'branch', '--show-current'], {
      encoding: 'utf8',
    })
    // Independent of the operator's init.defaultBranch (some default to master).
    expect(branch.stdout.trim()).toBe('main')
  })

  it('ships the product surface and NONE of the framework footprint', () => {
    expect(existsSync(join(out, 'package.json'))).toBe(true)
    expect(existsSync(join(out, 'src'))).toBe(true)
    // The composite Action ships in the public tree — a Marketplace
    // Action is consumed from the exported git repo (`uses: owner/repo@tag`).
    expect(existsSync(join(out, 'action.yml')), 'action.yml must export').toBe(true)
    // The Action's github-script step requires this committed script at
    // runtime (via GITHUB_ACTION_PATH), so it must ship in the exported tree too.
    expect(
      existsSync(join(out, 'scripts', 'stripe-audit-sticky-comment.cjs')),
      'sticky-comment script must export',
    ).toBe(true)
    // The release pipeline ships so consumers can inspect the
    // Marketplace / npm publish path (secret-by-name, no key material).
    expect(
      existsSync(join(out, '.github', 'workflows', 'release.yml')),
      'release.yml must export',
    ).toBe(true)
    for (const leak of [
      '.claude',
      'learnings',
      'framework.config.json',
      'secops.md',
      'PRD.json',
      'progress.txt',
      'LIBRARIAN.md',
      'knowledge-map.md',
      // The weekly-smoke workflow is repo-internal (handles a live
      // restricted key as a CI secret) — it must NOT ship, like librarian-daily.yml.
      '.github/workflows/weekly-smoke.yml',
      // The reference-account note is team-internal — never exported.
      'docs/missions',
    ]) {
      expect(existsSync(join(out, leak)), `footprint leaked: ${leak}`).toBe(false)
    }
  })

  it('self-verifies clean (tail-called guard exits 0)', () => {
    const r = sh(VERIFY, [out])
    expect(r.status, r.stderr).toBe(0)
  })
})

describe.runIf(TOOLING_PRESENT)('verify-export-clean.sh — each guard fails closed on a seeded leak', () => {
  it('bad usage / missing target dir → exit 2', () => {
    const r = sh(VERIFY, [join(tmpdir(), 'c7-does-not-exist-' + process.pid)])
    expect(r.status).toBe(2)
  })

  it('framework-footprint PATH present → non-zero', () => {
    const probe = freshDir('c7-fp-')
    mkdirSync(join(probe, '.claude'), { recursive: true })
    writeFileSync(join(probe, '.claude', 'settings.json'), '{}')
    expect(sh(VERIFY, [probe]).status).not.toBe(0)
  })

  it('framework-BRAND term in content → non-zero', () => {
    const probe = freshDir('c7-brand-')
    mkdirSync(join(probe, 'src'), { recursive: true })
    writeFileSync(join(probe, 'src', 'x.ts'), `// ${BRAND} loop marker\n`)
    expect(sh(VERIFY, [probe]).status).not.toBe(0)
  })

  it('a real secret in content → non-zero (via whichever scanner runs)', () => {
    const probe = freshDir('c7-secret-')
    mkdirSync(join(probe, 'src'), { recursive: true })
    writeFileSync(join(probe, 'src', 'leak.ts'), `const k = "${FAKE_LIVE_KEY}"\n`)
    expect(sh(VERIFY, [probe]).status).not.toBe(0)
  })

  it('MISSION-VOCABULARY (planted work-tracking IDs) in content → non-zero', () => {
    const probe = freshDir('c7-vocab-')
    mkdirSync(join(probe, 'docs'), { recursive: true })
    writeFileSync(join(probe, 'docs', 'note.md'), `see ${FAKE_STORY_ID} and ${FAKE_OBS_REF}\n`)
    const r = sh(VERIFY, [probe])
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('MISSION-VOCABULARY')
  })

  it('MISSION-VOCABULARY catches a STANDALONE camp ID with no upper bound', () => {
    const probe = freshDir('c7-highid-')
    mkdirSync(join(probe, 'src'), { recursive: true })
    writeFileSync(join(probe, 'src', 'x.ts'), `// the ${FAKE_HIGH_CAMP_ID} config knobs\n`)
    const r = sh(VERIFY, [probe])
    expect(r.status, 'a standalone camp ID above the old ceiling must be refused').not.toBe(0)
    expect(r.stderr).toContain('MISSION-VOCABULARY')
  })

  it('benign lookalikes (ASCII "C0 control bytes", grade copy) stay clean', () => {
    const probe = freshDir('c7-benign-')
    mkdirSync(join(probe, 'docs'), { recursive: true })
    writeFileSync(
      join(probe, 'docs', 'note.md'),
      'C0 control bytes are stripped; a C grade is a 70; section 3b applies.\n',
    )
    expect(sh(VERIFY, [probe]).status).toBe(0)
  })
})

/**
 * The additive regex backstop closes gitleaks' path-allowlist blind spot: the
 * shipped .gitleaks.toml exempts docs/, README.md, CHANGELOG.md, .env.example from
 * scanning (right for the commit gate), so gitleaks ALONE would ship a real key
 * pasted into those files. The always-run backstop has no path allowlist, so the
 * guard rejects it anyway. (Confirmed via adversarial verification.)
 */
describe.runIf(TOOLING_PRESENT)('verify-export-clean.sh — additive backstop closes the docs/ allowlist blind spot', () => {
  it('catches a real live key in an ALLOWLISTED docs/ path', () => {
    const probe = freshDir('c7-docs-')
    mkdirSync(join(probe, 'docs'), { recursive: true })
    copyFileSync(join(REPO, '.gitleaks.toml'), join(probe, '.gitleaks.toml'))
    writeFileSync(
      join(probe, 'docs', 'rules.md'),
      `Example: export STRIPE_SECRET_KEY=${FAKE_LIVE_KEY}\n`,
    )
    expect(sh(VERIFY, [probe]).status).not.toBe(0)
  })

  it('catches a real webhook secret in an ALLOWLISTED README.md', () => {
    const probe = freshDir('c7-readme-')
    copyFileSync(join(REPO, '.gitleaks.toml'), join(probe, '.gitleaks.toml'))
    writeFileSync(join(probe, 'README.md'), `Set WEBHOOK=${FAKE_WEBHOOK}\n`)
    expect(sh(VERIFY, [probe]).status).not.toBe(0)
  })

  it('does NOT flag a documented placeholder in docs/', () => {
    const probe = freshDir('c7-ph-')
    mkdirSync(join(probe, 'docs'), { recursive: true })
    copyFileSync(join(REPO, '.gitleaks.toml'), join(probe, '.gitleaks.toml'))
    writeFileSync(
      join(probe, 'docs', 'x.md'),
      'export STRIPE_SECRET_KEY=rk_test_your_restricted_readonly_key_here\n',
    )
    const r = sh(VERIFY, [probe])
    expect(r.status, r.stderr).toBe(0)
  })

  it('passes a CLEAN config-less tree (no bash-3.2 empty-array crash under set -u)', () => {
    const probe = freshDir('c7-noconf-')
    mkdirSync(join(probe, 'src'), { recursive: true })
    // No .gitleaks.toml at root → gitleaks runs without -c; must not crash.
    writeFileSync(join(probe, 'src', 'ok.ts'), 'export const ok = true\n')
    const r = sh(VERIFY, [probe])
    expect(r.status, r.stderr).toBe(0)
  })
})

/**
 * Belt-and-suspenders secret detection. Force the regex backstop by
 * running with a sanitized PATH that exposes only the coreutils the guard needs —
 * NOT gitleaks and NOT docker — so the failover chain reaches layer (c).
 */
describe.runIf(TOOLING_PRESENT)('verify-export-clean.sh — regex backstop failover (no gitleaks, no docker)', () => {
  let sandboxPath: string | null = null

  beforeAll(() => {
    const bin = freshDir('c7-bin-')
    // Symlink only the utilities the guard invokes; omit gitleaks + docker.
    const need = ['bash', 'sh', 'grep', 'find', 'head', 'sed', 'cat', 'ls', 'rm', 'mkdir']
    let ok = true
    for (const u of need) {
      const w = spawnSync('bash', ['-lc', `command -v ${u}`], { encoding: 'utf8' })
      const resolved = w.stdout.trim()
      if (!resolved) continue
      try {
        mkdirSync(dirname(join(bin, u)), { recursive: true })
        symlinkSync(resolved, join(bin, u))
      } catch {
        ok = false
      }
    }
    // Sanity: gitleaks/docker must NOT resolve under the sandbox PATH.
    const probe = spawnSync('bash', ['-lc', 'command -v gitleaks || true'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: bin },
    })
    if (ok && probe.stdout.trim() === '') sandboxPath = bin
  })

  it('passes a clean tree via the backstop and warns DEGRADED', () => {
    if (!sandboxPath) return // platform could not build a tool sandbox; covered elsewhere
    const clean = freshDir('c7-clean-')
    mkdirSync(join(clean, 'src'), { recursive: true })
    writeFileSync(join(clean, 'src', 'ok.ts'), 'export const ok = true\n')
    const r = sh(VERIFY, [clean], { PATH: sandboxPath })
    expect(r.status, r.stderr).toBe(0)
    expect(r.stderr).toMatch(/DEGRADED/)
  })

  it('still catches a live key and a webhook secret via the backstop', () => {
    if (!sandboxPath) return
    for (const secret of [FAKE_LIVE_KEY, FAKE_WEBHOOK]) {
      const probe = freshDir('c7-bs-')
      mkdirSync(join(probe, 'src'), { recursive: true })
      writeFileSync(join(probe, 'src', 'leak.ts'), `const k = "${secret}"\n`)
      expect(sh(VERIFY, [probe], { PATH: sandboxPath }).status).not.toBe(0)
    }
  })

  it('honors gitleaks:allow even in the backstop', () => {
    if (!sandboxPath) return
    const probe = freshDir('c7-allow-')
    mkdirSync(join(probe, 'src'), { recursive: true })
    // Same key shape, but sentinel-marked → must NOT trip the backstop.
    writeFileSync(
      join(probe, 'src', 'fixture.ts'),
      `const fixture = "${FAKE_LIVE_KEY}" // gitleaks:allow\n`,
    )
    const r = sh(VERIFY, [probe], { PATH: sandboxPath })
    expect(r.status, r.stderr).toBe(0)
  })

  it('fails CLOSED under VERIFY_STRICT_GITLEAKS=1 when no scanner is available', () => {
    if (!sandboxPath) return
    const clean = freshDir('c7-strict-')
    mkdirSync(join(clean, 'src'), { recursive: true })
    writeFileSync(join(clean, 'src', 'ok.ts'), 'export const ok = true\n')
    const r = sh(VERIFY, [clean], { PATH: sandboxPath, VERIFY_STRICT_GITLEAKS: '1' })
    expect(r.status).not.toBe(0)
  })
})
