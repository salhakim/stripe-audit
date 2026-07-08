# Scoring & grading

`stripe-audit` reduces an audit to a single **0–100 score** and an **A–F letter
grade** so a run is glanceable ("your billing config scores 72 / C"). The score
is the shared spine every reporter renders in its header — JSON summary, Markdown
header, HTML header, and the console one-liner all read the same
`scoreFindings(activeFindings)` result, so they never disagree.

`scoreFindings` is **pure and deterministic**: the same `Finding[]` always
produces the same `{ score, grade, worstSeverity }`. No network, no API key, no
randomness.

## What the score is computed over — ACTIVE findings only

The score is computed over the **active** findings of a run, and nothing else:

| Bucket | In the score? | Why |
|---|:---:|---|
| **Active findings** | ✅ yes | Real, evaluated misconfigurations on a readable region. |
| **Suppressed findings** | ❌ excluded | You explicitly muted them. A suppression is a decision, not a fix — it must not move the score in either direction, and a rule whose findings were all suppressed is not counted as passed (it fired; it is excluded from the `rulesPassed` tally and surfaced only in the Suppressed(N) count). |
| **Skipped rules** | ❌ excluded | Deep rules the base key could not run. **A skipped rule is NOT a passed rule** — counting it as passed would manufacture false assurance, so it is excluded from both the score and the `rulesPassed` tally. |

The caller passes the **post-suppression active list** (`applySuppressions →
{ active, suppressed }`); `scoreFindings` only ever reads each finding's
`severity`. Suppressed and skipped entries never reach it.

## The model — start at 100, deduct by severity

Score = `max(0, 100 − Σ severity weight)` over the active findings.

### Severity weights (per-finding deduction)

| Severity | Weight (points deducted) |
|---|:---:|
| `critical` | 25 |
| `high` | 10 |
| `medium` | 4 |
| `low` | 1 |
| `info` | 0 |

Two properties fall out of this weighting:

- **Monotonic in severity.** A higher severity deducts more, so adding a
  higher-severity finding can never *raise* the score. Adding any finding never
  raises the score; removing one never lowers it.
- **`info` is weightless.** Info findings are non-actionable notes (e.g. "v2
  event destinations were not audited"), not health problems. They surface in
  `worstSeverity` but do not move the score — an account whose only findings are
  info notes still scores 100 / A.

The score is **clamped to `[0, 100]`**: an account with many findings floors at 0
(grade F) rather than going negative.

## Grade thresholds

The letter grade is derived from the score with standard report-card cutoffs.
The first band (high → low) whose floor the score meets wins:

| Grade | Score threshold |
|---|---|
| **A** | 90 – 100 |
| **B** | 80 – 89 |
| **C** | 70 – 79 |
| **D** | 60 – 69 |
| **F** | 0 – 59 |

## `worstSeverity`

`worstSeverity` is the highest-ranked severity present among the active findings
(`critical` > `high` > `medium` > `low` > `info`), or `null` when there are no
active findings. Reporters use it to colour the header and lead with the most
urgent class of problem.

## Edge cases

- **Zero active findings** → `score: 100`, `grade: 'A'`, `worstSeverity: null`.
  A clean account is a perfect score.
- **The bundled `all-issues` fixture** (deliberately maximal — a finding in every
  severity band, led by a `critical`) floors at `score: 0`, `grade: 'F'`,
  `worstSeverity: 'critical'` — a sub-A grade, as expected for a broken account.

## API

```ts
import { scoreFindings } from 'stripe-audit'

const { score, grade, worstSeverity } = scoreFindings(activeFindings)
// e.g. { score: 72, grade: 'C', worstSeverity: 'high' }
```

`scoreFindings`, the `ScoreResult` / `Grade` types, and the `SEVERITY_PENALTY` /
`GRADE_BANDS` tables are all re-exported from the package index, so plugin
authors and downstream tooling share one scoring source of truth.
