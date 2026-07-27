/**
 * stripe-audit — the package version, single-sourced from package.json.
 *
 * Re-exports `package.json`'s `version` so the CLI banner (`--version`), the
 * onboarding header, and the JSON report's `version` field can never drift from
 * the published package version. The bundler inlines the literal at build time,
 * so the shipped `dist/` carries only the string — no runtime file read, and no
 * whole-`package.json` in the output.
 *
 * Still a leaf module in the SOURCE graph — it imports a JSON *data* file, not
 * the package barrel `./index`, so `index → report → result → index` never forms
 * an import cycle; `buildAuditResult` (`./report/result`) reads `VERSION` here
 * directly.
 *
 * The disk-reading guard in `test/version.test.ts` fails CI if this ever diverges
 * from package.json again — it did once: a hand-maintained constant left 0.2.2
 * shipping a `--version` of 0.2.1.
 */
import { version } from '../package.json'

export const VERSION: string = version
