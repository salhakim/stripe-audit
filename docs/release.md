# Release runbook

The step-by-step procedure for cutting a **stripe-audit** release: build the
package, prove it publishes clean with a dry run, produce a fresh-history
product-only repository, and verify that repository carries no private material
before anything goes public.

> stripe-audit is **read-only** by design — it never writes to Stripe. A release
> must never weaken that guarantee (see [`SECURITY.md`](../SECURITY.md)).

This runbook is deliberately reproducible: every command below is safe to run
repeatedly, and **no step performs a real `npm publish`** until the final,
clearly-marked publish section. For the wider maintenance calendar (dependency
hygiene, community-health files), see [`maintenance.md`](./maintenance.md).

---

## 0. Preconditions

Run these once before starting. All must be true:

| Check | Command | Expect |
|---|---|---|
| On the default branch, clean tree | `git status --short` | empty |
| Node matches the pinned version | `node -v` vs [`.nvmrc`](../.nvmrc) | equal |
| Dependencies installed from the lockfile | `npm ci` | exit 0 |
| Full quality gate green | `npm run typecheck && npm run lint && npm test` | exit 0 |
| Docs ↔ CLI in sync | `npm run check:docs` | exit 0 |
| Version bumped + changelog entry | edit `package.json` `version` + [`CHANGELOG.md`](../CHANGELOG.md) | done |

Semantic-version the bump: patch for fixes, minor for new rules or flags, major
for a breaking CLI contract change.

---

## 1. Build the distributable

The published entry point is `dist/cli.js` (declared as `bin.stripe-audit` in
`package.json`). Build it with the bundler:

```bash
npm run build          # tsup → dist/
test -f dist/cli.js && echo BUILT
```

Smoke-test the built binary before continuing:

```bash
node dist/cli.js --version
node dist/cli.js --list-rules | head
```

---

## 2. Prove the package publishes clean (dry run)

`npm publish --dry-run` performs every step of a publish **except** the upload —
it never contacts the registry — and prints the exact tarball contents plus the
`npm notice` summary. Use it to confirm the `files` allowlist ships the product
surface and nothing private:

```bash
npm publish --dry-run
```

Read the `npm notice Tarball Contents` block and confirm:

- **Present:** `dist/`, `README.md`, `LICENSE`, `SECURITY.md`, `CHANGELOG.md`,
  `COVERAGE.md`, `docs/` (curated), `examples/`.
- **Absent:** every private path — `.claude/`, the internal research-notes
  directory, `framework.config.json`, `secops.md`, `PRD.json`, `progress.txt`,
  `LIBRARIAN.md`, `knowledge-map.md`, and any local database or fetch log.

`package.json` always ships `package.json`, `README*`, `LICENSE*`, and the `bin`
target regardless of `files`; the allowlist governs everything else. If a private
path appears, fix the `files` allowlist (and `docs/.npmignore`, which prunes the
mixed `docs/` tree) before proceeding — do not publish.

---

## 3. Produce the fresh-history public repository

The public repository must be a **brand-new git history** containing only the
shipped product. A `.gitignore` cannot untrack files that history already
recorded, so the only safe cut is a fresh `git init` that copies an explicit
allowlist of product paths — never a clone of this repository, and never a
reconnection of any private remote.

```bash
DEST="../stripe-audit-public"     # any empty scratch path outside this repo
npm run export:public -- "$DEST"  # → scripts/export-public.sh
```

The export copies the allowlisted product paths into `$DEST`, runs `git init`,
and makes exactly **one** commit. Confirm:

```bash
git -C "$DEST" rev-list --count HEAD  # → 1
git -C "$DEST" log --stat -1          # inspect the shipped file list
(cd "$DEST" && npm ci --dry-run --ignore-scripts --no-audit)  # exit 0 = tree installs from its lockfile
```

The `npm ci --dry-run` proves the exported tree ships a `package-lock.json`
that is present and in sync with its `package.json` — the shipped CI workflows
all install with `npm ci`, so a broken or missing lockfile here means every
public CI job would fail.

### 3.5 Subsequent releases — overlay sync (never force-push)

The fresh `git init` above is the **first-cut** procedure only. Once the
public repository exists, it operates as a **release mirror**: development,
dependency merges, and the history-of-record stay in this repository, and the
mirror advances by exactly one overlay commit per sync:

```bash
bash scripts/sync-public.sh "stripe-audit vX.Y.Z"
```

The script re-exports the allowlist, replaces the mirror's tracked tree
wholesale (so removed paths propagate as deletions), re-runs the fail-closed
verifier on the assembled tree, commits once, and fast-forward pushes — fully
compatible with the mirror's branch protection (force-pushes and deletion are
blocked there by a repository ruleset).

Mirror rules of the road:

- **Never edit the mirror directly** (including via the GitHub UI). A direct
  edit diverges from this tree and the next sync silently overwrites it —
  make the change here, then sync.
- **Never merge a Dependabot PR on the mirror.** Version updates are disabled
  there; bumps are reviewed and merged here and arrive via the next sync.
- The mirror may run ahead of the latest published npm tarball between
  releases — that is normal; the tag marks what shipped.

The allowlist is fail-safe: a path that is not listed can never ship, so a future
private file added to this repository does not leak by default.

---

## 4. Verify the export is clean (fail-closed)

This is the last line of defence before anything is public. The export script
already tail-calls the verifier fail-closed, but run it explicitly and read the
result:

```bash
npm run verify:export -- "$DEST"   # → scripts/verify-export-clean.sh
echo "exit: $?"                    # 0 = clean; non-zero = STOP
```

The verifier applies three orthogonal, fail-closed guards over the exported tree:

1. **Private-path denylist** — refuses if any private engineering path
   (`.claude/`, the internal research-notes directory, `framework.config.json`,
   `secops.md`, `PRD.json`, `progress.txt`, `LIBRARIAN.md`, `knowledge-map.md`,
   a local database, a fetch log, or internal planning / project-log
   directories) is present.
2. **Secret detection** — delegates to `gitleaks dir` using the shipped
   [`.gitleaks.toml`](../.gitleaks.toml), the same scanner the pre-commit hook
   requires. A missing `gitleaks` binary **fails closed** (non-zero), so an
   unscanned tree is never mistaken for a clean one. Install it first:
   `brew install gitleaks`.
3. **Private-brand content scan** — refuses if any private tooling term appears
   in a shipped file. The owner brand is explicitly allowed, so legitimate
   attribution never trips it.

A non-zero exit from any guard means **do not publish** — fix the reported path,
secret, or term at its source, re-run the export (§3), and re-verify.

---

## 4.5 — v0.2.0 launch checklist (ownership split)

The v0.2.0 cut runs with an explicit ownership split: automation proves READY
and prepares every artifact; **the maintainer performs the two irreversible
public actions** (the registry publish and the go-ahead for the public push).

Proven-READY state (all verified green before this checklist starts):

- [x] Full local gate chain — build, tests, typecheck, lint, byte-integrity,
      docs-drift — exit 0.
- [x] `npm pack --dry-run` shows the product-only surface: zero `.map` files,
      zero work-item references (story/observation IDs or internal grammar)
      in any shipped byte.
- [x] Fresh export (§3) + strict verify (§4, `VERIFY_STRICT_GITLEAKS=1`)
      exit 0 — no private path, secret, brand term, or internal vocabulary.
- [x] The release workflow fires on manual dispatch only, so the §6 tag in
      this repository can never trigger an unintended CI publish.

Launch order (do not reorder — the publish precedes the public push):

1. **Maintainer:** restore npm auth — `npm login` (verify with `npm whoami`).
   Without it §5 is impossible; the OTP is the maintainer's.
2. **Maintainer:** run §5 `npm publish --access public` from the verified
   export directory (`$DEST`). This supersedes the 0.0.1 name-reservation
   placeholder on the registry.
3. **Maintainer → go-ahead:** only after the registry accepts, the public
   push happens — push the verified fresh-history export to the (already
   public, empty) `salhakim/stripe-audit` repository. This is the moment the
   code is live.
4. **Either:** run §6 — tag `v0.2.0` in this repository (inert for CI by
   design) and run the post-publish sanity checks:
   `npm view stripe-audit version` → `0.2.0`, then `npx stripe-audit --version`.

---

## 5. Publish (the only real-publish step)

Only after §2 is clean, §3 yields exactly one commit, and §4 exits `0`:

```bash
# From the verified export: install + build FIRST. The export ships source,
# not build output — a bare `npm publish` here fails (the `prepare` script
# can't find husky without node_modules, and the packed tarball would be
# missing dist/ entirely).
cd "$DEST"
npm ci                             # devDeps: husky (prepare), tsup (build)
npm run build                      # produce dist/ inside the export
npm publish --dry-run              # integrity check: shasum must match the §2 run
npm publish --access public        # THE real publish — everything above was a rehearsal
```

Then push the public history to the public remote (configure it on `$DEST`
first; never point it at this repository's remote):

```bash
git -C "$DEST" remote add origin <public-repo-url>
git -C "$DEST" push -u origin HEAD
```

---

## 6. Tag and record

Back in this repository, tag the release and confirm the changelog:

```bash
git tag -a "v$(node -p "require('./package.json').version")" -m "release"
git push origin --tags
```

Confirm the new version resolves for consumers:

```bash
npm view stripe-audit version      # → the version you just published
npx stripe-audit --version
```

---

## 7. CI publish with provenance (recommended for v0.2.1+)

§5 is the **manual** first-cut publish used for v0.2.0. From **v0.2.1 onward the
recommended path is a CI publish through the public mirror**, because npm
**provenance attestations can only be generated by a cloud CI/CD provider on a
cloud-hosted runner** — a local `npm publish` can never attach them ([npm:
generating provenance statements](https://docs.npmjs.com/generating-provenance-statements)).
A provenance-attested version is signed by Sigstore, logged in a public
transparency ledger, and shows a **provenance** badge on its npm page.

> Provenance runs on the **public mirror** (`salhakim/stripe-audit`), not this
> private repository. The attestation binds the tarball to the public source repo
> and the workflow run that built it, so `package.json`'s `repository`
> (`git+https://github.com/salhakim/stripe-audit.git`) must match — case-sensitive —
> where the publish runs from.

### 7.1 One-time — provision the public-mirror secrets

The CI publish needs two repository secrets on the **public mirror** (`Settings →
Secrets and variables → Actions`). Both are referenced by **name** only; no key
material ever enters the repo (S1), and both are least-privilege (S4):

| Secret | Scope | Used by |
|---|---|---|
| `NPM_TOKEN` | An **automation** npm token with publish rights for `stripe-audit` only. | `release.yml` publish step (`NODE_AUTH_TOKEN`). |
| `STRIPE_AUDIT_RELEASE_KEY` | A **restricted, read-only** Stripe key on the deliberately-misconfigured reference account. | `release.yml` fail-closed pre-publish smoke. |

The reference account's identity and the exact per-secret provisioning steps are
kept in a **team-internal note outside this published tree** — this runbook cites
secrets by name only, never key material and never the reference account's identity.
Use a **restricted, read-only test-mode key** (`rk_test_…`) so a leak exposes only
sandbox data.

### 7.2 Publish a provenance-attested version

1. **Here (private repo):** bump `package.json` `version` and add the
   [`CHANGELOG.md`](../CHANGELOG.md) entry (§0), commit, and run the full local gate
   (`npm run typecheck && npm run lint && npm test && npm run check:docs`).
2. **Sync the mirror** so the bumped `package.json` and the current `release.yml`
   reach the public repo — `bash scripts/sync-public.sh "stripe-audit vX.Y.Z"` (§3.5).
3. **On the public mirror:** `Actions → release → Run workflow` (manual
   `workflow_dispatch`). The job first runs the **fail-closed pre-publish smoke**
   against the broken reference account with `STRIPE_AUDIT_RELEASE_KEY` — a **green**
   audit on the known-bad account means detection regressed and the publish is
   **blocked** — then runs `npm publish --provenance --access public` under
   `id-token: write`, which mints the OIDC token npm exchanges for the Sigstore
   attestation.

The workflow fires on **manual dispatch only** — no tag or push triggers it — so a
`v*` tag in either repo can never race an unintended publish.

### 7.3 Verify the attestation

```bash
npm view stripe-audit dist.attestations   # populated (was empty for the manual 0.2.0)
npm audit signatures                       # "N packages have verified attestations"
```

The version's npm page then shows a **provenance** section linking back to the
public source commit and the `release.yml` run that built it.

---

## Quick reference

| Phase | Command | Gate |
|---|---|---|
| Build | `npm run build` | `dist/cli.js` exists |
| Dry run | `npm publish --dry-run` | tarball shows product-only surface |
| Export | `npm run export:public -- "$DEST"` | exactly 1 commit |
| Verify | `npm run verify:export -- "$DEST"` | exit 0 |
| Sync mirror | `bash scripts/sync-public.sh "stripe-audit vX.Y.Z"` | 1 overlay commit, ff push |
| Publish | `cd "$DEST" && npm ci && npm run build && npm publish --access public` | registry accepts |
| CI publish (provenance) | `Actions → release → Run workflow` (public mirror) | `npm view stripe-audit dist.attestations` populated |
| Tag | `git tag -a vX.Y.Z && git push --tags` | tag visible |
