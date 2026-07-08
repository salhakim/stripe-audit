/**
 * stripe-audit — command-line entry point (commander spine + flags).
 *
 * Establishes the full CLI surface and the audit ORCHESTRATION SPINE:
 *
 *   loadConfig → resolveRules → fetch → runRules → applySuppressions → baseline → score → exit
 *
 * Each stage is a named call-site here; dedicated modules own the bodies — the
 * exit-code gate (`--fail-on` over active findings), `applySuppressions`
 * (`.stripeauditignore` + `--ignore`), the no-key onboarding panel,
 * the restricted-key deep link, key-prefix coaching, the live-audit
 * fetch + plain-language 401 translation, and the config-file + baseline
 * bodies. This module WIRES the ordered stages and registers every flag.
 *
 * SECURITY: the resolved key is NEVER echoed, logged, or rendered. `--demo` and
 * `--list-rules` short-circuit BEFORE any key resolution (keyless, no network).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Command } from 'commander'
import { ZodError } from 'zod'
import { VERSION, STRIPE_API_VERSION } from './index'
import { runRules, isDeepRule, type RuleFilter } from './engine'
import { compareBaseline, sameFilterScope, writeBaseline, type Baseline } from './baseline'
import { baselineSchema } from './baseline-schema'
import { resolveRules, RuleResolutionError } from './config/resolve-rules'
import {
  loadConfig,
  coreOnlyConfig,
  ConfigError,
  type LoadedConfig,
} from './config/load-config'
import { ALL_RULES } from './rules/index'
import { DROPPED_RULES } from './rules/dropped'
import { buildAuditResult, describeFilter, type AuditResult } from './report/result'
import { renderReport, isOutputFormat, OUTPUT_FORMATS, type OutputFormat } from './report'
import {
  EXIT_OK,
  EXIT_FINDINGS,
  EXIT_CONFIG,
  EXIT_RUNTIME,
  exitCodeForFindings,
  isFailOnLevel,
  DEFAULT_FAIL_ON,
  FAIL_ON_LEVELS,
  type FailOnLevel,
} from './exit-codes'
import { applyIgnore, findUnusedSuppressions, loadIgnoreFile } from './suppress'
import { renderOnboardingPanel } from './onboarding'
import { buildDeepRestrictedKeyLink, DEEP_SCOPE_PARAMS, type DeepScopeId } from './deep-link'
import { coachKeyPrefix } from './coaching'
import { translateStripeError } from './errors'
import { createStripeClient } from './stripe-client'
import { fetchAccountSnapshot } from './fetcher'
import type { Rule, Severity, Category, StripeAccountSnapshot } from './types'
import { SEVERITIES as TYPE_SEVERITIES } from './types'
// The bundled demo snapshot — the all-issues sample from the fixture library,
// embedded into the build so `--demo` needs no files at runtime.
import allIssuesFixture from '../test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json'

/** The committed sample account `--demo` audits. */
const DEMO_SNAPSHOT = allIssuesFixture as unknown as StripeAccountSnapshot

/** Valid `--severity` values (matched against each rule's severity). */
const SEVERITIES: readonly Severity[] = TYPE_SEVERITIES
/** Valid `--category` values (matched against each rule's category). */
const CATEGORIES: readonly Category[] = [
  'webhooks',
  'billing',
  'security',
  'configuration',
  'payments',
  'pricing',
]

/** The parsed CLI options the spine reads (the subset wired here). */
export interface CliOptions {
  output?: string
  key?: string
  severity?: string
  category?: string
  failOn?: string
  ignore?: string[]
  demo?: boolean
  deep?: boolean
  listRules?: boolean
  // --quiet / --only-failures remain registered-but-unwired (output-suppression is
  // deferred to a future release); runCli emits an honest "not implemented" notice for them.
  quiet?: boolean
  onlyFailures?: boolean
  // Baseline flags — WIRED (writeBaselineFile / loadBaselineFile / the
  // baseline stage in runAudit). NOTE the commander attribute names: `--write-baseline
  // [file]` → writeBaseline (true when the optional [file] is omitted, else the
  // filename string); the `--baseline, --check-baseline <file>` pair stores under the
  // LAST long flag, so it is checkBaseline (NOT baseline) regardless of which alias
  // the user typed.
  writeBaseline?: string | boolean
  checkBaseline?: string
  // Config-file seams threaded into loadConfig — parsed here, bodies owned by the loader.
  config?: string | false
  workingDirectory?: string
  // --report-unused-suppressions: advisory report of stale suppression
  // entries. Default off, reporting-only — never changes findings, score, or exit.
  reportUnusedSuppressions?: boolean
}

/**
 * Resolve the API key: `--key` wins, else `STRIPE_SECRET_KEY`, else undefined.
 * The value is returned for use only — NEVER logged or echoed (key-exposure guard).
 */
export function resolveKey(
  optKey: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return optKey ?? env.STRIPE_SECRET_KEY
}

/**
 * Split a comma list, keeping only values in `allowed` (lenient; runCli adds strict
 * exit-2 validation), then sort + dedupe so the filter recorded on the result — and
 * serialized into JSON / baseline files — is deterministic regardless of the order
 * the user typed the tokens.
 */
function parseFilterList<T extends string>(raw: string, allowed: readonly T[]): T[] {
  const set = new Set<string>(allowed)
  const matched = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is T => set.has(s))
  return [...new Set(matched)].sort()
}

/** Return the tokens in a comma list that are NOT in `allowed` (drives exit-2 validation). */
function invalidFilterTokens(raw: string | undefined, allowed: readonly string[]): string[] {
  if (!raw) return []
  const set = new Set<string>(allowed)
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && !set.has(s))
}

/** Build the engine {@link RuleFilter} from `--severity` / `--category`; undefined when neither is set. */
export function buildRuleFilter(opts: CliOptions): RuleFilter | undefined {
  const filter: RuleFilter = {}
  if (opts.severity) filter.severity = parseFilterList(opts.severity, SEVERITIES)
  if (opts.category) filter.category = parseFilterList(opts.category, CATEGORIES)
  return filter.severity || filter.category ? filter : undefined
}

/**
 * Render the keyless `--list-rules` table: one rule per line with a scope
 * (base|deep), category, and severity column, under a labelled header — followed
 * by the consciously-DROPPED registry (the transparency pack), so "why is
 * rule X missing?" is answered in the same place the catalog is listed.
 * Enumerated from the rule registries so the docs can diff against it. Pure — no
 * key, no network.
 */
export function formatRuleList(rules: readonly Rule[] = ALL_RULES): string {
  const idWidth = Math.max('ID'.length, ...rules.map((r) => r.id.length))
  const scopeWidth = Math.max('SCOPE'.length, 'base'.length, 'deep'.length)
  const catWidth = Math.max('CATEGORY'.length, ...CATEGORIES.map((c) => c.length))
  const line = (id: string, scope: string, category: string, severity: string) =>
    `${id.padEnd(idWidth)}  ${scope.padEnd(scopeWidth)}  ${category.padEnd(catWidth)}  ${severity}`
  const header = line('ID', 'SCOPE', 'CATEGORY', 'SEVERITY')
  const rows = rules.map((r) => line(r.id, isDeepRule(r) ? 'deep' : 'base', r.category, r.severity))
  const dropped = [
    '',
    'DROPPED (consciously not built — evidence in the repo per entry)',
    ...DROPPED_RULES.map((d) => `${d.id.padEnd(idWidth)}  ${d.reason}`),
  ]
  return [header, ...rows, ...dropped].join('\n')
}

/**
 * Machine-readable `--list-rules --output json` shape: the same registry data the
 * human table renders, as `{ active, dropped }`. This is the stable interface for
 * tooling (scripts/check-docs-drift.mjs reconciles docs against it) — the human
 * table's layout may change freely; this shape may only grow.
 */
export function formatRuleListJson(rules: readonly Rule[] = ALL_RULES): string {
  return JSON.stringify(
    {
      active: rules.map((r) => ({
        id: r.id,
        scope: isDeepRule(r) ? 'deep' : 'base',
        category: r.category,
        severity: r.severity,
      })),
      dropped: DROPPED_RULES.map((d) => ({
        id: d.id,
        reason: d.reason,
        decidedIn: d.decidedIn,
        evidence: d.evidence,
      })),
    },
    null,
    2,
  )
}

/**
 * SPINE — run the audit over a resolved `snapshot`. Wires the ordered stages:
 * (config already loaded by the caller — `loadConfig` is hoisted to the async
 * action handler, so this stays sync) → resolveRules → (fetch
 * already produced `snapshot`) → runRules → applySuppressions → baseline →
 * score (buildAuditResult). Returns the canonical result; the caller renders
 * it and sets the exit code. The default `config` is the no-config core-only
 * shape, so direct callers (tests, `runDemoAudit`) stay config-free.
 */
export function runAudit(
  snapshot: StripeAccountSnapshot,
  opts: CliOptions,
  config: LoadedConfig = coreOnlyConfig(opts.workingDirectory),
  base: Baseline | null = null,
): AuditResult {
  const rules = resolveRules(config)
  // fetch stage: `snapshot` is the bundled demo fixture on the keyless path; the
  // live fetch is wired in the CLI driver (runCli).
  const filter = buildRuleFilter(opts)
  const run = runRules(snapshot, rules, filter)
  // applySuppressions stage: .stripeauditignore (from the resolved cwd) +
  // --ignore patterns feed one Suppression[]; the pure applyIgnore partitions.
  const ignoreLines = [...loadIgnoreFile(config.cwd), ...(opts.ignore ?? [])]
  const { active, suppressed, unmatched } = applyIgnore(run.findings, ignoreLines)
  // An unknown/unmatched ignore pattern is info-level only — surfaced on stderr so
  // it never pollutes JSON stdout, and it NEVER changes the exit code.
  for (const pattern of unmatched) {
    process.stderr.write(
      `stripe-audit: unknown rule id or unmatched ignore pattern: ${pattern}\n`,
    )
  }
  // --report-unused-suppressions: opt-in advisory listing every declared
  // suppression that suppressed nothing this run (stale/dead entries). Reporting-only
  // — over applyIgnore's output, never touching active/score/exit. Off by default, so
  // the always-on unmatched warning above is the only suppression output otherwise.
  if (opts.reportUnusedSuppressions) {
    const unused = findUnusedSuppressions(ignoreLines, suppressed)
    if (unused.length > 0) {
      process.stderr.write(`stripe-audit: ${unused.length} unused suppression(s):\n`)
      for (const sup of unused) {
        process.stderr.write(`  - ${sup.raw}\n`)
      }
    }
  }
  // baseline stage: compare the ACTIVE (post-suppression) findings against a
  // loaded baseline, honouring the locked suppress → baseline → score order. The
  // pure comparison (src/baseline.ts) becomes the optional result.baseline block;
  // null (no --baseline) omits the block entirely. File-I/O for the baseline lives
  // in the CLI layer (loadBaselineFile / writeBaselineFile), never in the core.
  const baseline = base ? compareBaseline(active, base) : null
  return buildAuditResult(
    snapshot,
    { findings: active, skipped: run.skipped },
    // The active filter is recorded on the result so no reporter can
    // present a filtered run as a full audit; undefined leaves the key absent.
    { rulesTotal: rules.length, suppressed, baseline, filter },
  )
}

/**
 * Load + validate a user-owned baseline file (CLI-layer I/O — the baseline core stays
 * pure). Throws on a missing/unreadable file (fs error), non-JSON content
 * (`SyntaxError`), or an old/malformed shape (`ZodError` from the schema). Every
 * throw is mapped to {@link EXIT_CONFIG} by the caller — never a raw crash.
 */
function loadBaselineFile(path: string): Baseline {
  return baselineSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
}

/** Plain-language stderr message for a failed {@link loadBaselineFile}. */
function baselineLoadMessage(err: unknown, path: string): string {
  if (err instanceof ZodError) {
    return `baseline file ${path} has an invalid shape (was it written by an older stripe-audit?) — regenerate it with --write-baseline`
  }
  if (err instanceof SyntaxError) {
    return `baseline file ${path} is not valid JSON`
  }
  return `could not read baseline file ${path}`
}

/**
 * Serialise the current audit as a baseline to the user-owned path (stderr
 * confirmation), returning the exit code: {@link EXIT_OK} on success, or
 * {@link EXIT_CONFIG} when no path was given or the write failed. The tool stays
 * STATELESS — the file lives in the user's own repo; stripe-audit only writes it.
 */
function writeBaselineFile(result: AuditResult, arg: string | boolean): number {
  if (typeof arg !== 'string' || arg.trim() === '') {
    process.stderr.write(
      'stripe-audit: --write-baseline requires a file path (e.g. --write-baseline baseline.json)\n',
    )
    return EXIT_CONFIG
  }
  const baseline = writeBaseline(result)
  try {
    writeFileSync(arg, JSON.stringify(baseline, null, 2) + '\n')
  } catch {
    process.stderr.write(`stripe-audit: could not write baseline to ${arg}\n`)
    return EXIT_CONFIG
  }
  // Confirmation on stderr so stdout stays a clean, parseable report.
  process.stderr.write(`stripe-audit: wrote baseline: ${arg} (${baseline.fingerprints.length} fingerprints)\n`)
  return EXIT_OK
}

/**
 * Decide the completed-audit exit code, shared by the demo AND live paths so the
 * siblings cannot diverge. `--write-baseline` is handled by the caller BEFORE this
 * (write wins over a SAME-scope comparison; a scope mismatch is refused earlier
 * with EXIT_CONFIG). Here: when a baseline was compared, gate on
 * regression (exit 1 iff a NEW finding appeared — a score drop alone is exit 0);
 * otherwise fall back to the `--fail-on` severity gate.
 */
export function decideExit(result: AuditResult, opts: CliOptions, failOn: FailOnLevel): number {
  if (opts.checkBaseline !== undefined && result.baseline) {
    return result.baseline.regression ? EXIT_FINDINGS : EXIT_OK
  }
  return exitCodeForFindings(result.findings, failOn)
}

/** Run the keyless demo audit and render it in `format`. */
export function runDemoAudit(format: OutputFormat, opts: CliOptions = {}): string {
  return renderReport(runAudit(DEMO_SNAPSHOT, { ...opts, output: format }), format)
}

/**
 * Run the audit over `snapshot`, render it, and set the exit code — the shared
 * tail of BOTH the demo and live paths (so the baseline load, the report render,
 * and the exit decision cannot diverge between them). Owns all baseline file-I/O:
 * loads + validates `--baseline`/`--check-baseline` (a bad file → EXIT_CONFIG,
 * and a filter-scope mismatch → EXIT_CONFIG — both refuse before any
 * report renders), writes `--write-baseline` (which WINS over a SAME-scope
 * comparison and exits 0), else defers to {@link decideExit}.
 */
function auditAndExit(
  snapshot: StripeAccountSnapshot,
  opts: CliOptions,
  config: LoadedConfig,
  format: OutputFormat,
  failOn: FailOnLevel,
): void {
  // Load a baseline for comparison (fs + zod here in the CLI layer; core stays pure).
  let base: Baseline | null = null
  if (opts.checkBaseline !== undefined) {
    try {
      base = loadBaselineFile(opts.checkBaseline)
    } catch (err) {
      process.stderr.write(`stripe-audit: ${baselineLoadMessage(err, opts.checkBaseline)}\n`)
      process.exitCode = EXIT_CONFIG
      return
    }
    // Refuse a filter-scope mismatch BEFORE the audit/compare runs. An
    // unfiltered baseline checked with --severity/--category (or vice versa)
    // would read every out-of-scope finding as "resolved"/"new" and could exit 0
    // over unaddressed criticals — a spurious pass, never a legitimate gate.
    // Absent scope ≡ unfiltered/full (baseline files predating the filter field). This is a config
    // error (exit 2), a sibling of the bad-baseline-file gate above, so stdout
    // stays clean (no report renders).
    // This gate also pre-empts a combined `--baseline` + `--write-baseline`
    // invocation: refusing the mismatched comparison outranks the "write wins"
    // contract below — regenerate with --write-baseline ALONE instead.
    const current = buildRuleFilter(opts)
    if (!sameFilterScope(current, base.filter)) {
      const label = (scope?: RuleFilter) => {
        if (!scope) return 'full (unfiltered)'
        const desc = describeFilter(scope)
        // A degenerate empty-list scope (e.g. a baseline captured under
        // `--severity ,`) describes to '' — name it honestly (see issue #9).
        return desc ? `filtered (${desc})` : 'filtered (empty — selects no rules)'
      }
      process.stderr.write(
        `stripe-audit: baseline scope mismatch — ${opts.checkBaseline} was captured ${label(base.filter)}, but this run is ${label(current)}.\n` +
          '  Comparing across scopes would report spurious new/resolved findings. Re-run with the\n' +
          '  matching --severity/--category flags, or regenerate the baseline at this scope with\n' +
          '  --write-baseline (without --baseline).\n',
      )
      process.exitCode = EXIT_CONFIG
      return
    }
  }

  const result = runAudit(snapshot, opts, config, base)
  process.stdout.write(renderReport(result, format) + '\n')

  // --write-baseline ACCEPTS current reality and wins over a SAME-scope comparison
  // (a mismatched-scope comparison was already refused above): snapshot to the
  // user-owned path and exit 0 (or EXIT_CONFIG on a bad path / write failure).
  if (opts.writeBaseline !== undefined) {
    process.exitCode = writeBaselineFile(result, opts.writeBaseline)
    return
  }
  process.exitCode = decideExit(result, opts, failOn)
}

/**
 * Report a live-audit runtime failure ONCE: plain-language translation + deep link
 * on stderr, exit 3 (never a raw stack trace, never the key value). One-shot so the
 * live-path try/catch and the unhandledRejection backstop can never double-print.
 */
let runtimeErrorReported = false
function reportRuntimeError(err: unknown, key?: string): void {
  if (runtimeErrorReported) return
  runtimeErrorReported = true
  process.stderr.write(translateStripeError(err, key) + '\n')
  process.exitCode = EXIT_RUNTIME
}

/**
 * Merge config-file settings into the parsed flags at per-key
 * precedence: CLI flag > config file > built-in default. `ignore` is the one
 * union-merge (CLI `--ignore` ∪ config `ignore`; `.stripeauditignore` joins
 * inside `runAudit`). The config's `baseline` path resolves against the config
 * working directory — not the process cwd — so a config file behaves the same
 * from any invocation directory.
 */
export function applyConfigSettings(flags: CliOptions, config: LoadedConfig): CliOptions {
  const settings = config.settings
  if (!settings) return flags
  const merged: CliOptions = {
    ...flags,
    output: flags.output ?? settings.output,
    failOn: flags.failOn ?? settings.failOn,
    severity: flags.severity ?? settings.severity?.join(','),
    category: flags.category ?? settings.category?.join(','),
    deep: flags.deep ?? settings.deep,
    // A config-declared baseline never joins a --write-baseline run: merging it
    // would turn the FIRST bootstrap write (file not there yet) into an exit-2
    // "could not read baseline file", and a re-scoped regenerate into a
    // scope-mismatch refusal — both unfollowable without --no-config.
    checkBaseline:
      flags.checkBaseline ??
      (settings.baseline === undefined || flags.writeBaseline !== undefined
        ? undefined
        : resolve(config.cwd, settings.baseline)),
  }
  if (settings.ignore !== undefined && settings.ignore.length > 0) {
    merged.ignore = [...(flags.ignore ?? []), ...settings.ignore]
  }
  return merged
}

/** Drive one CLI invocation from parsed flags. Owns the config load, the short-circuits, the spine call, and the exit code. */
async function runCli(flags: CliOptions): Promise<void> {
  // ── Config file — loaded FIRST so file settings can feed every ──
  // decision below (format, fail-on, filters, deep, ignore, baseline) at
  // flag > file > default precedence. A ConfigError (missing/ambiguous/malformed/invalid file) is a
  // plain-language exit 2 — never a stack trace, never the file contents
  // (key-exposure / error-content-leak guards).
  let config: LoadedConfig
  try {
    config = await loadConfig({
      workingDirectory: flags.workingDirectory,
      configPath: typeof flags.config === 'string' ? flags.config : undefined,
      noConfig: flags.config === false,
    })
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`stripe-audit: ${err.message}\n`)
      process.exitCode = EXIT_CONFIG
      return
    }
    throw err
  }
  // Validate the plugin merge fail-loud UP FRONT: a rule-id
  // collision or an empty `requires` from a config-registered plugin is a
  // config error (exit 2, plain language) — never an unhandled throw from
  // inside the audit spine. runAudit re-runs resolveRules later over the same
  // input, which by then is proven not to throw.
  try {
    resolveRules(config)
  } catch (err) {
    if (err instanceof RuleResolutionError) {
      process.stderr.write(`stripe-audit: ${err.message}\n`)
      process.exitCode = EXIT_CONFIG
      return
    }
    throw err
  }
  const opts = applyConfigSettings(flags, config)

  // ── Configuration validation (exit 2 — exit-codes.ts owns the config-error contract) ──
  // Runs before --list-rules / --demo so an invalid flag is a config error even in
  // keyless modes.
  const format = String(opts.output ?? 'console')
  if (!isOutputFormat(format)) {
    process.stderr.write(
      `stripe-audit: unknown --output '${format}' (expected ${OUTPUT_FORMATS.join(', ')})\n`,
    )
    process.exitCode = EXIT_CONFIG
    return
  }

  // --list-rules: keyless introspection. Short-circuit BEFORE key resolution.
  // `--output json` emits the machine-readable registry; every other format gets
  // the human table.
  if (opts.listRules) {
    process.stdout.write((format === 'json' ? formatRuleListJson() : formatRuleList()) + '\n')
    return
  }
  const failOnRaw = opts.failOn ?? DEFAULT_FAIL_ON
  if (!isFailOnLevel(failOnRaw)) {
    process.stderr.write(
      `stripe-audit: invalid --fail-on '${failOnRaw}' (expected ${FAIL_ON_LEVELS.join(', ')})\n`,
    )
    process.exitCode = EXIT_CONFIG
    return
  }
  const failOn: FailOnLevel = failOnRaw
  const badSeverity = invalidFilterTokens(opts.severity, SEVERITIES)
  if (badSeverity.length > 0) {
    process.stderr.write(
      `stripe-audit: invalid --severity ${badSeverity.join(', ')} (expected ${SEVERITIES.join(', ')})\n`,
    )
    process.exitCode = EXIT_CONFIG
    return
  }
  const badCategory = invalidFilterTokens(opts.category, CATEGORIES)
  if (badCategory.length > 0) {
    process.stderr.write(
      `stripe-audit: invalid --category ${badCategory.join(', ')} (expected ${CATEGORIES.join(', ')})\n`,
    )
    process.exitCode = EXIT_CONFIG
    return
  }
  // Closes #9: a present-but-EMPTY filter list (e.g. `--severity ,`)
  // would select no rules and grade a run that audited nothing as 100/A — the
  // false-assurance hole this gate exists to close. Refuse it as a config
  // error. The config-file side is already sealed by minItems: 1.
  if (opts.severity !== undefined && parseFilterList(opts.severity, SEVERITIES).length === 0) {
    process.stderr.write(
      `stripe-audit: --severity selects no rules (empty list) — pass at least one of ${SEVERITIES.join(', ')}\n`,
    )
    process.exitCode = EXIT_CONFIG
    return
  }
  if (opts.category !== undefined && parseFilterList(opts.category, CATEGORIES).length === 0) {
    process.stderr.write(
      `stripe-audit: --category selects no rules (empty list) — pass at least one of ${CATEGORIES.join(', ')}\n`,
    )
    process.exitCode = EXIT_CONFIG
    return
  }

  // --deep is live: the fetcher fans out over the gate-approved deep
  // regions. A base-6 key stays safe — every deep region scope-probes, so a
  // missing grant degrades that region to null instead of erroring.

  // Honesty notices for flags commander registers but the spine does NOT act
  // on yet. Mirrors the --deep notice: STDERR only, NEVER changes the exit code. Sits
  // AFTER --list-rules (pure introspection, already returned) so that short-circuit
  // stays notice-free, and BEFORE the demo/no-key/live branches so it fires on all
  // three real paths. DO NOT implement the bodies here — output-suppression is
  // deferred to a future release, baseline read/write is owned by the baseline stage. The baseline pair is spelled out so a
  // CI user is never misled into believing findings were gated against a baseline.
  if (opts.quiet) {
    process.stderr.write(
      'stripe-audit: --quiet is not implemented yet — coming in a later release.\n',
    )
  }
  if (opts.onlyFailures) {
    process.stderr.write(
      'stripe-audit: --only-failures is not implemented yet — coming in a later release.\n',
    )
  }

  // Resolve the key once (--key wins over STRIPE_SECRET_KEY). The value is used to
  // classify + (later) construct the client — NEVER echoed (S1).
  const key = resolveKey(opts.key)

  // Local key-prefix coaching: when a key is present, classify its prefix
  // LOCALLY (no network, no API call) and emit non-blocking coaching on stderr. It
  // routes every key display through redact() and never changes the exit code.
  if (key) {
    for (const line of coachKeyPrefix(key)) process.stderr.write(line + '\n')
  }

  // --demo: keyless audit over bundled sample data. Short-circuit BEFORE the no-key
  // panel (a --key passed with --demo is still coached above but unused by the audit).
  if (opts.demo) {
    // Banner on stderr so stdout stays a clean, parseable report (json/markdown/html).
    // This is NOT a missing-key error — demo is keyless by design.
    process.stderr.write(
      'stripe-audit · demo mode — auditing bundled sample data, no key or network used.\n' +
        'Point it at your own account with a read-only restricted key for a real report.\n',
    )
    // Honesty notice (same contract as --quiet/--only-failures): the bundled
    // sample is a base-mode snapshot, so --deep cannot light up here.
    if (opts.deep) {
      process.stderr.write(
        'stripe-audit: --deep has no effect in demo mode — the bundled sample is a base-mode snapshot.\n',
      )
    }
    // Exit-code contract: gate over the ACTIVE findings only (suppressed + skipped
    // deep rules are already excluded) — via the shared tail so the baseline gate
    // (--baseline / --write-baseline) and the --fail-on gate apply identically here
    // and on the live path.
    auditAndExit(DEMO_SNAPSHOT, opts, config, format, failOn)
    return
  }

  // Live audit needs a key (resolved + coached above). No key → onboarding panel.
  if (!key) {
    // Branded onboarding panel (read-only assurance + how to get a key) on
    // stderr (stdout stays clean). Informational copy, NOT an
    // exception/stack trace; exit 2 (configuration). --deep shows the deep-scope
    // key checklist up front.
    process.stderr.write(renderOnboardingPanel({ deep: Boolean(opts.deep) }) + '\n')
    process.exitCode = EXIT_CONFIG
    return
  }

  // Live-audit fetch stage. Construct the read-only client and fetch the
  // snapshot; auth / permission / transport failures are translated to plain
  // language + the restricted-key deep link (never a stack trace, never the key)
  // and exit 3. --deep flips the fetch to deep mode.
  let snapshot: StripeAccountSnapshot
  try {
    const stripe = createStripeClient(key)
    snapshot = await fetchAccountSnapshot(stripe, key, { deep: Boolean(opts.deep) })
  } catch (err) {
    reportRuntimeError(err, key)
    return
  }

  // A deep run whose key is missing deep scopes gets told EXACTLY which
  // dashboard permissions to grant, plus the (stable, param-free) creation link.
  // STDERR only — never changes the exit code; never touches the key value (S1).
  if (opts.deep) {
    const isDeepScope = (scope: string): scope is DeepScopeId =>
      Object.hasOwn(DEEP_SCOPE_PARAMS, scope)
    const missing = snapshot.scopeProbe
      .filter((grant) => !grant.granted)
      .map((grant) => grant.scope)
      .filter(isDeepScope)
      .map((scope) => DEEP_SCOPE_PARAMS[scope])
    if (missing.length > 0) {
      const link = buildDeepRestrictedKeyLink()
      process.stderr.write(
        `stripe-audit: deep scopes not granted on this key: ${missing.join(', ')}.\n` +
          `  Those regions were skipped (deep-scope-not-granted). To audit them, extend your\n` +
          `  restricted key at ${link.url} — grant Read on: ${link.scopes.join(', ')}.\n` +
          `  (Deep permission names are provisional pending live key-builder verification.)\n`,
      )
    }
  }

  // Successful fetch → run the same spine + shared exit tail the demo path uses.
  auditAndExit(snapshot, opts, config, format, failOn)
}

/** Build the commander program (exported so tests can unit-test parsing). */
export function buildProgram(): Command {
  const program = new Command()
  program
    .name('stripe-audit')
    .description(
      'Read-only Stripe billing audit & lint — scans a Stripe account and reports ' +
        'revenue-losing misconfigurations as severity-ranked findings.',
    )
    .showHelpAfterError('(run `stripe-audit --help` to see available options)')
    // ── core audit / DX flags ──
    .option('--key <key>', 'Stripe restricted API key (or set STRIPE_SECRET_KEY)')
    .option('--output <format>', `report format: ${OUTPUT_FORMATS.join(' | ')}`, 'console')
    .option(
      '--severity <levels>',
      'only run rules of these severities (comma-separated: critical,high,medium,low,info)',
    )
    .option(
      '--category <cats>',
      'only run rules in these categories (comma-separated: webhooks,billing,security,configuration,payments,pricing)',
    )
    .option('--quiet', 'suppress non-finding output (deprecated; output-suppression lands in a later release)')
    .option('--only-failures', 'show only failing findings (deprecated; prefer --fail-on)')
    .option('--demo', 'run a keyless demo audit over bundled sample data (no key, no network)')
    .option(
      '--list-rules',
      'list every shipped rule (id, scope, category, severity) and exit — no key required; `--output json` emits the machine-readable registry',
    )
    // ── report-shaping flags (registered here; not all are implemented yet) ──
    .option('--deep', 'deep audit mode — also reads subscriptions, meters, event destinations, coupons')
    .option(
      '--fail-on <level>',
      'exit non-zero when an active finding is at/above this severity: critical|high|medium|low|none',
    )
    .option('--ignore <pattern...>', 'suppress findings by rule id, :resource, or rule:resource (repeatable)')
    .option(
      '--report-unused-suppressions',
      'report suppression entries (ignore patterns) that matched no finding this run — advisory, never changes the exit code',
    )
    .option('--write-baseline [file]', 'write the current findings as a baseline file')
    .option(
      '--baseline, --check-baseline <file>',
      'compare findings against a baseline file (alias: --check-baseline)',
    )
    .option('--config <file>', 'path to a stripe-audit config file')
    .option('--no-config', 'ignore any config file (core rules only)')
    .option('--working-directory <dir>', 'directory to resolve relative paths from (default: cwd)')
    // Registered last so `--version` lists after the flags in --help (the documented
    // flag order the docs diff against); still triggers + exits like any commander version option.
    .version(`stripe-audit ${VERSION} (Stripe API ${STRIPE_API_VERSION})`, '-v, --version')
    .action(() => {
      const flags = program.opts<CliOptions>()
      // --output is the ONE mirrored flag carrying a
      // commander-level default ('console'), so "did the user pass it?" is
      // answered via the option-value source — a default-sourced value must
      // not shadow a config-file `output`.
      if (program.getOptionValueSource('output') === 'default') delete flags.output
      return runCli(flags)
    })
  return program
}

// Entry-point guard: run the audit AND register the backstop
// ONLY when this module is the process entry (`node dist/cli.js`). Importing
// src/cli.ts in-process — as test/cli/cli-unit.test.ts does to unit-test the
// exported spine — must produce no stdout, no stderr, no network call, and no
// process.exitCode mutation. `require.main === module` is true under the tsup CJS
// build's shipped binary and false on import, so the subprocess suite
// (test/cli/parse.test.ts) stays green while the module becomes import-safe.
// See TESTING.md § in-process cli unit layer.
if (require.main === module) {
  // Backstop: the Stripe SDK's paginated list() leaks a sibling unhandled rejection
  // when every region 401s (a totally invalid key). A CLI must never crash with a raw
  // stack trace, so translate any escaped error to plain language + exit 3. Registering
  // this listener also suppresses Node's default crash-on-unhandled-rejection, so the
  // process exits with the code reportRuntimeError set. One-shot keeps it single-print.
  process.on('unhandledRejection', (reason) => reportRuntimeError(reason))

  void buildProgram().parseAsync()
}
