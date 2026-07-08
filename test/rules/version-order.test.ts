import { describe, it, expect } from 'vitest'
import {
  MAJOR_RELEASES,
  CEILING_CODENAME,
  parseApiVersion,
  compareApiVersions,
  isOlderApiVersion,
  majorsBehind,
} from '../../src/rules/version-order'

const ACACIA = '2024-09-30.acacia'
const BASIL = '2025-03-31.basil'
const DAHLIA = '2026-06-24.dahlia'

describe('MAJOR_RELEASES', () => {
  it('is ordered oldest → newest with the pinned ceiling last', () => {
    expect(MAJOR_RELEASES.map((r) => r.codename)).toEqual(['acacia', 'basil', 'clover', 'dahlia'])
    expect(CEILING_CODENAME).toBe('dahlia')
  })
})

describe('parseApiVersion', () => {
  it('parses a well-formed date+codename version', () => {
    expect(parseApiVersion(DAHLIA)).toEqual({ date: '2026-06-24', codename: 'dahlia' })
  })

  it('parses a legacy DATE-ONLY version with codename: null', () => {
    expect(parseApiVersion('2022-08-01')).toEqual({ date: '2022-08-01', codename: null })
    expect(parseApiVersion('2019-10-17')).toEqual({ date: '2019-10-17', codename: null })
  })

  it('returns null for null/undefined/malformed input', () => {
    expect(parseApiVersion(null)).toBeNull()
    expect(parseApiVersion(undefined)).toBeNull()
    expect(parseApiVersion('')).toBeNull()
    expect(parseApiVersion('dahlia')).toBeNull() // no date
    expect(parseApiVersion('2026-6-24.dahlia')).toBeNull() // non-ISO date
    expect(parseApiVersion('2026-06-24.')).toBeNull() // trailing dot, empty codename
    expect(parseApiVersion('not a version')).toBeNull()
  })
})

describe('compareApiVersions', () => {
  it('orders by major release: older < newer', () => {
    expect(compareApiVersions(ACACIA, BASIL)).toBeLessThan(0)
    expect(compareApiVersions(DAHLIA, ACACIA)).toBeGreaterThan(0)
  })

  it('returns 0 for the same version', () => {
    expect(compareApiVersions(DAHLIA, DAHLIA)).toBe(0)
  })

  it('orders by CODENAME index, not by date (same date, different codename)', () => {
    // Artificial: same calendar date, different majors. The major index — not the
    // date — must decide, proving ordering is NOT a semver/date-only compare.
    expect(compareApiVersions('2025-01-01.acacia', '2025-01-01.basil')).toBeLessThan(0)
    expect(compareApiVersions('2025-01-01.basil', '2025-01-01.acacia')).toBeGreaterThan(0)
  })

  it('breaks ties within one major by date (monthly releases share a codename)', () => {
    expect(compareApiVersions('2025-04-30.basil', '2025-03-31.basil')).toBeGreaterThan(0)
    expect(compareApiVersions('2025-03-31.basil', '2025-04-30.basil')).toBeLessThan(0)
  })

  it('falls back to date order for an unknown (future) codename', () => {
    const future = '2027-01-01.elderberry' // not in MAJOR_RELEASES
    expect(compareApiVersions(future, DAHLIA)).toBeGreaterThan(0)
    expect(compareApiVersions(ACACIA, future)).toBeLessThan(0)
  })

  it('returns null when either side is null or malformed', () => {
    expect(compareApiVersions(null, DAHLIA)).toBeNull()
    expect(compareApiVersions(DAHLIA, undefined)).toBeNull()
    expect(compareApiVersions('garbage', DAHLIA)).toBeNull()
  })

  it('orders a DATE-ONLY version older than EVERY codenamed major (index −1)', () => {
    expect(compareApiVersions('2022-08-01', ACACIA)).toBeLessThan(0)
    expect(compareApiVersions('2022-08-01', DAHLIA)).toBeLessThan(0)
    expect(compareApiVersions(DAHLIA, '2022-08-01')).toBeGreaterThan(0)
    // Even a date-only version DATED AFTER a major's release date stays older —
    // the ladder index, not the date, decides (historically impossible input,
    // but the ordering stays total and deterministic).
    expect(compareApiVersions('2025-01-01', ACACIA)).toBeLessThan(0)
  })

  it('orders two DATE-ONLY versions by date (the pre-major era ties on index −1)', () => {
    expect(compareApiVersions('2019-10-17', '2022-08-01')).toBeLessThan(0)
    expect(compareApiVersions('2022-08-01', '2019-10-17')).toBeGreaterThan(0)
    expect(compareApiVersions('2022-08-01', '2022-08-01')).toBe(0)
  })
})

describe('isOlderApiVersion', () => {
  it('is true for a date-only version vs any codenamed major; no false positive on equal', () => {
    expect(isOlderApiVersion('2022-08-01', DAHLIA)).toBe(true)
    expect(isOlderApiVersion('2019-10-17', ACACIA)).toBe(true)
    expect(isOlderApiVersion('2022-08-01', '2022-08-01')).toBe(false)
    expect(isOlderApiVersion(DAHLIA, '2022-08-01')).toBe(false)
  })

  it('is true only when strictly older', () => {
    expect(isOlderApiVersion(ACACIA, DAHLIA)).toBe(true)
    expect(isOlderApiVersion(DAHLIA, ACACIA)).toBe(false)
    expect(isOlderApiVersion(DAHLIA, DAHLIA)).toBe(false)
  })

  it('is false (never "older") when not determinable', () => {
    expect(isOlderApiVersion(null, DAHLIA)).toBe(false)
    expect(isOlderApiVersion('malformed', DAHLIA)).toBe(false)
  })
})

describe('majorsBehind', () => {
  it('counts whole majors behind the ceiling', () => {
    expect(majorsBehind(ACACIA, DAHLIA)).toBe(3)
    expect(majorsBehind(BASIL, DAHLIA)).toBe(2)
    expect(majorsBehind('2025-09-01.clover', DAHLIA)).toBe(1)
    expect(majorsBehind(DAHLIA, DAHLIA)).toBe(0)
  })

  it('clamps to 0 for a version newer than the ceiling', () => {
    expect(majorsBehind(DAHLIA, BASIL)).toBe(0)
  })

  it('counts a DATE-ONLY version as the FULL ladder depth behind the ceiling (index −1)', () => {
    // ceiling dahlia is index 3 → a pre-acacia pin is 3 − (−1) = 4 majors behind,
    // so API_VERSION_OUTDATED fires maximally on the most outdated pins.
    expect(majorsBehind('2022-08-01', DAHLIA)).toBe(4)
    expect(majorsBehind('2019-10-17', DAHLIA)).toBe(4)
    expect(majorsBehind('2022-08-01', ACACIA)).toBe(1)
  })

  it('returns null when undeterminable (null/malformed/unknown codename)', () => {
    expect(majorsBehind(null, DAHLIA)).toBeNull()
    expect(majorsBehind('malformed', DAHLIA)).toBeNull()
    expect(majorsBehind('2027-01-01.elderberry', DAHLIA)).toBeNull()
    expect(majorsBehind(ACACIA, '2027-01-01.elderberry')).toBeNull()
  })
})
