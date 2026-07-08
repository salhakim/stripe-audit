import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { formatRuleList } from '../src/cli'
import { deepRules } from '../src/rules/index'
import { DEEP_SCOPE_PARAMS } from '../src/deep-link'

/**
 * Docs that claim lockstep with the registry must BE in lockstep mechanically
 * (COVERAGE.md rotted within weeks when the claim was promise-only). Two guards:
 *
 * 1. The `--list-rules` fenced blocks in docs/rules.md and COVERAGE.md are the
 *    verbatim output of formatRuleList(). When a rule is added/renamed, this
 *    fails until the block is re-pasted from the CLI.
 * 2. Every deep scope a shipped deep rule `requires` has a dashboard permission
 *    name in DEEP_SCOPE_PARAMS — otherwise the missing-scope notice and the
 *    onboarding checklist silently omit the permission and users build keys
 *    that permanently skip the rule — exactly the failure mode this guard exists to stop.
 */

const BASE_REGIONS = new Set(['account', 'webhook_endpoints', 'products', 'prices', 'billing_portal', 'tax'])

describe('docs ↔ registry lockstep', () => {
  it.each(['docs/rules.md', 'COVERAGE.md'])(
    '%s --list-rules block matches formatRuleList() verbatim',
    (doc) => {
      const text = readFileSync(new URL(`../${doc}`, import.meta.url), 'utf8')
      expect(
        text.includes(formatRuleList()),
        `${doc} --list-rules block is stale — re-paste it from \`npx stripe-audit --list-rules\``,
      ).toBe(true)
    },
  )

  it('every deep rule id appears in docs/scopes-reference.md', () => {
    const text = readFileSync(new URL('../docs/scopes-reference.md', import.meta.url), 'utf8')
    for (const rule of deepRules) {
      expect(text, `docs/scopes-reference.md missing deep rule ${rule.id}`).toContain(rule.id)
    }
  })
})

describe('DEEP_SCOPE_PARAMS ↔ deep-rule requires lockstep', () => {
  it('every deep scope a shipped deep rule requires maps to a dashboard permission name', () => {
    const deepScopesRequired = new Set(
      deepRules.flatMap((rule) => rule.requires).filter((scope) => !BASE_REGIONS.has(scope)),
    )
    for (const scope of deepScopesRequired) {
      expect(
        Object.hasOwn(DEEP_SCOPE_PARAMS, scope),
        `DEEP_SCOPE_PARAMS missing '${scope}' — the missing-scope notice and onboarding checklist would omit it`,
      ).toBe(true)
    }
    expect(deepScopesRequired.size).toBeGreaterThan(0)
  })
})
