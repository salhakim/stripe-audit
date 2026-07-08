import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runRules } from '../../src/engine'
import { ALL_RULES } from '../../src/rules/index'
import { buildAuditResult, renderHtml } from '../../src/report'
import type { BuildAuditResultOptions } from '../../src/report'
import type { StripeAccountSnapshot } from '../../src/types'

const FIXTURE = 'test/fixtures/snapshots/all-issues@2026-06-24.dahlia.json'
const loadSnap = () => JSON.parse(readFileSync(FIXTURE, 'utf8')) as StripeAccountSnapshot

function demoResult(opts: Partial<BuildAuditResultOptions> = {}) {
  const snap = loadSnap()
  const run = runRules(snap, ALL_RULES)
  return buildAuditResult(snap, run, {
    rulesTotal: ALL_RULES.length,
    auditDate: '2026-06-24T00:00:00.000Z',
    ...opts,
  })
}

describe('renderHtml — self-contained PRIMARY visual', () => {
  it('matches the committed snapshot', () => {
    expect(renderHtml(demoResult())).toMatchSnapshot()
  })

  it('is a complete HTML document', () => {
    const html = renderHtml(demoResult())
    expect(html.slice(0, 400)).toMatch(/<!doctype html|<html/i)
  })

  it('is SELF-CONTAINED: zero external http(s) src/href references', () => {
    const html = renderHtml(demoResult())
    // The exact self-containment guard run against the written file.
    expect(html).not.toMatch(/(src|href)="https?:\/\//i)
  })

  it('inlines both CSS and JS', () => {
    const html = renderHtml(demoResult())
    expect(html).toMatch(/<style/i)
    expect(html).toMatch(/<script/i)
  })

  it('renders the score/grade header and a client-side filter on severity + category', () => {
    const html = renderHtml(demoResult())
    expect(html).toMatch(/grade|score/i)
    expect(html).toMatch(/filter/i)
    expect(html).toMatch(/data-severity/)
    expect(html).toMatch(/data-category/)
  })

  it('always renders a coverage surface: full note vs PARTIAL banner naming truncated regions', () => {
    expect(renderHtml(demoResult())).toMatch(/full audit/i)
    const snap = loadSnap()
    snap.truncated = ['prices', 'tax']
    const run = runRules(snap, ALL_RULES)
    const partial = renderHtml(
      buildAuditResult(snap, run, { rulesTotal: ALL_RULES.length, auditDate: '2026-06-24T00:00:00.000Z' }),
    )
    expect(partial).toMatch(/partial audit/i)
    expect(partial).toMatch(/<code>prices<\/code>/)
    expect(partial).toMatch(/<code>tax<\/code>/)
  })

  it('renders Skipped and a contiguous "Suppressed (N)" (number never split into a tag)', () => {
    const html = renderHtml(demoResult())
    expect(html).toMatch(/skipped/i)
    expect(html).toMatch(/suppressed[^0-9<]*[0-9]+/i)
    expect(html).toMatch(/Suppressed \(0\)/)
  })

  it('keeps docs URLs out of static href/src but available for the inline JS to activate', () => {
    const html = renderHtml(demoResult())
    // The URL lives in a data attribute, not a static href.
    expect(html).toMatch(/data-docs="https:\/\/docs\.stripe\.com\//)
    expect(html).not.toMatch(/href="https:\/\/docs\.stripe\.com\//)
  })

  it('renders no Stripe key substring', () => {
    expect(renderHtml(demoResult())).not.toMatch(/sk_(live|test)_|rk_(live|test)_/)
  })
})

describe('renderHtml — filtered-run labeling', () => {
  it('annotates the score header and renders the FILTERED coverage box instead of the full note', () => {
    const html = renderHtml(demoResult({ filter: { severity: ['low'] } }))
    expect(html).toMatch(/Grade [A-F] \(filtered\)<\/div>/)
    expect(html).toContain('coverage-filtered')
    expect(html).toContain(
      '<strong>⚠️ Coverage: FILTERED</strong> (severity=low) — higher-severity rules were not run.',
    )
    // The stylesheet always defines .coverage-full — assert the ELEMENT is absent.
    expect(html).not.toContain('<p class="coverage coverage-full">')
  })

  it('filtered + truncated renders BOTH the FILTERED box and the partial banner', () => {
    const snap = loadSnap()
    snap.truncated = ['prices']
    const run = runRules(snap, ALL_RULES)
    const html = renderHtml(
      buildAuditResult(snap, run, {
        rulesTotal: ALL_RULES.length,
        auditDate: '2026-06-24T00:00:00.000Z',
        filter: { severity: ['low'], category: ['billing'] },
      }),
    )
    expect(html).toContain('Coverage: FILTERED</strong> (severity=low, category=billing)')
    expect(html).toMatch(/partial audit/i)
    expect(html).not.toContain('<p class="coverage coverage-full">')
  })

  it('stays self-contained when filtered (inline style only — no external reference)', () => {
    const html = renderHtml(demoResult({ filter: { severity: ['low'] } }))
    expect(html).not.toMatch(/(src|href)="https?:\/\//i)
  })

  it('the unfiltered document carries no filtered annotation (byte-unchanged contract)', () => {
    expect(renderHtml(demoResult())).not.toMatch(/\(filtered\)|coverage-filtered/)
  })
})
