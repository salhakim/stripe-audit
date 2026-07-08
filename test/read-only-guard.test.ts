import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * stripe-audit is read-only by construction — the product's core trust property
 * (docs/scopes-reference.md promises this guard). Every Stripe API call lives in
 * the fetcher (src/fetcher.ts) behind the client built in src/stripe-client.ts;
 * rules read snapshots, never the client. This guard fails the build if a Stripe
 * write method ever appears on that surface.
 *
 * It captures the offending lines and asserts the set is empty — it does not
 * rely on a grep exit code.
 */
const STRIPE_WRITE_METHOD = /\.(create|update|del|cancel|verify|confirm|capture|attach|detach)\(/

const STRIPE_SURFACE = ['src/fetcher.ts', 'src/stripe-client.ts']

describe('read-only guard — no Stripe write calls on the client surface', () => {
  it.each(STRIPE_SURFACE)('%s contains no write-method invocation', (file) => {
    const offenders = readFileSync(file, 'utf8')
      .split('\n')
      .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
      .filter(({ line }) => STRIPE_WRITE_METHOD.test(line))
    expect(offenders).toEqual([])
  })
})
