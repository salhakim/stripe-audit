import { describe, it, expect } from 'vitest'
import { detectKeyMode, redact } from '../src/key'
import { fakeKey } from './fixtures/fake-keys'

// Placeholder keys — NOT real credentials. Assembled at runtime so the source
// text never matches a provider key pattern (see fixtures/fake-keys.ts).
const LIVE_SECRET = fakeKey('sk', 'live')
const TEST_SECRET = fakeKey('sk', 'test')
const LIVE_RESTRICTED = fakeKey('rk', 'live', 'EXAMPLEonly0123456789wxyz')
const TEST_RESTRICTED = fakeKey('rk', 'test', 'EXAMPLEonly0123456789wxyz')

describe('detectKeyMode', () => {
  it('derives mode + kind from the prefix, never from account fields', () => {
    expect(detectKeyMode(LIVE_SECRET)).toEqual({ mode: 'live', kind: 'secret' })
    expect(detectKeyMode(TEST_SECRET)).toEqual({ mode: 'test', kind: 'secret' })
    expect(detectKeyMode(LIVE_RESTRICTED)).toEqual({ mode: 'live', kind: 'restricted' })
    expect(detectKeyMode(TEST_RESTRICTED)).toEqual({ mode: 'test', kind: 'restricted' })
  })

  it('flags a live secret (full-access) key as kind:secret (S4 over-broad scope)', () => {
    const mode = detectKeyMode(LIVE_SECRET)
    expect(mode.kind).toBe('secret')
    expect(mode.mode).toBe('live')
  })

  it('throws on malformed / unsupported input', () => {
    expect(() => detectKeyMode('not-a-key')).toThrow()
    expect(() => detectKeyMode('pk_live_publishable0000000000')).toThrow() // wrong family
    expect(() => detectKeyMode('sk_live_')).toThrow() // recognized prefix, empty body
    expect(() => detectKeyMode('')).toThrow()
    // @ts-expect-error — non-string input must throw, not silently classify
    expect(() => detectKeyMode(undefined)).toThrow()
  })

  it('never echoes the key in its error message (S1)', () => {
    try {
      detectKeyMode('sk_bogus_SHOULDNOTLEAK0000')
      throw new Error('expected detectKeyMode to throw')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      expect(msg).not.toContain('SHOULDNOTLEAK')
    }
  })
})

describe('redact', () => {
  it('reveals no more than the prefix + last 4, masking the entropy between', () => {
    const masked = redact(LIVE_SECRET)
    expect(masked).toBe('sk_live_******abcd')
    expect(masked.startsWith('sk_live_')).toBe(true)
    expect(masked.endsWith('abcd')).toBe(true)
  })

  it('cannot be used to reconstruct the full key', () => {
    const masked = redact(LIVE_SECRET)
    expect(masked).not.toBe(LIVE_SECRET)
    expect(masked.length).toBeLessThan(LIVE_SECRET.length)
    // the entropy body is gone — masked output contains none of it
    expect(masked).not.toContain('EXAMPLEonly0123456789')
  })

  it('fully redacts inputs too short to leave a masked gap', () => {
    expect(redact('sk_live_x')).toBe('<redacted>')
    expect(redact('short')).toBe('<redacted>')
    expect(redact('')).toBe('<redacted>')
  })

  it('is total — never throws on non-string / nullish input', () => {
    // redact accepts `unknown` by design (it runs in error paths).
    expect(redact(undefined)).toBe('<redacted>')
    expect(redact(null)).toBe('<redacted>')
    expect(redact(12345)).toBe('<redacted>')
  })
})
