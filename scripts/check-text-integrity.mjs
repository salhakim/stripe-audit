#!/usr/bin/env node
// check-text-integrity.mjs — fail-closed scan of git-tracked source/docs files
// for raw control bytes. Catches an encoding-hazard class that previously
// shipped without a gate:
//
//   src/baseline.ts carried a literal NUL (0x00) where the 6-char escape
//   sequence was intended — an agent emitting a unicode escape inside generated
//   content can land the raw byte instead. Git then classifies the file as
//   binary (no diff / blame / text merge), and the byte renders invisibly in
//   editors and review tooling, blinding every downstream gate on that file.
//
// Policy: any C0 control byte other than TAB (0x09), LF (0x0A), and CR (0x0D)
// in a tracked file under the scanned roots is a failure, reported as
// file:byte-offset with the codepoint. Binary assets are excluded by extension.
//
// Usage:  npm run check:bytes   (or: node scripts/check-text-integrity.mjs)

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Roots that must stay pure text. */
const SCAN_ROOTS = ['src', 'test', 'docs', 'scripts', 'assets', '.github', '.husky']

/** Tracked extensions that are legitimately binary — skip, never scan. */
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2'])

/** C0 bytes that ARE legal in text: TAB, LF, CR. Everything else < 0x20, and DEL-less NUL range, fails. */
const ALLOWED_CONTROL = new Set([0x09, 0x0a, 0x0d])

const tracked = execFileSync('git', ['ls-files', '-z', '--', ...SCAN_ROOTS], { cwd: ROOT })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)

const violations = []
for (const file of tracked) {
  const ext = file.slice(file.lastIndexOf('.'))
  if (BINARY_EXTENSIONS.has(ext)) continue
  const bytes = readFileSync(join(ROOT, file))
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]
    if (b < 0x20 && !ALLOWED_CONTROL.has(b)) {
      violations.push({ file, offset: i, byte: b })
      break // one report per file is enough to fail; keep output actionable
    }
  }
}

if (violations.length > 0) {
  for (const { file, offset, byte } of violations) {
    const hex = `0x${byte.toString(16).padStart(2, '0')}`
    console.error(`✖ ${file}:${offset} — raw control byte ${hex} in a text file`)
  }
  console.error(
    '\ntext-integrity: raw control bytes make git treat a file as binary (no diff/blame/merge)\n' +
      'and render invisibly in editors. Replace the byte with its escape sequence in source\n' +
      '(write the fix byte-level, e.g. via python, so the escape is not re-emitted as the byte).',
  )
  process.exit(1)
}

console.log(`text-integrity: OK — ${tracked.length} tracked files scanned, no raw control bytes`)
