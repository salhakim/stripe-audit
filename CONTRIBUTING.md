# Contributing to stripe-audit

Thanks for your interest in improving **stripe-audit** — a read-only Stripe
billing audit & lint CLI that scans a Stripe account and reports revenue-losing
misconfigurations as severity-ranked findings. Bug reports, new lint rules, doc
fixes, and rule-coverage improvements are all welcome.

By participating you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

---

## Read-only, always

stripe-audit **only ever issues read calls** to the Stripe API — it has no code
path that creates, updates, or deletes anything in an account. Any contribution
must preserve that guarantee. A change that introduces a write call to Stripe
will not be accepted. When in doubt, run the tool against a
[restricted read-only key](https://docs.stripe.com/keys/restricted-api-keys) and
confirm nothing mutates.

---

## Local development

Requires Node.js `>= 20`.

```bash
git clone https://github.com/salhakim/stripe-billing-audit-kit.git
cd stripe-billing-audit-kit
npm ci            # install exact, locked dependencies
npm run build     # compile TypeScript to dist/
npm start -- --demo   # run the bundled keyless demo audit
```

`npm ci` is preferred over `npm install` — it installs from the lockfile so your
environment matches CI exactly.

---

## The quality gates

Run these before opening a pull request. CI runs the same set, so a green local
run means a green PR.

| Command | What it checks |
|---|---|
| `npm test` | The full unit + integration test suite (Vitest). |
| `npm run lint` | ESLint over the whole tree. |
| `npm run typecheck` | `tsc --noEmit` — no type errors. |
| `npm run check:bytes` | Text-integrity: no raw control bytes in tracked files. |
| `npm run check:docs` | Documentation-drift guard (run `npm run build` first). |

A quick one-liner before you push:

```bash
npm run build && npm test && npm run lint && npm run typecheck && npm run check:bytes && npm run check:docs
```

### Pre-commit secret scan

A [husky](https://typicode.github.io/husky/) pre-commit hook runs
[`gitleaks`](https://github.com/gitleaks/gitleaks) against your staged changes
and **blocks the commit** if a potential secret is detected (it is fail-closed —
a missing scanner also blocks). Install the scanner once:

```bash
brew install gitleaks   # or see the gitleaks README for other platforms
```

If a match is a genuine, inspected placeholder, append `# gitleaks:allow` to that
single line. Never commit a real API key.

---

## Adding or changing a lint rule

Each rule is documented in [`docs/rules.md`](./docs/rules.md), and the full
coverage census (with the Stripe API version each rule targets) lives in
[`COVERAGE.md`](./COVERAGE.md). When you add or change a rule:

1. Implement the rule and add unit tests covering both the firing and the
   clean case.
2. Update `docs/rules.md` with the rule id, what it detects, and the fix.
3. Update `COVERAGE.md` if the rule adds coverage.
4. Confirm `npm run check:docs` stays green.

---

## Pull request flow

1. Fork the repo and create a topic branch off `main`.
2. Make your change with focused, logically-scoped commits.
3. Run the quality gates above — all green.
4. Record notable user-facing changes under an `## [Unreleased]` heading in the
   changelog, following the [Keep a Changelog](https://keepachangelog.com)
   convention.
5. Open a PR describing **what** changed and **why**. Link any related issue.

### Commit hygiene

- Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`,
  `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Imperative mood, lowercase after the colon (`fix: correct retry backoff`).
- One logical change per commit — split unrelated concerns.
- Explain intent in the body, not a restatement of the diff.

---

## Reporting bugs & requesting features

Open an issue using the templates in the repository's issue chooser. For
security-sensitive reports, **do not** open a public issue — use the private
reporting channel described in [`SECURITY.md`](./SECURITY.md).
