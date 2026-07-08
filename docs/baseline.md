# Baseline / anti-regression gate

`stripe-audit` can gate CI on **new** billing misconfigurations only. You capture
the current state of your account as a *baseline*, commit it, and then every run
compares against it — the audit fails **only when a new finding appears**, never
because an existing finding is still there or the score drifted down. This is a
*coverage gate*, not a score gate: it fails on new gaps, not on noise.

This is the anti-abandonment spine. A noisy account that would otherwise score an
`F` and block every PR can adopt a baseline once, then hold the line — new
problems are caught, old ones don't cry wolf.

## The two commands

| Command | What it does |
|---|---|
| `--write-baseline <file>` | Run the audit and **write** the current findings as a baseline to `<file>`. Accepts current reality. Exits `0`. |
| `--baseline <file>` | Run the audit and **compare** against the baseline at `<file>`. Exits `1` if a new finding appeared, else `0`. |
| `--check-baseline <file>` | Exact alias of `--baseline` — same option, same behavior. Use whichever reads better in your CI. |

`--baseline` and `--check-baseline` are the same flag; pick one. The baseline
`<file>` is a small JSON document (`apiVersion`, `createdAt`, `score`, `grade`,
and a list of per-finding fingerprints).

## Exit codes

The baseline gate delegates the completed-audit exit code to the standard
`stripe-audit` exit-code contract (see the CLI `--help` and the exit-code owner in
`src/exit-codes.ts`) — it does **not** invent new codes. Only the baseline-relevant
rows matter here:

| Situation | Exit code |
|---|:---:|
| Compared against a baseline, **a new finding appeared** (regression) | `1` |
| Compared against a baseline, **no new finding** — even if the score dropped | `0` |
| `--write-baseline` wrote the file | `0` |
| Baseline file missing, unreadable, or an old/invalid shape | `2` (configuration error) |

The key rule: **a lower score with no new finding is NOT a regression.** If you
resolve one finding and introduce a different, milder one, the score may barely
move — but the new fingerprint still trips the gate (exit `1`). Conversely, if
findings only get *worse in severity* on resources that were already flagged, the
score falls but no new fingerprint appears, so the gate stays green. The gate
tracks **coverage** (which problems exist), not the score.

When you pass both `--write-baseline` and `--baseline`, **write wins**: the
current reality is written and the run exits `0`.

## The pipeline order: suppress → baseline → score

The audit stages run in a **locked order**:

```
suppress → baseline → score
```

This order is the single most important thing to understand about the gate:

1. **suppress** — your `.stripeauditignore` / `--ignore` patterns are applied
   first. Suppressed findings are removed from the active set.
2. **baseline** — the comparison runs over the **active (post-suppression)**
   findings only. The baseline never sees a suppressed finding, so suppressing a
   noisy rule also removes it from the baseline on the next `--write-baseline`.
3. **score** — the 0–100 score and grade are computed **last**, over the same
   active findings (see [scoring.md](./scoring.md)).

Because suppression happens *before* the baseline, a noisy account can go green
two ways: **suppress** the noise (a permanent decision to ignore a rule/resource)
or **baseline** it (accept today's findings and gate on anything new). Suppress
what you never want to hear about again; baseline what you want to hold the line
on.

## The baseline file is yours

`stripe-audit` is **stateless** — it never hosts your baseline. The baseline file
is **user-owned**: it lives in **your own git repo**, committed alongside your
code, and `stripe-audit` only reads and writes it. There is no server, no account,
no hidden state. If you delete the file, the gate simply has nothing to compare
against until you write a new one.

Commit the baseline so every contributor and every CI run compares against the
same reference.

## CI recipe: write once, check every run

The workflow is two phases — a one-time capture, then a check on every run.

**1. Write the baseline once** (locally, when you first adopt the gate or after an
intentional cleanup), and commit it:

```bash
stripe-audit --key "$STRIPE_RESTRICTED_KEY" --write-baseline .stripe-audit-baseline.json
git add .stripe-audit-baseline.json
git commit -m "chore: capture stripe-audit baseline"
```

**2. Check on every run** in CI — the job fails only on a new finding:

```bash
# exits 1 (fails the job) iff a NEW finding appeared vs the committed baseline
stripe-audit --key "$STRIPE_RESTRICTED_KEY" --baseline .stripe-audit-baseline.json
```

When you intentionally accept a new state (you fixed something, or you've decided
to live with a finding), re-run `--write-baseline` to move the line forward, and
commit the updated file. That commit is the audit trail of what your team chose to
accept and when.

## See also

- [scoring.md](./scoring.md) — how the 0–100 score and A–F grade are computed
  (the `score` stage that runs after the baseline comparison).
- [rules.md](./rules.md) — the full catalog of findings a baseline can capture.
