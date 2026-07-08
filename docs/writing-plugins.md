# Writing a stripe-audit plugin

`stripe-audit` ships a small, stable **plugin seam** so you can add your own billing
rules alongside the built-in catalog — without forking the tool or importing any of its
internals. A plugin is just a module that exports some rules; the host merges them into
the audit under your own namespace.

Everything you need is on the package's public barrel — `import … from 'stripe-audit'`.
You never import a deep internal path.

> The runnable companion to this guide is
> [`examples/stripe-audit-plugin-example/`](../examples/stripe-audit-plugin-example/) —
> a complete reference plugin plus an end-to-end test. Copy it as a starting point.

## The four pieces

### 1. `defineRule(rule)` — the typed identity helper

`defineRule` is re-exported from `stripe-audit`. Wrapping a rule literal in it gives you
full editor completion and compile-time checking of `id` / `name` / `severity` /
`category` / `requires` / `check` against the host's `Rule` contract. At runtime it
returns its argument unchanged — zero cost.

```ts
import { defineRule } from 'stripe-audit'
import type { Finding, StripeAccountSnapshot } from 'stripe-audit'

export const STATEMENT_DESCRIPTOR_MISSING = defineRule({
  id: 'STATEMENT_DESCRIPTOR_MISSING',
  name: 'No card statement descriptor configured',
  severity: 'medium',
  category: 'configuration',
  requires: ['account'], // must be non-empty — see the resolveRules gate below
  check: (snapshot: StripeAccountSnapshot): Finding[] => {
    const descriptor = snapshot.account.statementDescriptor
    if (descriptor !== null && descriptor.trim().length > 0) return []
    return [
      {
        ruleId: 'STATEMENT_DESCRIPTOR_MISSING',
        severity: 'medium',
        category: 'configuration',
        title: 'No card statement descriptor configured',
        affectedResourceId: snapshot.account.id,
        affectedResourceType: 'account',
        description: 'Charges show customers an unrecognizable label, driving disputes.',
        remediation: 'Set a recognizable statement descriptor in the Dashboard.',
        docsUrl: 'https://docs.stripe.com/get-started/account/statement-descriptors',
      },
    ]
  },
})
```

A rule is a **pure predicate** over a read-only `StripeAccountSnapshot`: `check(snapshot)
=> Finding[]`. It reads only the regions it declares in `requires`, and returns zero or
more `Finding` objects. Both `Rule` and `Finding` are exported from `stripe-audit`, so
you get the exact shapes the host uses without touching an internal module.

### 2. The Plugin manifest

A plugin **module** default-exports a manifest — the documented convention:

```ts
import type { Rule } from 'stripe-audit'

interface PluginManifest {
  meta: { name: string; version: string; apiVersion: number }
  rules: Rule[]
}
```

- **`meta.name`** — your plugin key. It namespaces every rule you contribute (see below),
  so pick something stable and unique (e.g. `acme-billing-checks`).
- **`meta.version`** — your plugin's own semver, for your bookkeeping.
- **`meta.apiVersion`** — the host contract major you built against. Set it to the host's
  `CORE_API_VERSION` (next section).

There is intentionally **no exported `Plugin` type** on the host — the manifest is a plain
shape you agree to. The host only ever reads `meta.name` and `rules`.

```ts
import { CORE_API_VERSION } from 'stripe-audit'

const plugin: PluginManifest = {
  meta: { name: 'acme-billing-checks', version: '0.1.0', apiVersion: CORE_API_VERSION },
  rules: [STATEMENT_DESCRIPTOR_MISSING],
}
export default plugin
```

### 3. `CORE_API_VERSION` pinning

`CORE_API_VERSION` is a **number** re-exported from `stripe-audit` (currently `1`). It is
the major version of the rule contract (the `Rule` / `Finding` / `RuleScope` shapes).

Set `meta.apiVersion` to `CORE_API_VERSION`. The contract is **append-only within a
major**: a plugin compiled against major `N` keeps working across every *minor* host
release — new optional fields may be added, but nothing your rule relies on is removed or
retyped. A breaking change to the contract bumps `CORE_API_VERSION` to `2`, which is your
signal to re-verify the plugin.

### 4. The `resolveRules` bridge

The host merges your plugin through `resolveRules`, also re-exported from `stripe-audit`.
It takes a config with a `plugins` array of `{ key, rules }` sets and returns the unified
`rules: Rule[]` (core catalog + your rules), which is exactly what the CLI feeds the
engine. Bridge your manifest by setting `key = meta.name`:

```ts
import { resolveRules } from 'stripe-audit'
import plugin from './my-plugin'

const rules = resolveRules({ plugins: [{ key: plugin.meta.name, rules: plugin.rules }] })
```

**Namespacing.** Each plugin rule resolves under `key/RULE_ID` — e.g.
`acme-billing-checks/STATEMENT_DESCRIPTOR_MISSING`. Core rule ids are never rewritten and
never contain a `/`, so a plugin can never shadow a core rule, and a finding's origin
stays legible.

**Fail-loud.** `resolveRules` throws `RuleResolutionError` (also exported, carrying the
CLI exit code `CONFIG_USAGE_EXIT`) when two resolved ids collide, or when a plugin rule
declares an **empty `requires`**. It never silently de-dupes or last-wins — a silent
shadow could mask a core revenue rule.

## Registering a plugin

Plugins are executable code, so they can only be registered from the **executable config
form** (`stripe-audit.config.mjs` / `.cjs` / `.js`), which can `import` your module. The
zero-code JSON config (`stripe-audit.config.json`) is **settings + ignore only** — it
cannot load a module, by design (a data file must never execute code, and its schema
rejects a `plugins` key outright). See [`SECURITY.md`](../SECURITY.md) for that trust
boundary, and the published JSON Schema at
[`schemas/stripe-audit.config.schema.json`](../schemas/stripe-audit.config.schema.json)
for the settings the JSON form accepts.

The CLI discovers `stripe-audit.config.*` in the working directory
(`--working-directory <dir>` to anchor elsewhere), or loads an explicit
`--config <file>`; `--no-config` skips every config. If **more than one**
`stripe-audit.config.*` candidate exists, stripe-audit refuses with exit 2 naming every
candidate — it never silently picks a winner.

Your config **default-exports the manifest** — copy-paste runnable (committed tests
prove this shape end-to-end):

```js
// stripe-audit.config.mjs
import plugin from './acme-billing-checks/index.mjs'

export default {
  meta: plugin.meta, // meta.name is the plugin key — it namespaces every rule id
  rules: plugin.rules,
  // Executable configs may ALSO carry the same settings keys as the JSON form —
  // a CLI flag outranks the config, per key (flag > config file > default).
  failOn: 'high',
}
```

To register **several** plugins, default-export the pass-through form instead:
`{ plugins: [{ key: 'acme-billing-checks', rules: [...] }, { key: 'other', rules: [...] }] }`.
A `.cjs` config assigns the same manifest to `module.exports`; a plain `.js` config is
interpreted by **your** nearest `package.json` `"type"` field — Node resolves the module
format natively, stripe-audit never guesses.

What the loader guarantees:

- **Only code you referenced runs.** The loader imports the exact file you named (or
  dropped in your working directory) — it never scans `node_modules`, never probes
  installed packages, never follows anything you did not explicitly reference.
- **Fail-loud, plain-language errors.** A throwing config, a missing import inside it, a
  non-manifest default export (including a Promise/thenable), or an invalid manifest
  exits 2 with a one-line message naming the file — never your file's contents, never a
  stack trace.
- **Namespaced findings.** Your rules run as `key/RULE_ID`, their findings appear under
  that namespaced id in every report, and they are suppressible by that same id
  (`--ignore 'acme-billing-checks/STATEMENT_DESCRIPTOR_MISSING'`).

## Testing a plugin

Test your rule the same way the core rules are tested: the **trigger / clean golden
pattern**. Build one snapshot that should fire the rule (trigger) and one that should not
(clean), and assert on the `Finding[]` your `check()` returns.

```ts
import { describe, it, expect } from 'vitest'
import { resolveRules } from 'stripe-audit'
import plugin from './my-plugin'

const resolved = resolveRules({ plugins: [{ key: plugin.meta.name, rules: plugin.rules }] })
const rule = resolved.find((r) => r.id === `${plugin.meta.name}/STATEMENT_DESCRIPTOR_MISSING`)!

it('fires on its trigger fixture', () => {
  expect(rule.check(triggerSnapshot)).toHaveLength(1)
})

it('is silent on its clean fixture', () => {
  expect(rule.check(cleanSnapshot)).toEqual([])
})
```

The committed
[`test/integration/plugin-example.test.ts`](../test/integration/plugin-example.test.ts)
does exactly this against the reference plugin, including the namespacing assertion — copy
it as your test scaffold.

## Related

- [`examples/stripe-audit-plugin-example/`](../examples/stripe-audit-plugin-example/) — the runnable reference plugin this guide walks through.
- [`schemas/stripe-audit.config.schema.json`](../schemas/stripe-audit.config.schema.json) — the published JSON config schema (editor autocomplete for the zero-code form).
- [`docs/baseline.md`](baseline.md) — the anti-regression gate. Suppressions apply first, then the baseline compares what remains; keep that ordering in mind when a plugin rule adds new findings.
