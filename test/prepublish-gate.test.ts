import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Regression guard for the `prepublishOnly` publish gate.
 *
 * `prepublishOnly` fires ONLY on `npm publish` (including --dry-run), before
 * the package is prepared and packed — day-to-day `npm pack` / `npm install`
 * never pay for it. This suite proves the gate blocks: a failing step in the
 * chain aborts publish with a non-zero exit before anything is packed.
 *
 * The skeleton copies the REAL prepublishOnly string out of the repo's
 * package.json (so the chain under test is the shipped wiring, not a
 * fixture's idea of it) and stubs the three underlying scripts with cheap
 * node one-liners — the full chain on the real tree runs at release time.
 */

const REPO = process.cwd()
const EXPECTED_CHAIN = 'npm run build && npm run typecheck && npm test'

const scratch: string[] = []
function freshDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix))
  scratch.push(d)
  return d
}

afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

function skeleton(testCmd: string): string {
  const dir = freshDir('prepublish-gate-')
  const real = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'prepublish-gate-fixture',
        version: '0.0.1',
        license: 'MIT',
        scripts: {
          // the shipped chain, verbatim — the assertion below keeps them in lockstep
          prepublishOnly: real.scripts.prepublishOnly,
          build: 'node -e ""',
          typecheck: 'node -e ""',
          test: testCmd,
        },
      },
      null,
      2,
    ),
  )
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  return dir
}

function npmIn(dir: string, args: string[]) {
  return spawnSync('npm', args, { cwd: dir, encoding: 'utf8' })
}

describe('prepublishOnly publish gate', () => {
  let realChain: string

  beforeAll(() => {
    realChain = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).scripts.prepublishOnly
  })

  it('package.json wires build + typecheck + test into prepublishOnly', () => {
    expect(realChain).toBe(EXPECTED_CHAIN)
  })

  it('a failing test blocks `npm publish --dry-run` with a non-zero exit', () => {
    const dir = skeleton('node -e "console.error(\'seeded failure\'); process.exit(1)"')
    const r = npmIn(dir, ['publish', '--dry-run'])
    expect(r.status).not.toBe(0)
    expect(r.stderr + r.stdout).toContain('seeded failure')
  }, 30_000)

  it('the chain passes end-to-end when every step is green (positive control)', () => {
    const dir = skeleton('node -e ""')
    // run the lifecycle script directly — hermetic (no registry contact)
    const r = npmIn(dir, ['run', 'prepublishOnly'])
    expect(r.status, r.stderr).toBe(0)
  }, 30_000)
})
