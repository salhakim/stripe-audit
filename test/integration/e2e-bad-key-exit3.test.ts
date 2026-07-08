import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'

/**
 * True end-to-end failure path: the BUILT CLI, a real HTTP fetch, a real 401.
 *
 * A local fixture server answers every request with a recorded Stripe-shaped
 * 401 body; the CLI is pointed at it through the loopback-only
 * STRIPE_AUDIT_TEST_BASE_URL seam. That exercises the genuine
 * fetch → translateStripeError → EXIT_RUNTIME seam — the stripe SDK raises a
 * real StripeAuthenticationError off the wire, nothing is spy-mocked.
 *
 * Contract proven: exit 3, plain-language redacted stderr (never the key,
 * never a stack trace), clean stdout.
 */
const CLI = 'dist/cli.js'

// Assembled at runtime so no live-key-shaped literal ships in this (exported)
// test source — same convention as the export-release suite.
const FAKE_KEY = ['rk', 'test', 'a'.repeat(24)].join('_')

// The recorded 401 body a revoked/invalid key gets from the live API (shape
// only — the message is Stripe's canonical copy with a fake key reference).
const RECORDED_401 = JSON.stringify({
  error: {
    type: 'invalid_request_error',
    message: 'Invalid API Key provided: rk_test_****aaaa',
  },
})

let server: Server
let baseUrl: string

beforeAll(async () => {
  if (!existsSync(CLI)) execFileSync('npm', ['run', 'build'], { stdio: 'ignore' })
  server = createServer((_req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(RECORDED_401)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 120_000)

afterAll(() => {
  server?.close()
})

interface CliRun {
  status: number | null
  stdout: string
  stderr: string
}

// spawn (async), NEVER spawnSync: the fixture server lives on THIS process's
// event loop, and a synchronous spawn would block it — the subprocess's HTTP
// requests would never be answered (a deadlock disguised as a hang).
function runCliAgainstFixture(): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI], {
      env: { ...process.env, STRIPE_AUDIT_TEST_BASE_URL: baseUrl, STRIPE_SECRET_KEY: FAKE_KEY },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d))
    child.stderr.on('data', (d: Buffer) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('built CLI did not exit within 20s against the 401 fixture'))
    }, 20_000)
    child.on('error', reject)
    child.on('exit', (status) => {
      clearTimeout(timer)
      resolve({ status, stdout, stderr })
    })
  })
}

describe('built CLI vs a recorded 401 — the real fetch/translate/exit-3 seam', () => {
  it('exits 3 (EXIT_RUNTIME) when the key is rejected', { timeout: 25_000 }, async () => {
    const { status } = await runCliAgainstFixture()
    expect(status).toBe(3)
  })

  it('stderr is plain language: names the auth failure, offers the restricted-key fix', { timeout: 25_000 }, async () => {
    const { stderr } = await runCliAgainstFixture()
    expect(stderr).toMatch(/authentication failed|invalid, expired, or revoked/i)
    expect(stderr).toMatch(/restricted key|read-only/i)
  })

  it('stderr is redacted (never the key) and carries no stack trace', { timeout: 25_000 }, async () => {
    const { stderr } = await runCliAgainstFixture()
    expect(stderr).not.toContain(FAKE_KEY)
    expect(stderr).not.toMatch(/^\s+at /m)
    expect(stderr).not.toMatch(/StripeAuthenticationError/)
  })

  it('stdout stays clean — no partial report on the failure path', { timeout: 25_000 }, async () => {
    const { stdout } = await runCliAgainstFixture()
    expect(stdout).toBe('')
  })
})

describe('STRIPE_AUDIT_TEST_BASE_URL is a loopback-only seam', () => {
  it('a non-loopback override is refused with a warning (client keeps the real host)', async () => {
    // Source-level check — no subprocess, no network: a non-loopback URL must
    // be ignored so the env var can never redirect a real key off-box.
    const { createStripeClient } = await import('../../src/stripe-client')
    const written: string[] = []
    const realWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: string | Uint8Array) => {
      written.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    const prev = process.env.STRIPE_AUDIT_TEST_BASE_URL
    try {
      process.env.STRIPE_AUDIT_TEST_BASE_URL = 'http://attacker.example.com:9999'
      const client = createStripeClient(FAKE_KEY)
      expect(client.getApiField('host')).toBe('api.stripe.com')
      expect(written.join('')).toMatch(/loopback/i)
    } finally {
      process.stderr.write = realWrite
      if (prev === undefined) delete process.env.STRIPE_AUDIT_TEST_BASE_URL
      else process.env.STRIPE_AUDIT_TEST_BASE_URL = prev
    }
  })

  it('a loopback override is honored (host/port/protocol land on the client)', async () => {
    const { createStripeClient } = await import('../../src/stripe-client')
    const prev = process.env.STRIPE_AUDIT_TEST_BASE_URL
    try {
      process.env.STRIPE_AUDIT_TEST_BASE_URL = 'http://127.0.0.1:4242'
      const client = createStripeClient(FAKE_KEY)
      expect(client.getApiField('host')).toBe('127.0.0.1')
      expect(client.getApiField('port')).toBe(4242)
      expect(client.getApiField('protocol')).toBe('http')
    } finally {
      if (prev === undefined) delete process.env.STRIPE_AUDIT_TEST_BASE_URL
      else process.env.STRIPE_AUDIT_TEST_BASE_URL = prev
    }
  })
})
