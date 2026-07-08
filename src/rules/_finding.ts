/**
 * stripe-audit — Finding factory.
 *
 * `buildFinding` is the single constructor every rule uses to emit a
 * {@link Finding}. It pulls `ruleId` / `severity` / `category` straight off the
 * owning rule (so those three never drift from the rule's own declaration) and
 * defaults the account-wide fields, leaving each call site to specify only what is
 * finding-specific. The catalog meta-test asserts every emitted Finding is
 * schema-complete; routing all findings through this one factory is what makes that
 * guarantee mechanical rather than per-rule discipline.
 *
 * Usage (self-reference is safe — the arrow runs at audit time, long after the
 * rule const is initialized):
 *
 *   const WEBHOOK_SELECT_ALL: Rule = defineRule({
 *     id: 'WEBHOOK_SELECT_ALL', severity: 'critical', category: 'webhooks', ...,
 *     check: (s) => s.webhookEndpoints.filter(...).map((ep) =>
 *       buildFinding(WEBHOOK_SELECT_ALL, {
 *         title: `Endpoint ${ep.url} subscribes to all events`,
 *         description: '...', remediation: '...', docsUrl: DOCS.webhooks,
 *         affectedResourceId: ep.id, affectedResourceType: 'webhook_endpoint',
 *       })),
 *   })
 */
import type { Finding, Rule } from '../types'

/** The finding-specific half of a {@link Finding} — everything not derived from the rule. */
export interface FindingSpec {
  title: string
  description: string
  remediation: string
  docsUrl: string
  /** The resource the finding is about; omit (or null) for an account-wide finding. */
  affectedResourceId?: string | null
  /** The resource kind; defaults to `'account'` for account-wide findings. */
  affectedResourceType?: string
  /** Optional human-readable revenue/impact estimate, e.g. "~$X/mo at risk". */
  estimatedImpact?: string
}

/**
 * Construct a schema-complete {@link Finding}, deriving `ruleId` / `severity` /
 * `category` from `rule` and defaulting the account-wide fields.
 *
 * `estimatedImpact` is included only when provided, so the emitted object matches
 * the optional-property contract exactly (no `estimatedImpact: undefined` key).
 */
export function buildFinding(
  rule: Pick<Rule, 'id' | 'severity' | 'category'>,
  spec: FindingSpec,
): Finding {
  const finding: Finding = {
    ruleId: rule.id,
    severity: rule.severity,
    category: rule.category,
    title: spec.title,
    affectedResourceId: spec.affectedResourceId ?? null,
    affectedResourceType: spec.affectedResourceType ?? 'account',
    description: spec.description,
    remediation: spec.remediation,
    docsUrl: spec.docsUrl,
  }
  if (spec.estimatedImpact !== undefined) {
    finding.estimatedImpact = spec.estimatedImpact
  }
  return finding
}
