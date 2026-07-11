/**
 * stripe-audit — the package version, single-sourced.
 *
 * Kept in its own leaf module (no imports) so any module can read `VERSION`
 * without importing the package barrel (`./index`). The barrel re-exports it;
 * `buildAuditResult` (`./report/result`) reads it from here directly, which
 * keeps `index → report → result → index` from forming an import cycle.
 *
 * Kept in sync with `package.json` at release time.
 */
export const VERSION = '0.2.1'
