import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// The sticky-comment logic ships as a CommonJS script (github-script requires it
// at runtime via GITHUB_ACTION_PATH). Load it the same way here.
const require = createRequire(import.meta.url)
const stickyComment = require('../scripts/stripe-audit-sticky-comment.cjs') as {
  (args: unknown): Promise<{ action: string; id?: number }>
  MARKER: string
}
const MARKER = stickyComment.MARKER

type Comment = { id: number; body: string }

function fakeGithub(existing: Comment[]) {
  const calls = {
    update: [] as Array<Record<string, unknown>>,
    create: [] as Array<Record<string, unknown>>,
  }
  const listComments = async () => ({ data: existing })
  const github = {
    // github-script's paginate resolves the full comment list.
    paginate: async () => existing,
    rest: {
      issues: {
        listComments,
        updateComment: async (p: Record<string, unknown>) => {
          calls.update.push(p)
        },
        createComment: async (p: Record<string, unknown>) => {
          calls.create.push(p)
        },
      },
    },
  }
  return { github, calls }
}

const prContext = { issue: { number: 7 }, repo: { owner: 'o', repo: 'r' } }

describe('stripe-audit sticky comment (find-or-update)', () => {
  it('UPDATES the existing marked comment when present (no duplicate)', async () => {
    const { github, calls } = fakeGithub([
      { id: 42, body: `${MARKER}\nstale report` },
      { id: 43, body: 'an unrelated human comment' },
    ])
    const res = await stickyComment({ github, context: prContext, body: 'fresh report' })

    expect(res).toEqual({ action: 'update', id: 42 })
    expect(calls.update).toHaveLength(1)
    expect(calls.create).toHaveLength(0)
    expect(calls.update[0].comment_id).toBe(42)
    expect(String(calls.update[0].body)).toContain(MARKER)
    expect(String(calls.update[0].body)).toContain('fresh report')
  })

  it('CREATES a new comment only when no marked comment exists', async () => {
    const { github, calls } = fakeGithub([{ id: 43, body: 'unrelated comment' }])
    const res = await stickyComment({ github, context: prContext, body: 'first report' })

    expect(res).toEqual({ action: 'create' })
    expect(calls.create).toHaveLength(1)
    expect(calls.update).toHaveLength(0)
    expect(calls.create[0].issue_number).toBe(7)
    expect(String(calls.create[0].body)).toContain(MARKER)
    expect(String(calls.create[0].body)).toContain('first report')
  })

  it('SKIPS cleanly when there is no PR context (push/tag events)', async () => {
    const { github, calls } = fakeGithub([])
    const res = await stickyComment({
      github,
      context: { issue: {}, repo: { owner: 'o', repo: 'r' } },
      body: 'x',
    })

    expect(res).toEqual({ action: 'skip' })
    expect(calls.create).toHaveLength(0)
    expect(calls.update).toHaveLength(0)
  })
})
