/**
 * stripe-audit — shared TTY / ANSI helper.
 *
 * One home for the ANSI-stripping the console reporter's tests assert against and
 * the TTY check a caller can use to decide whether to colorize. chalk already
 * auto-detects color support (it emits no ANSI when stdout is not a TTY), so the
 * console reporter does not gate on `isColorTty` — but exposing it keeps the
 * detection in one place for callers and tests that need it.
 */

/** Matches a single ANSI SGR (color/style) escape sequence (ESC `[` … `m`). */
const ANSI_SGR = /\x1b\[[0-9;]*m/g

/**
 * Strip ANSI SGR escape sequences from `value`.
 *
 * Used so piped / non-TTY consumers (and snapshot tests) read the report's plain
 * text regardless of whether color was applied. Idempotent on already-plain text.
 */
export function stripAnsi(value: string): string {
  return value.replace(ANSI_SGR, '')
}

/** A full CSI sequence (ESC `[` … final byte) — cursor moves, erases, SGR, etc. */
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
/** An OSC sequence (ESC `]` … BEL or ST) — e.g. set-window-title. */
const OSC = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g
/** Remaining C0 control bytes + DEL (includes a lone ESC, CR, LF, TAB). */
const CONTROL = /[\x00-\x1f\x7f]/g

/**
 * Strip terminal control sequences and control characters from an UNTRUSTED
 * value before it is printed to a console.
 *
 * The console reporter interpolates account-controlled finding text (a webhook
 * URL, a product name) into terminal output; a value carrying raw escape
 * sequences could move the cursor, clear the screen, or set the window title.
 * This removes CSI (incl. SGR) and OSC sequences, then any remaining C0 control
 * bytes and DEL (incl. a lone ESC). Distinct from {@link stripAnsi}, which only
 * removes SGR color codes from the reporter's OWN trusted output for assertions.
 */
export function stripControl(value: string): string {
  return value.replace(CSI, '').replace(OSC, '').replace(CONTROL, '')
}

/** True when `stream` is an interactive terminal that can render color. */
export function isColorTty(stream: { isTTY?: boolean } = process.stdout): boolean {
  return Boolean(stream.isTTY)
}
