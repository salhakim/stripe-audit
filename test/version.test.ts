/**
 * Version single-sourcing guard.
 *
 * `src/version.ts` re-exports package.json's `version`, so the CLI banner and the
 * JSON report's `version` field can never drift from the published package
 * version. This reads package.json straight off disk — independent of the module
 * import — and asserts they match, so a future refactor that reintroduces a
 * hand-maintained literal (the exact bug that shipped 0.2.2 reporting 0.2.1)
 * fails CI instead of the registry.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { VERSION } from '../src/version'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string }

describe('package version is single-sourced', () => {
  it('VERSION equals package.json version on disk (no drift)', () => {
    expect(VERSION).toBe(pkg.version)
  })

  it('VERSION is a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
  })
})
