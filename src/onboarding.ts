/**
 * stripe-audit — branded no-key onboarding panel.
 *
 * Shown when stripe-audit runs with NO key (no `--key`, no `STRIPE_SECRET_KEY`):
 * what the tool is, the read-only / never-writes assurance (the product's core
 * trust property), and how to get a key. It is informational copy — never a thrown
 * exception or stack trace — and the CLI exits with the configuration code (2).
 *
 * Pure: returns the panel string; the caller writes it to STDERR (human
 * copy never touches stdout, so `--output json` stays parseable). chalk v4
 * auto-disables color off a TTY, so piped/captured output is plain text.
 *
 * The key-creation section renders the restricted-key link + the exact
 * read-scope checklist (the same link the 401 path renders);
 * `{deep: true}` swaps in the base-6 + deep-scope variant.
 */
import chalk from 'chalk'
import { VERSION } from './version'
import { buildRestrictedKeyLink, buildDeepRestrictedKeyLink } from './deep-link'

/** A horizontal rule sized to the panel width. */
const RULE = chalk.dim('─'.repeat(64))

/**
 * Render the branded onboarding panel as a single string (no trailing newline).
 * `deep` swaps in the deep-link variant so a `--deep` invocation shows
 * the base-6 PLUS deep read scopes up front instead of a second key round-trip.
 */
export function renderOnboardingPanel(options: { deep?: boolean } = {}): string {
  const link = options.deep ? buildDeepRestrictedKeyLink() : buildRestrictedKeyLink()
  // The exact least-privilege scope checklist: each granted Read, nothing else.
  const scopeChecklist = link.scopes.map((scope) => `       • ${scope}: Read`).join('\n')
  return [
    RULE,
    `${chalk.bold.cyan('stripe-audit')} ${chalk.dim(`v${VERSION}`)} — read-only Stripe billing audit & lint`,
    RULE,
    '',
    'Scans your Stripe account for revenue-losing misconfigurations and reports',
    'them as severity-ranked findings — like eslint, for your billing config.',
    '',
    chalk.green('✓ Read-only — stripe-audit only reads; it never changes anything in your account.'),
    '',
    chalk.bold('How to get started:'),
    '  1. Create a read-only restricted API key here:',
    `       ${chalk.cyan(link.url)}`,
    `     Grant Read on exactly these ${link.scopes.length} resources (set every other resource to None):`,
    scopeChecklist,
    `  2. Run:  stripe-audit ${options.deep ? '--deep ' : ''}--key rk_live_…   (or set STRIPE_SECRET_KEY)`,
    '  3. No key yet? See a sample report:  stripe-audit --demo',
    RULE,
  ].join('\n')
}
