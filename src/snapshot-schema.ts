/**
 * stripe-audit — runtime validation schema for {@link StripeAccountSnapshot}.
 *
 * This zod schema mirrors the snapshot interface EXACTLY (same fields, same enums,
 * same nullability, including the v0.2 deep-region seams). The fetcher validates
 * every snapshot through `stripeAccountSnapshotSchema.parse()` before returning,
 * so a malformed snapshot throws a `ZodError` at the single validation chokepoint
 * rather than propagating a bad shape into the rule engine.
 *
 * Mirror enforcement is two-sided: the fetcher does `return schema.parse(typed)`,
 * which fails typecheck if the schema OUTPUT type is not assignable to
 * StripeAccountSnapshot (catches a missing field); the schema test parses a valid
 * base fixture, which fails at runtime if the schema requires an EXTRA field.
 */
import { z } from 'zod'

const ruleScopeSchema = z.enum([
  // base-6
  'account',
  'webhook_endpoints',
  'products',
  'prices',
  'billing_portal',
  'tax',
  // deep-5
  'subscriptions',
  'radar',
  'meters',
  'event_destinations',
  'coupons',
])

const scopeGrantSchema = z.object({
  scope: ruleScopeSchema,
  granted: z.boolean(),
})

const accountBrandingSchema = z.object({
  icon: z.string().nullable(),
  logo: z.string().nullable(),
})

const snapshotAccountSchema = z.object({
  id: z.string(),
  defaultAccountTaxIds: z.array(z.string()),
  statementDescriptor: z.string().nullable(),
  branding: accountBrandingSchema,
  defaultAccountTaxIdsSet: z.boolean(),
  chargesEnabled: z.boolean(),
  requirements: z
    .object({ currentlyDue: z.array(z.string()), disabledReason: z.string().nullable() })
    .nullable(),
})

const snapshotWebhookEndpointSchema = z.object({
  id: z.string(),
  url: z.string(),
  status: z.enum(['enabled', 'disabled']),
  enabledEvents: z.array(z.string()),
  apiVersion: z.string().nullable(),
  description: z.string().nullable(),
})

const snapshotProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  defaultPrice: z.string().nullable(),
})

const snapshotPriceSchema = z.object({
  id: z.string(),
  active: z.boolean(),
  taxBehavior: z.string().nullable(),
  currency: z.string(),
  unitAmount: z.number().nullable(),
  type: z.enum(['one_time', 'recurring']),
  recurring: z
    .object({ interval: z.string(), intervalCount: z.number() })
    .nullable(),
  nickname: z.string().nullable(),
  lookupKey: z.string().nullable(),
  customUnitAmount: z.object({ minimum: z.number().nullable() }).nullable(),
  currencyOptions: z.array(z.string()),
  product: snapshotProductSchema,
})

const snapshotPortalConfigurationSchema = z.object({
  id: z.string(),
  isDefault: z.boolean(),
  customerUpdate: z.boolean(),
  invoiceHistory: z.boolean(),
  paymentMethodUpdate: z.boolean(),
  subscriptionCancel: z.boolean(),
  subscriptionUpdate: z.boolean(),
  loginPage: z.boolean(),
  subscriptionUpdateProration: z.string().nullable(),
})

const snapshotTaxSettingsSchema = z.object({
  status: z.enum(['active', 'pending']),
  defaultTaxBehavior: z.string().nullable(),
})

// ── deep-region seams: each `.nullable()` so a base-mode snapshot (all five null)
//    parses clean, and a future deep snapshot also parses. ──
const subscriptionSummarySchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  byBillingMode: z.record(z.string(), z.number()),
  // REQUIRED, not .optional(): an optional field would let a future fetcher
  // silently omit the aggregate and TRIAL_WITHOUT_PAYMENT_COLLECTION would
  // silently never fire — the exact failure the mirror-schema discipline exists
  // to prevent. Every deep fixture carries it.
  byTrialEndBehavior: z.record(z.string(), z.number()),
  // REQUIRED for the same reason as byTrialEndBehavior: an omitted aggregate
  // must fail validation, not silently disable SUBSCRIPTION_COLLECTION_PAUSED.
  pausedCollectionCount: z.number(),
})

const snapshotMeterSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  status: z.string(),
  eventName: z.string(),
})

const thinEventDestinationSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  enabledEvents: z.array(z.string()),
})

const radarSettingsSchema = z.object({
  setupIntentsProtected: z.boolean(),
})

const snapshotCouponSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  percentOff: z.number().nullable(),
  amountOff: z.number().nullable(),
  currency: z.string().nullable(),
  duration: z.string(),
  valid: z.boolean(),
  appliesToProducts: z.array(z.string()).nullable(),
})

/** The single validation chokepoint for a snapshot — mirrors StripeAccountSnapshot. */
export const stripeAccountSnapshotSchema = z.object({
  auditScope: z.enum(['base', 'deep']),
  accountMode: z.enum(['test', 'live']),
  livemode: z.boolean(),

  account: snapshotAccountSchema,
  webhookEndpoints: z.array(snapshotWebhookEndpointSchema),
  prices: z.array(snapshotPriceSchema),
  portalConfigurations: z.array(snapshotPortalConfigurationSchema),
  taxSettings: snapshotTaxSettingsSchema.nullable(),

  subscriptionSummary: subscriptionSummarySchema.nullable(),
  meters: z.array(snapshotMeterSchema).nullable(),
  thinEventDestinations: z.array(thinEventDestinationSchema).nullable(),
  radarSettings: radarSettingsSchema.nullable(),
  coupons: z.array(snapshotCouponSchema).nullable(),

  scopeProbe: z.array(scopeGrantSchema),
  truncated: z.array(ruleScopeSchema),
})

/** The snapshot type as derived from the schema (must equal StripeAccountSnapshot). */
export type ParsedSnapshot = z.infer<typeof stripeAccountSnapshotSchema>
