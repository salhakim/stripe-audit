# Maintenance & Release Manual

The order-of-operations guide for maintaining and releasing **stripe-audit**. It
answers "what do I run, and in what order?" for the recurring maintainer tasks:
keeping the community-health profile complete, shipping a release, and staying on
top of dependency and CI hygiene.

> stripe-audit is **read-only** by design — it never writes to Stripe. Every
> change must preserve that guarantee (see [`SECURITY.md`](../SECURITY.md)).

---

## a. Community-health file checklist

GitHub recognizes these files at their canonical locations and surfaces them in
the repo's **Community Standards** page. Keep all present:

| File | Location | Purpose |
|---|---|---|
| `README.md` | repo root | Landing page, quickstart, badges |
| `LICENSE` | repo root | MIT © Sal Hakim · Atlas Maps |
| `CONTRIBUTING.md` | repo root | Dev setup + the quality gates a contributor runs |
| `CODE_OF_CONDUCT.md` | repo root | Contributor Covenant 2.1 |
| `SECURITY.md` | repo root | Private vulnerability reporting policy |
| `CREDITS.md` / `NOTICE` | repo root | Attribution (maintainer-repo only — intentionally not part of the public export; LICENSE + the README footer carry public attribution) |
| Issue forms | `.github/ISSUE_TEMPLATE/*.yml` | Bug report + feature request + `config.yml` chooser |
| PR template | `.github/PULL_REQUEST_TEMPLATE.md` | Checklist on every PR |

Contact model is **GitHub-only**: security reports and Code-of-Conduct
enforcement both route through the repository's **Security → Report a
vulnerability** (private reporting). No email address is published anywhere; the
package `author` is a send-only GitHub noreply mask.

---

## b. Documentation map (Diátaxis)

The docs are organized by the four [Diátaxis](https://diataxis.fr) modes — each
serves a different user need. When adding docs, place them by mode:

| Diátaxis mode | Serves | Where it lives in stripe-audit |
|---|---|---|
| **Tutorial** (learning-oriented) | A newcomer doing the thing for the first time | README **30-second quickstart** (`npx stripe-audit --demo`) |
| **How-to guide** (task-oriented) | A competent user with a goal | README CI-gate recipes; **this** maintenance manual; `CONTRIBUTING.md` |
| **Reference** (information-oriented) | A user who needs precise facts | [`docs/rules.md`](./rules.md) (rule catalogue), [`COVERAGE.md`](../COVERAGE.md) (census + API version), `--help` output |
| **Explanation** (understanding-oriented) | A user who wants the "why" | README **Read-only by design**; `SECURITY.md` threat model / trust boundary |

Rule of thumb: don't mix modes in one document — a reference page that drifts into
tutorial prose serves neither need well.

---

## c. Release runbook (order of operations)

Run these **in order**. Do not skip the dry-run or the export-clean step.

1. **Branch is green.** `main` CI is passing (lint, typecheck, tests, coverage,
   docs-drift, npm audit). Never cut a release from red.
2. **Version bump.** Bump `version` in `package.json` (semver). A `stripe` major
   bump also requires re-pinning `STRIPE_API_VERSION` in the same change.
3. **CHANGELOG.** Move the `## [Unreleased]` entries under a new
   `## [x.y.z] — YYYY-MM-DD` heading ([Keep a Changelog](https://keepachangelog.com)).
4. **Pack dry-run.** `npm pack --dry-run` — confirm the tarball contains only the
   `files` allowlist (`dist`, `README.md`, `LICENSE`) and no stray source. See the
   [npm `files` field docs](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files).
5. **Export / verify-clean.** Run the product export and confirm no
   framework-internal path leaks into the published surface (the publish-gate IP
   scan must be green).
6. **Publish dry-run, then publish.** `npm publish --dry-run` to preview the
   notices, then `npm publish` (public).
7. **Tag.** `git tag vX.Y.Z && git push --tags`. Cut a GitHub Release from the tag
   with the CHANGELOG section as the notes.

---

## d. Maintenance cadence

| Cadence | Task |
|---|---|
| Weekly (automated) | Triage **Dependabot** PRs — npm, docker-compose (stripe-mock pin), and GitHub Actions ecosystems. Merge safe minor/patch; coordinate `stripe` major re-pins by hand. **Dependency PRs are merged in the development tree only** — the mirror ships a Dependabot config with `open-pull-requests-limit: 0` (there is no settings toggle for version updates), and any PR opened against the mirror is closed (its bump arrives via the next sync commit). |
| On every push/PR | CI runs all gates including the **npm audit** job (`--omit=dev --audit-level=high`). |
| CI red | Fix forward or revert immediately — never let `main` sit red; releases gate on it. |
| Advisory alert | A high/critical production advisory fails the audit job — bump or replace the dependency promptly. |
| Issue / PR triage | Aim to acknowledge new issues within a few business days; security reports via private reporting take priority. |

---

## e. Automation inventory

What runs automatically, and where it's defined:

| Automation | Where | What it guards |
|---|---|---|
| **husky** pre-commit + **gitleaks** | `.husky/pre-commit` | Fail-closed secret scan of staged changes; also runs typecheck, lint, and `check:bytes`. |
| CI jobs | `.github/workflows/ci.yml` | lint-typecheck · test · stripe-mock · coverage (≥80%) · **docs-drift** · **npm audit** (high) |
| **docs-drift** guard | `npm run check:docs` | Reconciles committed docs against their code source-of-truth (demo SVG, API-version literals) so they can't silently staleen. |
| **check:bytes** | `npm run check:bytes` | Text-integrity: no raw control bytes in tracked files. |
| **npm audit** gate | `ci.yml` audit job | Fails on any high/critical advisory in production dependencies. |
| **Dependabot** ecosystems | `.github/dependabot.yml` | Weekly PRs for npm, docker, and github-actions pins. |
| IP publish gate | `.github/workflows/publish-gate.yml` | Scans for forbidden proprietary literals before anything ships. |

---

*Sources: [Diátaxis](https://diataxis.fr), [Keep a Changelog](https://keepachangelog.com),
[npm packaging docs](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files),
[Contributor Covenant](https://www.contributor-covenant.org), and GitHub's community-profile
documentation.*
