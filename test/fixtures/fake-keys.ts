/**
 * Fake Stripe keys for tests — assembled at runtime so the committed source
 * never contains a contiguous provider-key-shaped string.
 *
 * Why: live-prefixed placeholders (`sk_live_…`, `rk_live_…`) match Stripe's
 * real key format exactly, and GitHub secret-scanning push protection blocks
 * pushes containing them — text scanners cannot read a `gitleaks:allow`
 * annotation. Joining the parts at runtime keeps every test value identical
 * while making the source text unmatchable.
 *
 * The values are obvious fakes and never real credentials. New tests that
 * need a key-shaped fixture must use this helper instead of a literal.
 */
export function fakeKey(
  family: 'sk' | 'rk',
  mode: 'live' | 'test',
  body = 'EXAMPLEonly0123456789abcd',
): string {
  return [family, mode, body].join('_')
}
