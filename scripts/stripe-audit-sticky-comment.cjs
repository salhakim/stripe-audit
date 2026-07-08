// Sticky PR comment for the Stripe Billing Audit Action.
//
// A pure find-or-update function invoked from action.yml's actions/github-script
// step:  await require('.../stripe-audit-sticky-comment.cjs')({ github, context, core, body })
//
// It keeps the audit's Markdown report as a SINGLE self-updating PR comment,
// keyed on a hidden HTML marker so re-runs update the existing comment instead of
// spamming a new one each time. No Stripe key material lives here.

const MARKER = '<!-- stripe-audit-report -->'

/**
 * Find-or-update the sticky audit comment on the current PR.
 *
 * @param {object}   args
 * @param {any}      args.github  - octokit REST client (github-script `github`).
 * @param {any}      args.context - workflow context (github-script `context`).
 * @param {any}      [args.core]  - actions core (optional; used for info logs).
 * @param {string}   [args.body]  - the Markdown report body; falls back to
 *                                  $STRIPE_AUDIT_REPORT_BODY when omitted.
 * @returns {Promise<{action:'update'|'create'|'skip', id?:number}>}
 */
async function stickyComment({ github, context, core, body }) {
  const reportBody = body ?? process.env.STRIPE_AUDIT_REPORT_BODY ?? ''

  // Skip cleanly when there is no PR context (push / tag events) — the job
  // summary still renders; only the comment is PR-scoped.
  const issueNumber = (context.issue || {}).number
  if (!issueNumber) {
    core?.info?.('stripe-audit: no pull-request context — skipping sticky comment.')
    return { action: 'skip' }
  }

  const { owner, repo } = context.repo
  const commentBody = `${MARKER}\n${reportBody}`

  // Paginate so the marker is found even on PRs with >100 comments.
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  })
  const existing = comments.find((c) => c.body && c.body.includes(MARKER))

  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body: commentBody,
    })
    return { action: 'update', id: existing.id }
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: commentBody,
  })
  return { action: 'create' }
}

module.exports = stickyComment
module.exports.MARKER = MARKER
