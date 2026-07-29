/**
 * stripe-audit — runtime validation schema for a config file.
 *
 * The zod mirror of the published JSON Schema
 * (`schemas/stripe-audit.config.schema.json`) — same keys, same enums, same
 * `additionalProperties: false` strictness. `strictObject` REJECTS unknown keys
 * rather than stripping them, so the JSON form can never smuggle a `plugins`
 * key past validation — that is the data/code trust boundary SECURITY.md
 * documents (a data file must never register executable code).
 *
 * Follows the baseline-schema discipline: this schema is the single
 * validation chokepoint for config-file content; the CLI loader
 * (`./load-config`) is the only file-I/O site; enum arrays mirror their unions
 * in lockstep (keep them in sync with `FailOnLevel`, `OutputFormat`,
 * `Severity`, and `Category`).
 *
 * `severity` / `category` carry `.min(1)` — an empty list would select no
 * rules and grade a run that audited nothing (the bug #9 false-assurance
 * sibling), so both the published schema (`minItems: 1`) and this mirror
 * reject it.
 */
import { z } from 'zod'
import {
  LIST_ITEMS_CEILING,
  MAX_LIST_ITEMS,
  REQUEST_TIMEOUT_MS,
  MAX_NETWORK_RETRIES,
} from './defaults'

/** `failOn` thresholds a config may carry — mirrors the `FailOnLevel` union in `../exit-codes`. */
const FAIL_ON_VALUES = ['critical', 'high', 'medium', 'low', 'none'] as const

/** `output` formats a config may carry — mirrors the `OutputFormat` union in `../report`. */
const OUTPUT_VALUES = ['json', 'markdown', 'html', 'console', 'badge'] as const

/** Severity tokens a config filter may carry — mirrors the `Severity` union in `../types`. */
const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low', 'info'] as const

/** Category tokens a config filter may carry — mirrors the `Category` union in `../types`. */
const CATEGORY_VALUES = [
  'webhooks',
  'billing',
  'security',
  'configuration',
  'payments',
  'pricing',
] as const

/**
 * The settings keys BOTH config forms may carry (Sal's fork resolution:
 * executable configs may carry settings — one file serves the
 * plugin-author-with-settings use case). Spread into both schemas so the two
 * forms can never drift.
 *
 * The three operational knobs (`maxListItems` / `requestTimeoutMs` /
 * `maxNetworkRetries`) carry `.default(<constant>)` WITHOUT `.optional()`: unlike
 * the CLI-mirrored keys above them (whose fallback is supplied downstream by the
 * flag merge), these must always resolve to a concrete number when a file is
 * loaded, so `.default()` REPLACES a missing key with today's constant
 * (byte-unchanged behavior) while a present-but-out-of-range value still fails
 * loud as a `ZodError` → `ConfigError` → exit 2. Bounds + defaults are imported
 * from `./defaults` so the schema and the runtime fallbacks cannot drift.
 */
const settingsShape = {
  /** Mirrors `--fail-on`. */
  failOn: z.enum(FAIL_ON_VALUES).optional(),
  /** Mirrors `--deep`. */
  deep: z.boolean().optional(),
  /** Suppression patterns, union-merged with `--ignore` + `.stripeauditignore`. */
  ignore: z.array(z.string()).optional(),
  /** Baseline file path, resolved against the config working directory. Mirrors `--baseline`. */
  baseline: z.string().optional(),
  /** Mirrors `--output`. */
  output: z.enum(OUTPUT_VALUES).optional(),
  /** Mirrors `--severity` (E1a: an empty list is rejected — it would select no rules). */
  severity: z.array(z.enum(SEVERITY_VALUES)).min(1).optional(),
  /** Mirrors `--category` (E1a: an empty list is rejected — it would select no rules). */
  category: z.array(z.enum(CATEGORY_VALUES)).min(1).optional(),
  /** Per-list item cap; `1..LIST_ITEMS_CEILING` (one below the SDK autopage ceiling so `cap+1` stays legal). */
  maxListItems: z.number().int().min(1).max(LIST_ITEMS_CEILING).default(MAX_LIST_ITEMS),
  /** Per-request timeout in ms; `1..600_000`. */
  requestTimeoutMs: z.number().int().min(1).max(600_000).default(REQUEST_TIMEOUT_MS),
  /** SDK network-retry count; `0..10` (`0` disables automatic retries). */
  maxNetworkRetries: z.number().int().min(0).max(10).default(MAX_NETWORK_RETRIES),
}

/**
 * The single validation chokepoint for a JSON config file — mirrors the
 * published `schemas/stripe-audit.config.schema.json` exactly.
 */
export const configFileSchema = z.strictObject({
  /** Editor-autocomplete reference to the published schema — accepted, never acted on. */
  $schema: z.string().optional(),
  ...settingsShape,
})

/** A validated config file as parsed from disk (including the inert `$schema` key). */
export type ConfigFile = z.infer<typeof configFileSchema>

/** The settings a loaded config contributes to the run (the `$schema` reference dropped). */
export type ConfigFileSettings = Omit<ConfigFile, '$schema'>

/**
 * Complete structural check for one plugin rule. A rule that slips
 * through half-shaped is a false-assurance hazard: a typo'd severity would
 * silently drop the rule from `--severity`/`--category` filters, and a missing
 * name/category reaches reporters via the engine's error-containment finding.
 * `z.custom` (not an object schema) because `check` is a function — zod cannot
 * model the call signature; id collision + cross-rule constraints stay in
 * `resolveRules`.
 */
const pluginRuleSchema = z.custom<import('../types').Rule>(
  (value) => {
    if (typeof value !== 'object' || value === null) return false
    const rule = value as Record<string, unknown>
    return (
      typeof rule.id === 'string' &&
      typeof rule.name === 'string' &&
      (SEVERITY_VALUES as readonly string[]).includes(rule.severity as string) &&
      (CATEGORY_VALUES as readonly string[]).includes(rule.category as string) &&
      Array.isArray(rule.requires) &&
      rule.requires.length > 0 &&
      rule.requires.every((scope) => typeof scope === 'string') &&
      typeof rule.check === 'function'
    )
  },
  'each rule must be a complete Rule: string id and name, a valid severity and category, a non-empty requires list, and a check function',
)

/**
 * The default-exported manifest an EXECUTABLE config must satisfy:
 * `{ meta?, rules? }` (the documented plugin-manifest convention — `meta.name`
 * becomes the resolve key) or `{ plugins: [{ key, rules }] }` pass-through,
 * either optionally carrying the same 7 settings keys as the JSON form.
 * `strictObject` keeps typo'd keys fail-loud, same as the JSON branch.
 */
export const executableManifestSchema = z.strictObject({
  /** Plugin identity — `meta.name` namespaces the manifest's `rules`. Extra meta keys allowed. */
  meta: z
    .looseObject({
      name: z.string().min(1),
      version: z.string().optional(),
      apiVersion: z.number().optional(),
    })
    .optional(),
  /** Rules namespaced under `meta.name` (the single-plugin manifest convention). */
  rules: z.array(pluginRuleSchema).optional(),
  /** Explicit multi-plugin pass-through — feeds `resolveRules` unchanged. */
  plugins: z
    .array(
      z.strictObject({
        key: z.string().min(1),
        rules: z.array(pluginRuleSchema),
      }),
    )
    .optional(),
  ...settingsShape,
})

/** A validated executable-config manifest. */
export type ExecutableManifest = z.infer<typeof executableManifestSchema>
