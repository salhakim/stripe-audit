/**
 * The published JSON config schema is a valid draft-07 schema and
 * enforces the zero-code config surface.
 *
 * Validates the schema itself against the draft-07 meta-schema (ajv.validateSchema),
 * then compiles it and checks representative accept/reject behavior — including the
 * trust-boundary invariant that the JSON form exposes NO plugin/module-loading
 * property (a data file must never register executable code). ajv 6 is used (already
 * present transitively); a single compile() call avoids ajv's duplicate-$id guard.
 */
import { describe, it, expect } from 'vitest'
import Ajv from 'ajv'
import schema from '../../schemas/stripe-audit.config.schema.json'
import { configFileSchema } from '../../src/config/config-schema'

describe('stripe-audit.config.schema.json', () => {
  const ajv = new Ajv()
  const validate = ajv.compile(schema)

  it('is itself a valid draft-07 JSON Schema', () => {
    expect(ajv.validateSchema(schema)).toBe(true)
  })

  it('accepts a representative valid config', () => {
    expect(
      validate({ failOn: 'high', ignore: ['WEBHOOK_SELECT_ALL'], deep: true }),
    ).toBe(true)
  })

  it('accepts a config carrying its own $schema reference', () => {
    expect(
      validate({
        $schema: './node_modules/stripe-audit/schemas/stripe-audit.config.schema.json',
        failOn: 'critical',
      }),
    ).toBe(true)
  })

  it('rejects a bad failOn enum value', () => {
    expect(validate({ failOn: 'bogus' })).toBe(false)
  })

  it('rejects an unknown top-level key (additionalProperties:false drives autocomplete)', () => {
    expect(validate({ notARealKey: true })).toBe(false)
  })

  it('exposes no plugin/module-loading property (trust boundary)', () => {
    const props = Object.keys((schema as { properties?: Record<string, unknown> }).properties ?? {})
    expect(props.filter((p) => /plugin|module|require|import/i.test(p))).toEqual([])
  })

  it('rejects an EMPTY severity/category list (selects no rules)', () => {
    expect(validate({ severity: [] })).toBe(false)
    expect(validate({ category: [] })).toBe(false)
    expect(validate({ severity: ['low'], category: ['billing'] })).toBe(true)
  })

  it('publishes the PUBLIC repo $id — never the private working-repo URL', () => {
    const id = (schema as { $id?: string }).$id ?? ''
    expect(id).toContain('salhakim/stripe-audit/')
    expect(id).not.toContain('billing-audit-kit')
  })

  // ── C18 operational knobs: JSON schema ↔ zod mirror lockstep ──
  it('accepts the three operational knobs and enforces their bounds', () => {
    expect(validate({ maxListItems: 5000, requestTimeoutMs: 30000, maxNetworkRetries: 0 })).toBe(
      true,
    )
    expect(validate({ maxListItems: 10000 })).toBe(false) // one over the SDK ceiling
    expect(validate({ maxListItems: 0 })).toBe(false) // below minimum
    expect(validate({ requestTimeoutMs: 600001 })).toBe(false) // over maximum
    expect(validate({ maxNetworkRetries: 11 })).toBe(false) // over maximum
    expect(validate({ requestTimeoutMs: 1.5 })).toBe(false) // not an integer
  })

  it('a knob-carrying config validates against BOTH the JSON schema and the zod mirror', () => {
    const sample = { maxListItems: 5000, requestTimeoutMs: 12345, maxNetworkRetries: 3 }
    expect(validate(sample)).toBe(true)
    expect(configFileSchema.safeParse(sample).success).toBe(true)
    // Both reject the same over-ceiling value — the mirror cannot drift silently.
    expect(validate({ maxListItems: 10000 })).toBe(false)
    expect(configFileSchema.safeParse({ maxListItems: 10000 }).success).toBe(false)
  })
})
