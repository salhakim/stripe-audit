# stripe-audit plugin example

A minimal, copy-paste-able reference plugin for [`stripe-audit`](https://www.npmjs.com/package/stripe-audit). It shows the whole plugin seam end-to-end using **only public exports** — the same thing you would write against the published npm package.

For the full walkthrough see [`docs/writing-plugins.md`](../../docs/writing-plugins.md); this directory is the runnable companion.

## What it demonstrates

- **`defineRule({...})`** — the typed identity helper that gives you full type-checking of a `Rule` without importing any internal path.
- **The Plugin manifest convention** — a module that default-exports `{ meta: { name, version, apiVersion }, rules: Rule[] }`.
- **`CORE_API_VERSION` pinning** — `meta.apiVersion` is set to the host's `CORE_API_VERSION`, declaring which major contract the plugin targets. The contract is append-only within a major, so the plugin survives minor host bumps.
- **The `resolveRules` bridge** — the host merges your plugin via `resolveRules({ plugins: [{ key: meta.name, rules: meta.rules }] })`. Each rule resolves under `meta.name/<RULE_ID>`, so a plugin rule can never collide with a core rule id.

## The rule

`STATEMENT_DESCRIPTOR_MISSING` (`medium` · `configuration`) flags an account with no card statement descriptor — a blank descriptor shows customers an unrecognizable charge, driving avoidable disputes and chargebacks.

## Using it

```ts
import { resolveRules } from 'stripe-audit'
import plugin from './index'

// Bridge the manifest into the host: meta.name is the resolve key.
const rules = resolveRules({ plugins: [{ key: plugin.meta.name, rules: plugin.rules }] })

// Each rule is a pure check(snapshot) => Finding[] — run it over a snapshot.
const resolved = rules.find((r) => r.id === `${plugin.meta.name}/STATEMENT_DESCRIPTOR_MISSING`)
const findings = resolved?.check(snapshot) ?? []
```

## Testing a plugin

Test your rule the same way the core rules are tested: run its `check()` over a **trigger** fixture (asserts it fires the expected `Finding`) and a **clean** fixture (asserts it returns `[]`). The committed suite [`test/integration/plugin-example.test.ts`](../../test/integration/plugin-example.test.ts) does exactly this against this example, and also proves the resolved rule id is namespaced.
