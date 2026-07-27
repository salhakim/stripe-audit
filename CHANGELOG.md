# Changelog

All notable changes to **stripe-audit** are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] — 2026-07-14

Security patch for the Markdown reporter, plus a version-reporting fix. No
functional changes to the audit — same 40 rules, still read-only; it **never
writes to Stripe**.

### Security

- **Complete output-escaping in the Markdown reporter.** The Markdown escaper
  neutralized the `|` table delimiter with a backslash but did not escape the
  backslash itself first, so an account-controlled value containing `\|` (a
  coupon or product name, a webhook URL) could break out of a table cell in a
  rendered PR comment / `$GITHUB_STEP_SUMMARY`, and a pre-encoded `&lt;`/`&gt;`
  could slip past the angle-bracket neutralization. The escaper now escapes the
  backslash before the pipe and `&` before `<`/`>` (fixes CodeQL
  `js/incomplete-sanitization`). The HTML, SVG, and Markdown escapers are now
  consolidated into one audited module so their escape tables can't diverge.

### Fixed

- **`stripe-audit --version` now reports the actual package version.** The
  version constant had lagged one release behind, so 0.2.2 printed `0.2.1` (and
  stamped it into the JSON report's `version` field); it is now single-sourced
  in lockstep with `package.json`.

## [0.2.2] — 2026-07-10

Profile-polish patch release. No functional changes to the audit — same 40
rules, still read-only; it **never writes to Stripe**.

### Added

- **`prepublishOnly` publish gate.** `npm publish` (including `--dry-run`) now
  runs `build && typecheck && test` first, so a red suite blocks a release
  before anything is packed. Day-to-day `npm pack` / `npm install` are
  unaffected.
- **Root `.npmignore` pack guard.** A fallback denylist (secrets, local
  databases, internal tooling, dev sources) that takes over pack-ignore duty
  if the `files` allowlist is ever removed — regression-locked by a new test.
- README hero badges for the GitHub Marketplace Action and npm monthly
  downloads.
- Six more npm keywords (13 total) for registry discoverability.

### Fixed

- **GitHub now detects the license as MIT.** The LICENSE copyright notice is
  a single line again (attribution moved to the README), which restores
  licensee's exact-match MIT detection — the repo renders the MIT chip and
  `license.spdx_id` reads `MIT` instead of `NOASSERTION`.

## [0.2.1] — 2026-07-10

The first **stripe-audit** release published through CI with **npm provenance**.
No functional changes to the audit — same 40 rules, still read-only; it **never
writes to Stripe**.

### Added

- **Provenance attestations.** This version is published from GitHub Actions via
  OIDC (`npm publish --provenance`), so its npm page carries a Sigstore-signed
  provenance attestation that links the published tarball to its public source
  commit and the workflow run that built it. Verify with `npm audit signatures`.
- The release runbook ([`docs/release.md`](docs/release.md)) now documents the
  CI-publish (provenance) path alongside the manual publish path.

## [0.2.0] — 2026-07-08

Deep-audit mode graduates from a no-op to a live feature, growing the catalog to
**40 rules** (35 `base` + 5 `deep`). Still read-only — it **never writes to
Stripe**.

### Added

- **`--deep` mode is now live.** With a deep-scoped restricted key, stripe-audit
  also reads subscriptions, billing meters, event destinations, and coupons, and
  runs **5 additional `deep` rules**: `BILLING_MODE_NOT_MIGRATED`,
  `METER_ERROR_NOT_MONITORED`, `HIGH_PERCENT_COUPON`, `HIGH_AMOUNT_COUPON`, and
  `FOREVER_COUPON_STILL_VALID`. A base-scoped key stays safe — each ungranted deep
  region degrades to a **skipped** rule instead of an error, and the CLI prints
  the exact permissions to add. See [`docs/scopes-reference.md`](docs/scopes-reference.md).
- **The config-file loader is live.** stripe-audit now reads
  `stripe-audit.config.{json,mjs,cjs,js}` from the working directory (or an explicit
  `--config <file>`; `--no-config` skips). The **JSON** form is data-only — settings +
  `ignore` patterns against the published schema, zero third-party code. The
  **executable** forms can also **register plugins**, whose rules run namespaced
  (`key/RULE_ID`) and whose findings are suppressible by that namespaced id. Settings
  merge per key at CLI flag > config file > built-in default; ambiguous discovery
  (more than one candidate) and every malformed/invalid config are refused with a
  plain-language exit 2. See the README's "Extending with config & plugins" and
  [`docs/writing-plugins.md`](docs/writing-plugins.md).
- **Dual ESM + CJS packaging via a conditional `exports` map.** `import`
  resolves the ESM build (`dist/index.mjs` + `.d.mts`) and `require` the CJS
  build (`dist/index.js` + `.d.ts`) under `moduleResolution: node16/nodenext`,
  with legacy `main`/`module`/`types` retained. Known trade-off of any dual
  build: ESM and CJS consumers get **separate module instances**, so
  cross-boundary identity checks (e.g. `instanceof RuleResolutionError` across
  an ESM/CJS seam) fail — import the library through one module system.
- **`--output badge`** — emit an SVG "Stripe Health" score badge for a README or
  dashboard, alongside the existing `console | json | markdown | html` formats.
- **`--report-unused-suppressions`** — advisory flag that lists suppression
  entries (`.stripeauditignore` lines / `--ignore` patterns) which matched no
  finding this run, without ever changing findings, score, or exit code.
- **Published GitHub Action** — `salhakim/stripe-audit@v0` wraps the CLI, posts a
  single sticky pull-request score comment, appends the report to the job summary,
  and exposes `score` / `grade` outputs. See the README's CI section and
  [`examples/github-action.yml`](examples/github-action.yml).

### Changed

- The rule catalog is now **40 rules** (was 35). The census in
  [`COVERAGE.md`](COVERAGE.md) and the per-rule detail in
  [`docs/rules.md`](docs/rules.md) cover the full base + deep set.

### Fixed

- An **empty filter list** — `--severity ,` on the CLI, or an empty
  `severity`/`category` array in a config file — is now refused as a config error
  (exit 2) instead of silently selecting zero rules and grading a run that audited
  nothing as 100/A (#9).

### Notes

- Every rule remains written and validated against Stripe API `2026-06-24.dahlia`.

## [0.1.0] — 2026-06-30

The first release of `stripe-audit` — a read-only CLI that scans a Stripe account
and reports revenue-losing billing misconfigurations as severity-ranked findings.
Think "eslint for your Stripe billing config." It **never writes to Stripe**.

### Added

- **35 read-only rules** across five categories — webhooks, billing / customer
  portal, pricing, tax & account configuration, and security / account health.
  Each finding names the misconfiguration, why it costs money or risk, and the
  one action that fixes it. The full catalog is in
  [`docs/rules.md`](docs/rules.md); the census is in [`COVERAGE.md`](COVERAGE.md).
- **Keyless demo** — `stripe-audit --demo` audits bundled sample data with no key
  and no network, so you can see a graded report before connecting an account.
- **Rule introspection** — `stripe-audit --list-rules` prints every shipped rule
  (id, scope, category, severity) and exits; no key required.
- **Report formats** — `--output console | json | markdown | html` for humans,
  CI gates, PR summaries, or dashboards.
- **Findings filters** — `--severity` and `--category` to scope a run, and
  `--fail-on <level>` to exit non-zero at/above a chosen severity (the CI gate).
- **Suppression** — a gitignore-style `.stripeauditignore` file plus the
  repeatable `--ignore` flag, matched by rule id, `:resource`, or `rule:resource`.
- **Baselines** — `--write-baseline` accepts the current findings as a committed
  baseline and `--baseline` fails only on new regressions.
- **Config** — an optional `stripe-audit.config.{mjs,cjs,js,json}` file, with
  `--no-config` to run the core rules only.
- **Restricted-key model** — runs on a read-only restricted key scoped to just
  six read regions (Account, Webhook Endpoints, Products, Prices, Customer Portal,
  Tax); the security model is documented in [`SECURITY.md`](SECURITY.md).

### Notes

- `--deep` (subscriptions, radar, meters, and event-destination rules) is accepted
  as a no-op in v0.1.0 and ships in v0.2.

## Stripe API compatibility

| stripe-audit | Stripe API version | stripe SDK |
|---|---|---|
| 0.2.2 | `2026-06-24.dahlia` | `stripe@^22` |
| 0.2.1 | `2026-06-24.dahlia` | `stripe@^22` |
| 0.2.0 | `2026-06-24.dahlia` | `stripe@^22` |
| 0.1.0 | `2026-06-24.dahlia` | `stripe@^22` |

Every rule is written and validated against the pinned Stripe API
version **`2026-06-24.dahlia`** — the SDK's `LatestApiVersion` literal, exported
from the package as `STRIPE_API_VERSION` and pinned on the Stripe client. When the
audit logic is validated against a newer Stripe API version, that change is
recorded here alongside the release that ships it.

[0.2.2]: https://github.com/salhakim/stripe-audit/releases/tag/v0.2.2
[0.2.1]: https://github.com/salhakim/stripe-audit/releases/tag/v0.2.1
[0.2.0]: https://github.com/salhakim/stripe-audit/releases/tag/v0.2.0
[0.1.0]: https://github.com/salhakim/stripe-audit/releases/tag/v0.1.0
