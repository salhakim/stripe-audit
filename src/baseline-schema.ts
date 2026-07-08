/**
 * stripe-audit — runtime validation schema for a {@link Baseline} file.
 *
 * This zod schema mirrors the {@link Baseline} interface EXACTLY (same fields,
 * same grade enum) — the same single-chokepoint discipline as the
 * snapshot-schema. The CLI is the ONLY baseline file-I/O site: it parses
 * every loaded baseline through `baselineSchema.parse()` before comparing, so a
 * malformed / old-shape baseline throws a `ZodError` at one place rather than
 * propagating a bad shape into `compareBaseline`.
 *
 * Mirror enforcement is two-sided (same as the snapshot-schema): `writeBaseline`'s output is
 * assignable to the schema OUTPUT type (a dropped field fails typecheck), and the
 * baseline test parses a `writeBaseline` result (an EXTRA required field fails at
 * runtime). Keep `GRADE_VALUES` in lockstep with the `Grade` union in `./score`.
 */
import { z } from 'zod'

/** The letter grades a baseline may carry — mirrors the `Grade` union in `./score`. */
const GRADE_VALUES = ['A', 'B', 'C', 'D', 'F'] as const

/** Severity tokens a baseline filter may carry — mirrors the `Severity` union in `./types`. */
const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low', 'info'] as const

/** Category tokens a baseline filter may carry — mirrors the `Category` union in `./types`. */
const CATEGORY_VALUES = [
  'webhooks',
  'billing',
  'security',
  'configuration',
  'payments',
  'pricing',
] as const

/** The single validation chokepoint for a baseline file — mirrors {@link Baseline}. */
export const baselineSchema = z.object({
  /** Pinned Stripe API version the baseline was captured under. */
  apiVersion: z.string(),
  /** ISO-8601 timestamp the baseline was written. */
  createdAt: z.string(),
  /** 0–100 health score at capture time. */
  score: z.number(),
  /** Letter grade at capture time. */
  grade: z.enum(GRADE_VALUES),
  /** Stable per-finding fingerprints of the ACTIVE findings at capture time. */
  fingerprints: z.array(z.string()),
  /**
   * OPTIONAL rule-filter scope the baseline was captured under —
   * mirrors `Baseline.filter` / `RuleFilter`. A baseline file predating this
   * field carries none and parses clean, reading as unfiltered/full.
   */
  filter: z
    .object({
      severity: z.array(z.enum(SEVERITY_VALUES)).optional(),
      category: z.array(z.enum(CATEGORY_VALUES)).optional(),
    })
    .optional(),
})

/** The baseline type as derived from the schema (must equal {@link Baseline}). */
export type ParsedBaseline = z.infer<typeof baselineSchema>
