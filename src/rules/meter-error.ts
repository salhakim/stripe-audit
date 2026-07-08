/**
 * stripe-audit — meter-error monitoring rule (deep tier).
 *
 * Built per the verify-gate verdict READABLE
 * (`docs/verify-gates/METER_ERROR.md`): both regions — billing meters and v2
 * event destinations — are documented readable schemas, and the thin event the
 * rule listens for (`v1.billing.meter.error_report_triggered`) is a documented
 * v2 event type.
 *
 * Usage-billing accounts lose revenue silently when meter events fail
 * validation: unrecorded usage is unbilled usage. The rule is conditional on
 * meter presence — an account with no active meters has nothing to monitor.
 *
 * `requires: ['meters', 'event_destinations']` are deep regions, so the rule
 * derives to deep tier: base-mode runs SKIP it.
 */
import { defineRule } from '../define-rule'
import type { Rule } from '../types'
import { buildFinding } from './_finding'
import { DOCS } from './_docs'

/** The v2 thin event fired when meter events fail (see METER_ERROR.md evidence). */
const METER_ERROR_EVENT = 'v1.billing.meter.error_report_triggered'

/** Active meters exist but no enabled destination listens for meter error reports. */
export const METER_ERROR_NOT_MONITORED: Rule = defineRule({
  id: 'METER_ERROR_NOT_MONITORED',
  name: 'Meter error reports are not monitored',
  severity: 'high',
  category: 'billing',
  requires: ['meters', 'event_destinations'],
  check: (snapshot) => {
    // meters null (unreadable) or no active meter = nothing to monitor → never a
    // finding. Null destinations with active meters DOES fire: no readable listener
    // evidence means monitoring is unproven (fail-safe; the engine already skips the
    // whole rule with 'deep-scope-not-granted' when the scope was genuinely denied).
    const activeMeters = (snapshot.meters ?? []).filter((m) => m.status === 'active')
    if (activeMeters.length === 0) return []
    const listened = (snapshot.thinEventDestinations ?? []).some(
      (dest) =>
        dest.status === 'enabled' &&
        (dest.enabledEvents.includes('*') || dest.enabledEvents.includes(METER_ERROR_EVENT)),
    )
    if (listened) return []
    // Bound the enumerated names — a usage-billing fleet can carry hundreds of meters.
    const names = activeMeters.slice(0, 5).map((m) => m.eventName)
    const overflow = activeMeters.length - names.length
    return [
      buildFinding(METER_ERROR_NOT_MONITORED, {
        title: `${activeMeters.length} active meter${activeMeters.length === 1 ? '' : 's'} with no meter-error listener`,
        description:
          `The account bills usage through ${activeMeters.length} active billing ` +
          `meter${activeMeters.length === 1 ? '' : 's'} (${names.join(', ')}${overflow > 0 ? `, +${overflow} more` : ''}), ` +
          `but no enabled event destination listens for '${METER_ERROR_EVENT}'. Meter events that fail ` +
          'validation are silently dropped — unrecorded usage is unbilled revenue, and nothing alerts you.',
        remediation:
          `Create (or enable) an event destination subscribed to '${METER_ERROR_EVENT}' and wire it to ` +
          'your alerting, so failed meter events surface instead of silently costing revenue.',
        docsUrl: DOCS.eventDestinations,
        affectedResourceId: null,
        affectedResourceType: 'account',
      }),
    ]
  },
})

/** The meter-error cluster (deep tier — skipped in base mode). */
export const meterErrorRules: Rule[] = [METER_ERROR_NOT_MONITORED]
