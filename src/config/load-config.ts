/**
 * stripe-audit — configuration loading (the spine's config seam and loader).
 *
 * `loadConfig` is the FIRST stage of the audit orchestration spine
 * (config → resolveRules → fetch → runRules → applySuppressions → baseline →
 * score → exit). It resolves the effective config file — `--config <path>`, or
 * discovery of `stripe-audit.config.*` in the working directory — reads it,
 * validates it against the single schema chokepoint (`./config-schema`), and
 * returns the settings + plugin set the CLI merges into the run.
 *
 * Trust boundary (SECURITY.md): the JSON form is parsed as DATA
 * (`readFileSync` + `JSON.parse` + zod) — zero third-party code ever runs from
 * it, and its schema rejects a `plugins` key outright. Executable configs
 * (`.mjs`/`.cjs`/`.js` — the plugin-registration form) load via ONE
 * native dynamic `import()` of the exact file the user named; the loader
 * contains no directory scan, no glob, and no probing of installed packages —
 * only code explicitly referenced from the user's own config file (or dropped
 * by the user in their own working directory) is ever loaded or executed.
 *
 * Every failure is a {@link ConfigError} with a plain-language message naming
 * the file path — never the file contents, never a stack trace (no content leaks).
 * The CLI translates it to exit 2 (`EXIT_CONFIG`).
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ZodError } from 'zod'
import { CONFIG_USAGE_EXIT } from './resolve-rules'
import type { PluginRuleSet, ResolveRulesConfig } from './resolve-rules'
import {
  configFileSchema,
  executableManifestSchema,
  type ConfigFileSettings,
  type ExecutableManifest,
} from './config-schema'

/** Where the effective config came from — surfaced for tests + diagnostics. */
export type ConfigSource = 'core-only' | 'file' | 'disabled'

/** Inputs the CLI threads into {@link loadConfig} from its parsed flags. */
export interface LoadConfigOptions {
  /** `--working-directory <dir>`; defaults to `process.cwd()`. */
  workingDirectory?: string
  /** `--config <file>` path, when supplied (resolved against the working directory). */
  configPath?: string
  /** `--no-config` — force core-only, ignore any config file. */
  noConfig?: boolean
}

/** The resolved config the spine carries: the `resolveRules` slice + run context. */
export interface LoadedConfig extends ResolveRulesConfig {
  /** Working directory relative paths (`.stripeauditignore`, config file) resolve against. */
  cwd: string
  /** Provenance of the effective config. */
  source: ConfigSource
  /** Absolute path of the loaded config file (present only when `source === 'file'`). */
  path?: string
  /** Validated settings from the config file (present only when `source === 'file'`). */
  settings?: ConfigFileSettings
}

/**
 * Fail-loud error for an unloadable config. Carries the CLI exit code to use
 * (the same config/usage contract as {@link RuleResolutionError}). The message
 * is plain language and names the file path — NEVER the file contents, never a
 * wrapped stack (no content leaks).
 */
export class ConfigError extends Error {
  readonly exitCode = CONFIG_USAGE_EXIT
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** File names probed (in this order) when no `--config` is passed. */
const CONFIG_FILE_NAMES = [
  'stripe-audit.config.json',
  'stripe-audit.config.mjs',
  'stripe-audit.config.cjs',
  'stripe-audit.config.js',
] as const

/** The no-config default: core catalog only, zero third-party code. */
export function coreOnlyConfig(workingDirectory?: string): LoadedConfig {
  return { cwd: workingDirectory ?? process.cwd(), source: 'core-only', plugins: [] }
}

/**
 * Resolve the effective audit configuration.
 *
 * `--no-config` wins over everything (`source: 'disabled'`, nothing is read).
 * `--config <path>` resolves against the working directory and MUST exist.
 * Otherwise discovery probes the working directory for `stripe-audit.config.*`;
 * zero hits is the byte-unchanged core-only default, and MORE THAN ONE hit is a
 * fail-loud {@link ConfigError} naming every candidate — the loader never
 * silently picks a winner.
 *
 * @throws {ConfigError} on a missing `--config` file, ambiguous discovery, an
 *   unreadable/malformed/invalid file, or an unsupported extension.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadedConfig> {
  const cwd = options.workingDirectory ?? process.cwd()
  if (options.noConfig) return { cwd, source: 'disabled', plugins: [] }

  let file: string
  if (options.configPath) {
    file = resolve(cwd, options.configPath)
    if (!existsSync(file)) {
      throw new ConfigError(
        `config file not found: ${options.configPath} (resolved to ${file})`,
      )
    }
  } else {
    const candidates = CONFIG_FILE_NAMES.map((name) => join(cwd, name)).filter(
      (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false,
    )
    if (candidates.length === 0) return { cwd, source: 'core-only', plugins: [] }
    if (candidates.length > 1) {
      // Fail-loud on ambiguity: silently picking a
      // winner could apply the WRONG settings under a "config loaded" label —
      // the exact false assurance the config loader exists to close.
      throw new ConfigError(
        `found ${candidates.length} config files in ${cwd}: ` +
          `${candidates.map((path) => basename(path)).join(', ')} — ` +
          'keep exactly one, or pass --config to pick explicitly',
      )
    }
    file = candidates[0]
  }

  if (file.endsWith('.json')) return loadJsonConfig(file, cwd)
  if (/\.(mjs|cjs|js)$/.test(file)) return loadExecutableConfig(file, cwd)
  throw new ConfigError(
    `unsupported config file extension: ${basename(file)} (expected .json, .mjs, .cjs, or .js)`,
  )
}

/** Read + parse + validate the JSON (data-only) config form. */
function loadJsonConfig(file: string, cwd: string): LoadedConfig {
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    // EACCES / EISDIR / vanished-after-probe — one plain-language shape for all.
    throw new ConfigError(`could not read config file ${file}`)
  }
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    throw new ConfigError(`config file ${file} is not valid JSON`)
  }
  const parsed = configFileSchema.safeParse(data)
  if (!parsed.success) {
    throw new ConfigError(
      `config file ${file} is invalid: ${describeConfigIssues(parsed.error)} — ` +
        'see schemas/stripe-audit.config.schema.json',
    )
  }
  // Drop the inert editor-autocomplete key; everything else is a run setting.
  const settings = { ...parsed.data }
  delete settings.$schema
  return { cwd, source: 'file', path: file, plugins: [], settings }
}

/**
 * Load an executable config: ONE native dynamic `import()` of the
 * exact file the user named — `.mjs`, `.cjs`, or `.js` (whose module format
 * Node resolves from the USER'S nearest `package.json` `"type"` field; the
 * loader never guesses). The default export — which is `module.exports` for a
 * CJS config, per Node's ESM↔CJS interop — must be a manifest:
 * `{ meta, rules }` (bridged to `plugins: [{ key: meta.name, rules }]`) or
 * `{ plugins: [...] }` pass-through, optionally carrying the same settings
 * keys as the JSON form. The manifest is validated structurally here;
 * `resolveRules` owns the deep rule contract (collision, empty `requires`).
 */
async function loadExecutableConfig(file: string, cwd: string): Promise<LoadedConfig> {
  let mod: unknown
  try {
    // File-URL specifier: path→URL conversion handles percent-encoding and
    // Windows drive letters (Node docs recommend url.pathToFileURL for paths).
    mod = (await import(pathToFileURL(file).href)) as unknown
  } catch {
    // Throwing module body, missing/unresolvable import inside it, or a syntax
    // error — one plain-language shape, never the raw stack (S1/S2).
    throw new ConfigError(
      `could not load executable config ${file} — the module threw, has a syntax error, ` +
        'or references an import that cannot be resolved',
    )
  }
  let manifest = (mod as { default?: unknown }).default
  // Transpiled-CJS interop: a config compiled from `export default` lands as
  // module.exports = { __esModule: true, default: manifest } — unwrap once.
  if (
    typeof manifest === 'object' &&
    manifest !== null &&
    (manifest as { __esModule?: unknown }).__esModule === true &&
    'default' in manifest
  ) {
    manifest = (manifest as { default: unknown }).default
  }
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new ConfigError(
      `executable config ${file} must default-export a manifest object — ` +
        '{ meta, rules } or { plugins: [...] }, plus optional settings',
    )
  }
  if (typeof (manifest as { then?: unknown }).then === 'function') {
    throw new ConfigError(
      `executable config ${file} default-exports a Promise/thenable — ` +
        'export the manifest object synchronously',
    )
  }
  const parsed = executableManifestSchema.safeParse(manifest)
  if (!parsed.success) {
    throw new ConfigError(
      `config file ${file} is invalid: ${describeConfigIssues(parsed.error)} — ` +
        'see docs/writing-plugins.md for the manifest shape',
    )
  }
  return { cwd, source: 'file', path: file, plugins: bridgePlugins(parsed.data, file), settings: manifestSettings(parsed.data) }
}

/** Bridge a validated manifest to the `resolveRules` plugin set. */
function bridgePlugins(manifest: ExecutableManifest, file: string): PluginRuleSet[] {
  const plugins: PluginRuleSet[] = []
  if (manifest.rules !== undefined && manifest.rules.length > 0) {
    if (manifest.meta?.name === undefined) {
      throw new ConfigError(
        `executable config ${file} declares rules but no meta.name — ` +
          'meta.name is the plugin key that namespaces every rule id',
      )
    }
    plugins.push({ key: manifest.meta.name, rules: manifest.rules })
  }
  for (const plugin of manifest.plugins ?? []) {
    plugins.push({ key: plugin.key, rules: plugin.rules })
  }
  return plugins
}

/** The settings slice of a validated manifest (identity keys dropped). */
function manifestSettings(manifest: ExecutableManifest): ConfigFileSettings {
  const settings: Record<string, unknown> = { ...manifest }
  delete settings.meta
  delete settings.rules
  delete settings.plugins
  return settings as ConfigFileSettings
}

/**
 * Plain-language summary of schema violations. Names keys and locations only —
 * never the offending VALUES, so a config mistake can never echo file contents
 * (or anything secret-shaped pasted into one) back through stderr (S1).
 */
function describeConfigIssues(error: ZodError): string {
  const lines = error.issues.map((issue) => {
    const where = issue.path.length > 0 ? `"${issue.path.join('.')}"` : 'the top level'
    if (issue.code === 'unrecognized_keys') {
      const keys = issue.keys.map((key) => `"${key}"`).join(', ')
      const pluginHint = issue.keys.includes('plugins')
        ? ' (plugin registration requires the executable config form — stripe-audit.config.mjs/.cjs/.js; the JSON form is data-only)'
        : ''
      return `unknown key(s) ${keys} at ${where}${pluginHint}`
    }
    if (issue.code === 'too_small') {
      // Array `.min(1)` (severity/category) vs numeric `.min()` (the operational knobs)
      // both surface as too_small — branch on origin so a numeric knob never gets
      // the list-specific "empty filter" copy. Only the schema bound is named,
      // never the offending value (S1).
      if (issue.origin === 'array') {
        return `empty list at ${where} — an empty filter would select no rules; remove the key or list at least one value`
      }
      return `value at ${where} is below the allowed minimum (${String(issue.minimum)})`
    }
    if (issue.code === 'too_big') {
      return `value at ${where} is above the allowed maximum (${String(issue.maximum)})`
    }
    return `invalid value at ${where}`
  })
  return [...new Set(lines)].join('; ')
}
