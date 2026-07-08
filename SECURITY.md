# Security Policy

Thank you for helping keep **stripe-audit** and its users safe. This is the public
vulnerability-disclosure policy for the `stripe-audit` CLI. It is intentionally
human-facing. stripe-audit is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Stripe, Inc.

## Read-only by design

stripe-audit is a **read-only** auditor. It only ever issues **read** calls to the
Stripe API and has no code path that creates, updates, or deletes anything in your
Stripe account — it **never writes to Stripe**. It is intended to run on a
[restricted API key](https://docs.stripe.com/keys/restricted-api-keys) granted
**Read** on just the six regions it audits (Account, Webhook Endpoints, Products,
Prices, Customer Portal, Tax). No write scope is required, and none should be
granted.

## Executable configuration — trust boundary

stripe-audit supports an optional configuration file. Two forms exist, with
different trust properties:

- **JSON config (`stripe-audit.config.json`) and the default core-only mode run
  zero third-party code.** If you pass no config, or a JSON config, stripe-audit
  executes only its own built-in rules. This is the zero-code option.
- **JavaScript config (`stripe-audit.config.{mjs,cjs,js}`) and any custom rule
  plugins it references are your own code.** Like an `eslint` or `prettier`
  config, an executable config file is loaded and run in your process. stripe-audit
  treats it as trusted input **you** authored — it is the same trust boundary as
  any script in your repository. There is **no `*-plugin-*` auto-discovery**:
  stripe-audit never scans `node_modules` for plugins and never loads code you did
  not explicitly reference from your own config. Only run a config or plugin whose
  source you trust, exactly as you would for any other dev-tool config.

**The restricted read-only key bounds the blast radius.** Because stripe-audit runs
under a read-only restricted key, even a malicious config or plugin loaded into the
process **cannot write to Stripe** and cannot read Stripe resources outside the
scopes you granted the key. Scoping the key to read-only limits the worst case of
any loaded code to reading the data the audit already reads.

## Reporting a Vulnerability

**Please do not open a public issue, pull request, or discussion for a suspected
vulnerability.** Public disclosure before a fix is available puts users at risk.

Instead, report it privately through the repository's **private vulnerability
reporting** feature (the **Security** tab → **"Report a vulnerability"**). This is
the primary — and preferred — channel: it opens a private advisory thread with the
maintainer, keeps the report confidential until a fix ships, and needs no email.

When you report, please include as much of the following as you can:

- A clear description of the issue and its potential impact.
- Step-by-step instructions or a proof of concept to reproduce it.
- The affected version, commit, or component.
- Any suggested remediation, if you have one.

Please give us a reasonable opportunity to investigate and remediate before any
public disclosure. We will coordinate a disclosure timeline with you and credit
reporters who wish to be acknowledged.

## Supported Versions

Security fixes are applied to the actively maintained release line. Unless stated
otherwise in the release notes, only the latest released version receives security
updates; older versions may not be patched.

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Previous releases | Best effort |
| Unreleased / development | Not covered |

## Scope

In scope:

- The source code and configuration in this repository.
- Officially published release artifacts (the `stripe-audit` npm package).

Out of scope:

- Vulnerabilities in third-party dependencies (please report those upstream; tell
  us if this project's usage is materially affected).
- Issues that require a compromised host, physical access, or already-elevated
  privileges.
- Reports generated solely by automated scanners without a demonstrated,
  exploitable impact.
- Social engineering, spam, denial of service through resource exhaustion, and
  best-practice suggestions without a concrete security impact.

## Response Expectations

- **Acknowledgement:** we aim to acknowledge a valid report within a few business days.
- **Assessment:** we will triage, confirm, assign a severity, and keep you updated.
- **Remediation:** we will work to release a fix as promptly as the severity warrants
  and notify you when it ships.
- **Disclosure:** once a fix is available, we will coordinate public disclosure and,
  where desired, credit the reporter.

These are good-faith targets, not contractual guarantees; timelines vary with
severity and complexity. We appreciate your responsible disclosure.
