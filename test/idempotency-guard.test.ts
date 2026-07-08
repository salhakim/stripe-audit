import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The correct Stripe idempotency header is `Idempotency-Key`. The legacy/wrong
 * name `Stripe-Idempotency-Key` must never appear in shipped source. The
 * idempotency-EVIDENCE rule is unbuildable under a 6-scope key (restricted keys
 * cannot read request logs), so this is a naming-correctness guard that also
 * stops the fetcher from re-introducing the wrong header.
 *
 * It captures the offending files and asserts the set is empty — it does not
 * rely on a grep exit code.
 */
const WRONG_HEADER = /stripe-idempotency-key/i

function srcFiles(dir = 'src'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...srcFiles(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('idempotency header naming guard', () => {
  it('no shipped src/ file references the wrong "Stripe-Idempotency-Key" header', () => {
    const offenders = srcFiles().filter((file) => WRONG_HEADER.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
