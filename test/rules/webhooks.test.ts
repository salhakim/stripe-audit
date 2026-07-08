import { describe, it, expect } from 'vitest'
import { isDeepRule } from '../../src/engine'
import { STRIPE_API_VERSION } from '../../src/stripe-client'
import type { RuleScope, SnapshotWebhookEndpoint, StripeAccountSnapshot } from '../../src/types'
import {
  webhookRules,
  WEBHOOK_SELECT_ALL,
  WEBHOOK_ENDPOINT_DISABLED,
  WEBHOOK_TOO_MANY_ENDPOINTS,
  WEBHOOK_DUPLICATE_URL,
  WEBHOOK_INSECURE_URL,
  WEBHOOK_SELECTION_REQUIRED_MISSED,
  WEBHOOK_TEST_ENDPOINT_IN_LIVE,
  WEBHOOK_API_VERSION_MISMATCH,
  DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD,
  BILLING_CRITICAL_EVENTS,
} from '../../src/rules/webhooks'

const BASE_REGIONS = new Set<RuleScope>([
  'account',
  'webhook_endpoints',
  'products',
  'prices',
  'billing_portal',
  'tax',
])

/** A webhook endpoint that is clean for every rule (enabled, https, covers criticals). */
function ep(over: Partial<SnapshotWebhookEndpoint> = {}): SnapshotWebhookEndpoint {
  return {
    id: 'we_1',
    url: 'https://example.com/hook',
    status: 'enabled',
    enabledEvents: [...BILLING_CRITICAL_EVENTS],
    apiVersion: null,
    description: null,
    ...over,
  }
}

function makeSnapshot(over: Partial<StripeAccountSnapshot> = {}): StripeAccountSnapshot {
  return {
    auditScope: 'base',
    accountMode: 'test',
    livemode: false,
    account: {
      id: 'acct_1',
      defaultAccountTaxIds: [],
      statementDescriptor: null,
      branding: { icon: null, logo: null },
      defaultAccountTaxIdsSet: false,
      chargesEnabled: true,
      requirements: null,
    },
    webhookEndpoints: [],
    prices: [],
    portalConfigurations: [],
    taxSettings: { status: 'active', defaultTaxBehavior: null },
    subscriptionSummary: null,
    meters: null,
    thinEventDestinations: null,
    radarSettings: null,
    coupons: null,
    scopeProbe: [],
    truncated: [],
    ...over,
  }
}

/** A snapshot with a single clean enabled endpoint — the canonical "no findings" baseline. */
const cleanSnapshot = () => makeSnapshot({ webhookEndpoints: [ep()] })

describe('webhookRules — requires contract', () => {
  it('every rule declares a non-empty requires over BASE regions including webhook_endpoints', () => {
    expect(webhookRules).toHaveLength(8)
    for (const rule of webhookRules) {
      expect(rule.requires.length).toBeGreaterThan(0)
      expect(rule.requires).toContain('webhook_endpoints')
      for (const scope of rule.requires) {
        expect(BASE_REGIONS.has(scope)).toBe(true)
      }
      // No deep region ⇒ the whole cluster derives to base tier.
      expect(isDeepRule(rule)).toBe(false)
    }
  })

  it('rules reading accountMode also require the account region', () => {
    for (const rule of [WEBHOOK_INSECURE_URL, WEBHOOK_TEST_ENDPOINT_IN_LIVE]) {
      expect(rule.requires).toContain('account')
    }
    // rev 2: API_VERSION_MISMATCH compares to the SDK pin (a constant), not the
    // account default — so it requires only webhook_endpoints.
    expect(WEBHOOK_API_VERSION_MISMATCH.requires).toEqual(['webhook_endpoints'])
  })
})

describe('WEBHOOK_SELECT_ALL', () => {
  it('fires on an enabled endpoint subscribing to * and carries an estimatedImpact', () => {
    const snap = makeSnapshot({ webhookEndpoints: [ep({ enabledEvents: ['*'] })] })
    const findings = WEBHOOK_SELECT_ALL.check(snap)
    expect(findings).toHaveLength(1)
    expect(findings[0].ruleId).toBe('WEBHOOK_SELECT_ALL')
    expect(findings[0].severity).toBe('critical')
    expect(findings[0].estimatedImpact).toBeTruthy()
  })

  it('returns [] on a clean snapshot, and ignores a disabled * endpoint', () => {
    expect(WEBHOOK_SELECT_ALL.check(cleanSnapshot())).toEqual([])
    const disabledStar = makeSnapshot({
      webhookEndpoints: [ep({ status: 'disabled', enabledEvents: ['*'] })],
    })
    expect(WEBHOOK_SELECT_ALL.check(disabledStar)).toEqual([])
  })
})

describe('WEBHOOK_ENDPOINT_DISABLED', () => {
  it('fires on a disabled endpoint (status-only)', () => {
    const snap = makeSnapshot({ webhookEndpoints: [ep({ status: 'disabled' })] })
    const findings = WEBHOOK_ENDPOINT_DISABLED.check(snap)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
  })

  it('returns [] when the endpoint is enabled', () => {
    expect(WEBHOOK_ENDPOINT_DISABLED.check(cleanSnapshot())).toEqual([])
  })
})

describe('WEBHOOK_TOO_MANY_ENDPOINTS', () => {
  const manyEnabled = (n: number) =>
    makeSnapshot({
      webhookEndpoints: Array.from({ length: n }, (_, i) => ep({ id: `we_${i}`, url: `https://h${i}.test/x` })),
    })

  it('uses the documented built-in default when options is undefined', () => {
    // count == default → clean; count == default + 1 → fires.
    expect(WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD))).toEqual([])
    const over = WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD + 1))
    expect(over).toHaveLength(1)
    expect(over[0].severity).toBe('medium')
  })

  it('respects an explicit options.threshold: fires at count > threshold, clean at <= threshold', () => {
    expect(WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(2), { threshold: 2 })).toEqual([])
    expect(WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(3), { threshold: 2 })).toHaveLength(1)
  })

  it('falls back to the default for a non-finite or negative threshold (no false positives)', () => {
    // NaN / Infinity / negative overrides must NOT turn the soft advisory into a
    // false-positive machine — they fall back to DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD.
    for (const bad of [NaN, Infinity, -Infinity, -1, -10] as number[]) {
      // count == default → clean under the fallback (the bad override is ignored).
      expect(
        WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD), { threshold: bad }),
      ).toEqual([])
      // count == default + 1 → fires under the fallback.
      expect(
        WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(DEFAULT_WEBHOOK_ENDPOINT_THRESHOLD + 1), { threshold: bad }),
      ).toHaveLength(1)
    }
  })

  it('honours an explicit threshold of 0 (every enabled endpoint trips the advisory)', () => {
    expect(WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(0), { threshold: 0 })).toEqual([])
    expect(WEBHOOK_TOO_MANY_ENDPOINTS.check(manyEnabled(1), { threshold: 0 })).toHaveLength(1)
  })

  it('counts only ENABLED endpoints', () => {
    const snap = makeSnapshot({
      webhookEndpoints: [
        ...Array.from({ length: 2 }, (_, i) => ep({ id: `e${i}`, url: `https://e${i}.test/x` })),
        ...Array.from({ length: 5 }, (_, i) => ep({ id: `d${i}`, url: `https://d${i}.test/x`, status: 'disabled' })),
      ],
    })
    expect(WEBHOOK_TOO_MANY_ENDPOINTS.check(snap, { threshold: 2 })).toEqual([])
  })
})

describe('WEBHOOK_DUPLICATE_URL', () => {
  it('fires once when two enabled endpoints share a URL', () => {
    const snap = makeSnapshot({
      webhookEndpoints: [
        ep({ id: 'we_a', url: 'https://dup.test/hook' }),
        ep({ id: 'we_b', url: 'https://dup.test/hook' }),
      ],
    })
    expect(WEBHOOK_DUPLICATE_URL.check(snap)).toHaveLength(1)
  })

  it('returns [] for distinct URLs', () => {
    const snap = makeSnapshot({
      webhookEndpoints: [
        ep({ id: 'we_a', url: 'https://a.test/hook' }),
        ep({ id: 'we_b', url: 'https://b.test/hook' }),
      ],
    })
    expect(WEBHOOK_DUPLICATE_URL.check(snap)).toEqual([])
  })
})

describe('WEBHOOK_INSECURE_URL', () => {
  it('fires on a non-HTTPS URL while the account is live', () => {
    const snap = makeSnapshot({ accountMode: 'live', webhookEndpoints: [ep({ url: 'http://example.com/hook' })] })
    const findings = WEBHOOK_INSECURE_URL.check(snap)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
  })

  it('returns [] for HTTPS in live mode and for non-HTTPS in test mode', () => {
    expect(WEBHOOK_INSECURE_URL.check(makeSnapshot({ accountMode: 'live', webhookEndpoints: [ep()] }))).toEqual([])
    const testHttp = makeSnapshot({ accountMode: 'test', webhookEndpoints: [ep({ url: 'http://example.com/hook' })] })
    expect(WEBHOOK_INSECURE_URL.check(testHttp)).toEqual([])
  })
})

describe('WEBHOOK_SELECTION_REQUIRED_MISSED', () => {
  it('fires when no enabled endpoint covers a billing-critical event', () => {
    const snap = makeSnapshot({ webhookEndpoints: [ep({ enabledEvents: ['charge.succeeded'] })] })
    const findings = WEBHOOK_SELECTION_REQUIRED_MISSED.check(snap)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('high')
  })

  it('returns [] when criticals are covered, including via a * subscription', () => {
    expect(WEBHOOK_SELECTION_REQUIRED_MISSED.check(cleanSnapshot())).toEqual([])
    const star = makeSnapshot({ webhookEndpoints: [ep({ enabledEvents: ['*'] })] })
    expect(WEBHOOK_SELECTION_REQUIRED_MISSED.check(star)).toEqual([])
  })

  it('returns [] when there are no enabled endpoints (a different concern, not this rule)', () => {
    expect(WEBHOOK_SELECTION_REQUIRED_MISSED.check(makeSnapshot({ webhookEndpoints: [] }))).toEqual([])
    const allDisabled = makeSnapshot({ webhookEndpoints: [ep({ status: 'disabled', enabledEvents: ['charge.x'] })] })
    expect(WEBHOOK_SELECTION_REQUIRED_MISSED.check(allDisabled)).toEqual([])
  })
})

describe('WEBHOOK_TEST_ENDPOINT_IN_LIVE', () => {
  it('fires on a localhost/tunnel host while live', () => {
    for (const url of ['https://localhost:3000/hook', 'https://abc.ngrok.io/hook', 'https://x.test/hook']) {
      const snap = makeSnapshot({ accountMode: 'live', webhookEndpoints: [ep({ url })] })
      expect(WEBHOOK_TEST_ENDPOINT_IN_LIVE.check(snap)).toHaveLength(1)
    }
  })

  it('returns [] for a production host live, and for a local host in test mode', () => {
    expect(
      WEBHOOK_TEST_ENDPOINT_IN_LIVE.check(makeSnapshot({ accountMode: 'live', webhookEndpoints: [ep()] })),
    ).toEqual([])
    const testLocal = makeSnapshot({ accountMode: 'test', webhookEndpoints: [ep({ url: 'https://localhost/hook' })] })
    expect(WEBHOOK_TEST_ENDPOINT_IN_LIVE.check(testLocal)).toEqual([])
  })
})

describe('WEBHOOK_API_VERSION_MISMATCH', () => {
  // rev 2: baseline is the SDK pin STRIPE_API_VERSION (2026-06-24.dahlia), not a
  // probed account default. Each fixture varies only the endpoint's api_version.
  const withEndpoint = (apiVersion: string | null) =>
    makeSnapshot({ webhookEndpoints: [ep({ apiVersion })] })

  it('does NOT fire when the endpoint apiVersion is null (not pinned)', () => {
    expect(WEBHOOK_API_VERSION_MISMATCH.check(withEndpoint(null))).toEqual([])
  })

  it('fires when the endpoint is pinned older than the SDK pin, citing the pin', () => {
    const findings = WEBHOOK_API_VERSION_MISMATCH.check(withEndpoint('2024-09-30.acacia'))
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('medium')
    expect(findings[0].description).toContain(STRIPE_API_VERSION)
  })

  it('orders by date+codename (delegates to the version helper): an older major fires', () => {
    // acacia is an older MAJOR than the dahlia pin — the rule must defer ordering to
    // the date+codename helper, not a semver/string compare of the raw version.
    expect(WEBHOOK_API_VERSION_MISMATCH.check(withEndpoint('2025-01-01.acacia'))).toHaveLength(1)
  })

  it('does NOT fire when the endpoint is pinned to the current SDK version', () => {
    expect(WEBHOOK_API_VERSION_MISMATCH.check(withEndpoint(STRIPE_API_VERSION))).toEqual([])
  })

  it('fires on a legacy DATE-ONLY pin — the MOST outdated endpoints were previously invisible', () => {
    // Real historical pre-acacia versions carry no codename; before this fix they
    // failed to parse and the rule silently never fired on them.
    const findings = WEBHOOK_API_VERSION_MISMATCH.check(withEndpoint('2022-08-01'))
    expect(findings).toHaveLength(1)
    expect(findings[0].description).toContain('2022-08-01')
    expect(findings[0].description).toContain(STRIPE_API_VERSION)
    expect(WEBHOOK_API_VERSION_MISMATCH.check(withEndpoint('2019-10-17'))).toHaveLength(1)
  })
})

describe('webhook findings — schema completeness', () => {
  it('every emitted finding is schema-complete (non-empty required fields)', () => {
    const triggerAll = makeSnapshot({
      accountMode: 'live',
      webhookEndpoints: [
        ep({ id: 'we_star', url: 'http://localhost/hook', enabledEvents: ['*'] }),
        ep({ id: 'we_old', url: 'http://localhost/hook', apiVersion: '2024-09-30.acacia', enabledEvents: ['charge.x'] }),
      ],
    })
    const findings = webhookRules.flatMap((r) => r.check(triggerAll))
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      expect(f.ruleId).toBeTruthy()
      expect(f.title).toBeTruthy()
      expect(f.description).toBeTruthy()
      expect(f.remediation).toBeTruthy()
      expect(f.docsUrl).toMatch(/^https:\/\//)
      expect(f.category).toBe('webhooks')
      expect(typeof f.affectedResourceType).toBe('string')
    }
  })
})
