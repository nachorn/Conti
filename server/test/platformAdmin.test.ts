import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import express from 'express'
import test, { type TestContext } from 'node:test'
import { AdminAuth, registerAdminSessions } from '../src/adminAuth.js'
import { MembershipService } from '../src/membership.js'
import { GameRepository } from '../src/recovery.js'
import { registerPlatformAdmin } from '../src/platformAdmin.js'
import { createFootballAdminClient, deriveFootballReportKey, parseFootballAdminReport, type FootballAdminClient } from '../src/footballAdmin.js'
import type { SnapshotStore } from '../src/storage.js'
import type { FootballAdminReport } from '../../shared/platformAdmin.js'
import { createGameServer } from '../src/app.js'

const KEY = 'synthetic-platform-admin-master-key-2026'
const NOW = Date.now()
const AUTH = { Authorization: `Bearer ${KEY}` }
class MemoryStore implements SnapshotStore {
  saves = 0
  healthy = true
  constructor(public value: any = null) {}
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value); this.saves++ }
  async close() {}
  isHealthy() { return this.healthy }
}
const passwordHash = ['scrypt-v1', '131072', '8', '1', 'a'.repeat(32), 'b'.repeat(64)].join('$')
const syntheticAccounts = Array.from({ length: 105 }, (_, i) => ({ id: `account-${i}`, email: `human${String(i).padStart(3, '0')}@example.test`,
  createdAt: NOW - 1000, ...(i === 104 ? {} : { name: `Human ${String(i).padStart(3, '0')}` }), passwordHash }))
function membershipData() {
  return { version: 1, accounts: structuredClone(syntheticAccounts), sessions: [{ accountId: 'account-0', tokenHash: 'c'.repeat(64), expiresAt: NOW + 1_000_000 }],
    challenges: [{ email: 'pending@example.test', salt: 'synthetic-private-salt', codeHash: 'd'.repeat(64), expiresAt: NOW + 100_000, attempts: 0 }],
    limits: [{ key: 'e'.repeat(64), count: 1, until: NOW + 1000 }],
    grants: [
      { email: syntheticAccounts[1].email, active: true, expiresAt: NOW - 1, grantedAt: NOW - 1000 },
      { email: syntheticAccounts[2].email, active: true, expiresAt: null, grantedAt: NOW - 1000 },
      { email: syntheticAccounts[3].email, active: true, expiresAt: NOW + 100_000, grantedAt: NOW - 1000 },
      { email: syntheticAccounts[4].email, active: false, expiresAt: null, grantedAt: NOW - 1000 },
    ], orders: [{ id: 'private-order', accountId: 'account-5', priceId: 'private-price', amount: 499, currency: 'eur', createdAt: NOW - 1000,
      sessionId: 'private-payment-session', paymentIntentId: 'private-payment-intent', url: 'https://checkout.stripe.com/c/pay/private', state: 'paid' }],
    revokedPayments: [], events: [], bmcSubscriptions: [], plusAudit: [] }
}
function gameData() {
  const players = [{ accountId: 'account-0', name: 'Human 000', score: 10, position: 1 }, { accountId: 'account-1', name: 'Human 001', score: 0, position: 2 }]
  return { version: 2, savedAt: NOW, rooms: [], results: [
    ...Array.from({ length: 22 }, (_, i) => ({ id: `pocha-result-${i}`, gameType: 'pocha', startedAt: NOW - 1000, finishedAt: NOW - i, players })),
    { id: 'conti-result', gameType: 'continental', startedAt: NOW - 1000, finishedAt: NOW,
      players: [{ accountId: 'account-0', name: 'Human 000', score: 30, position: 1 }, { accountId: 'account-2', name: 'Human 002', score: 30, position: 1 }] },
  ] }
}
async function harness(t: TestContext, key = KEY, football?: FootballAdminClient) {
  const membershipStore = new MemoryStore(membershipData()), gameStore = new MemoryStore(gameData())
  const membership = await new MembershipService({ store: membershipStore, authSecret: 'synthetic-membership-service-secret-2026', dashboardKey: key, now: () => NOW }).load()
  const repository = new GameRepository(gameStore); await repository.load()
  await repository.createLeague({ id: 'account-0', name: 'Human 000' }, { name: 'Pocha synthetic', gameType: 'pocha', minGames: 3 })
  await repository.createLeague({ id: 'account-0', name: 'Human 000' }, { name: 'Conti synthetic', gameType: 'continental', minGames: 3 })
  const app = express(), auth = new AdminAuth(key, ['https://nrn.example.test'], () => NOW)
  registerAdminSessions(app, auth, () => true)
  membership.registerRoutes(app, ['https://nrn.example.test'])
  registerPlatformAdmin(app, { key, origins: ['https://nrn.example.test'], membership, repository, isHealthy: () => !repository.failed,
    football: football ?? { read: async () => ({ available: false, stale: false, report: null }) } })
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  t.after(async () => { await new Promise<void>(resolve => http.close(() => resolve())); await membership.close(); await gameStore.close() })
  const call = (path: string, options: RequestInit = {}) => fetch(base + path, { redirect: 'error', ...options })
  const login = async () => {
    const result = await call('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1', Origin: 'https://nrn.example.test' }, body: JSON.stringify({ password: key, remember: true }) })
    assert.equal(result.status, 200)
    return result.headers.get('set-cookie')!.split(';')[0]
  }
  return { call, login, membership, repository, membershipStore, gameStore }
}

test('platform endpoints are private, read-only and use the existing fixed admin session', async t => {
  const h = await harness(t)
  for (const path of ['/api/admin/overview', '/api/admin/accounts']) {
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Cookie: 'conti_admin_session=wrong' }] as Record<string, string>[]) {
      const response = await h.call(path, { headers }); assert.equal(response.status, 401)
      assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
      assert.deepEqual(await response.json(), { error: 'unauthorized' })
    }
    assert.equal((await h.call(path, { method: 'POST', headers: AUTH })).status, 404)
  }
  const cookie = await h.login()
  assert.equal((await h.call('/api/admin/accounts', { headers: { Cookie: cookie } })).status, 200)
  assert.equal((await h.call('/api/admin/accounts', { headers: { Cookie: cookie, Authorization: 'Bearer wrong' } })).status, 401)
  const weak = await harness(t, 'short')
  assert.equal((await weak.call('/api/admin/accounts', { headers: AUTH })).status, 503)
})

test('the real game server registers the account route under its existing admin session middleware', async t => {
  const h = await harness(t), cookie = await h.login()
  const server = await createGameServer(new MemoryStore(gameData()), { dashboardKey: KEY, membership: h.membership })
  const port = await server.listen(0, '127.0.0.1')
  t.after(() => server.close())
  const response = await fetch(`http://127.0.0.1:${port}/api/admin/accounts?limit=1`, { headers: { Cookie: cookie }, redirect: 'error' })
  assert.equal(response.status, 200)
  const body: any = await response.json(); assert.equal(body.accounts.length, 1); assert.equal(body.total, 105)
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/admin/overview`, { redirect: 'error' })).status, 401)
})

test('account listing includes every registration, uses explicit fields and resolves real Plus entitlement', async t => {
  const h = await harness(t), before = h.membershipStore.saves
  const response = await h.call('/api/admin/accounts?limit=100', { headers: AUTH }), body: any = await response.json()
  assert.equal(response.status, 200); assert.equal(body.total, 105); assert.equal(body.filtered, 105); assert.equal(body.accounts.length, 100)
  const rows = new Map<string, any>(body.accounts.map((account: any) => [account.id, account]))
  for (const row of body.accounts) {
    assert.deepEqual(Object.keys(row).sort(), ['createdAt', 'email', 'id', 'name', 'plus', 'stats'])
    assert.deepEqual(Object.keys(row.plus).sort(), ['active', 'expiresAt', 'source'])
    assert.deepEqual(Object.keys(row.stats).sort(), ['continental', 'pocha'])
  }
  assert.equal(rows.get('account-1').plus.active, false, 'Expired gifts do not count as Plus')
  assert.deepEqual(rows.get('account-2').plus, { active: true, source: 'gift', expiresAt: null })
  assert.equal(rows.get('account-3').plus.active, true)
  assert.equal(rows.get('account-4').plus.active, false)
  assert.deepEqual(rows.get('account-5').plus, { active: true, source: 'purchase', expiresAt: null })
  const encoded = JSON.stringify(body)
  for (const forbidden of ['password', 'hasPassword', 'token', 'session', 'challenge', 'codeHash', 'private-price', 'private-order', 'private-payment', 'pending@example.test', 'synthetic-private-salt', '127.0.0.1', 'scrypt-v1']) assert(!encoded.includes(forbidden), `No private field: ${forbidden}`)
  assert.equal(h.membershipStore.saves, before, 'Reading the list never mutates account storage')
  assert.equal(rows.get('account-0').stats.pocha.played, 22); assert.equal(rows.get('account-0').stats.pocha.wins, 22)
  assert.equal(rows.get('account-0').stats.continental.draws, 1)
  assert.equal(rows.get('account-1').stats.continental.played, 0)
})

test('search and pagination are bounded, literal, stable and include accounts without names or play history', async t => {
  const h = await harness(t)
  const read = async (query: string) => {
    const response = await h.call('/api/admin/accounts' + query, { headers: AUTH }); assert.equal(response.status, 200); return await response.json() as any
  }
  const first = await read('?limit=50'), second = await read('?offset=50&limit=50'), third = await read('?offset=100&limit=999')
  assert.equal(first.accounts[0].name, null)
  assert.equal(first.total, 105); assert.equal(third.limit, 100); assert.equal(third.accounts.length, 5)
  assert.equal(new Set([...first.accounts, ...second.accounts, ...third.accounts].map(row => row.id)).size, 105)
  const found = await read('?q=HUMAN%20003'); assert.equal(found.filtered, 1); assert.equal(found.accounts[0].id, 'account-3')
  const email = await read('?q=human104%40example.test'); assert.equal(email.accounts[0].name, null)
  assert.equal((await read('?q=.*')).filtered, 0, 'Search is plain text, never a regular expression')
  assert.equal((await read('?offset=999999999')).accounts.length, 0)
  for (const query of ['?q=' + 'a'.repeat(101), '?q[]=x', '?offset=-1', '?offset=1.2', '?limit=0', '?limit=all', '?limit[]=2']) {
    assert.equal((await h.call('/api/admin/accounts' + query, { headers: AUTH })).status, 400)
  }
})

test('overview counts the durable ledger, distinct registered participants and leagues without exposing game state', async t => {
  const h = await harness(t)
  const body: any = await (await h.call('/api/admin/overview', { headers: AUTH })).json()
  assert.deepEqual(body.accounts, { total: 105, plusActive: 3 })
  const pocha = body.games.find((game: any) => game.gameType === 'pocha'), conti = body.games.find((game: any) => game.gameType === 'continental')
  assert.equal(pocha.recordedGames, 22); assert.equal(pocha.registeredPlayers, 2); assert.equal(pocha.leagues, 1); assert.equal(pocha.recentGames.length, 20)
  assert.equal(pocha.recentGames[0].id, 'pocha-result-0')
  assert.deepEqual(conti.recentGames[0].winners, ['Human 000', 'Human 002'])
  assert.equal(conti.recordedGames, 1); assert.equal(conti.registeredPlayers, 2); assert.equal(conti.leagues, 1)
  for (const row of [...pocha.recentGames, ...conti.recentGames]) assert.deepEqual(Object.keys(row).sort(), ['finishedAt', 'id', 'playerCount', 'winners'])
  assert.deepEqual(body.football, { available: false, stale: false, report: null })
  const encoded = JSON.stringify(body)
  for (const forbidden of ['hand', 'session', 'token', 'account-', '@example.test', 'inviteCode']) assert(!encoded.includes(forbidden))
})

test('existing gift grants preserve cookie CSRF requirements and appear immediately in the new listing', async t => {
  const h = await harness(t), cookie = await h.login()
  const grant = (headers: Record<string, string>) => h.call('/api/admin/memberships/grant', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: syntheticAccounts[6].email, expiresAt: null }) })
  assert.equal((await grant({ Cookie: cookie })).status, 403)
  assert.equal((await grant({ Cookie: cookie, 'X-Admin-Request': '1', Origin: 'https://attacker.example' })).status, 403)
  assert.equal((await grant({ Cookie: cookie, 'X-Admin-Request': '1', Origin: 'https://nrn.example.test' })).status, 200)
  const result: any = await (await h.call('/api/admin/accounts?q=human006%40example.test', { headers: { Cookie: cookie } })).json()
  assert.deepEqual(result.accounts[0].plus, { active: true, source: 'gift', expiresAt: null })
  assert.equal((await grant(AUTH)).status, 200, 'Legacy server-side Bearer grants keep their established contract')
})

test('account reads fail closed when membership or game storage is unhealthy and have a bounded request budget', async t => {
  const h = await harness(t)
  h.membershipStore.healthy = false
  assert.equal((await h.call('/api/admin/accounts', { headers: AUTH })).status, 503)
  h.membershipStore.healthy = true; h.repository.failed = true
  assert.equal((await h.call('/api/admin/overview', { headers: AUTH })).status, 503)
  h.repository.failed = false
  for (let i = 0; i < 60; i++) assert.equal((await h.call('/api/admin/accounts?limit=1', { headers: AUTH })).status, 200)
  const limited = await h.call('/api/admin/accounts?limit=1', { headers: AUTH })
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('cache-control'), 'no-store'); assert(limited.headers.get('retry-after'))
})

test('a pending Football report cannot block independent account reads or admin login', { timeout: 5000 }, async t => {
  let release!: (value: Awaited<ReturnType<FootballAdminClient['read']>>) => void, entered!: () => void
  const reading = new Promise<void>(resolve => { entered = resolve })
  const pending = new Promise<Awaited<ReturnType<FootballAdminClient['read']>>>(resolve => { release = resolve })
  const h = await harness(t, KEY, { read: () => { entered(); return pending } })
  const overview = h.call('/api/admin/overview', { headers: AUTH })
  try {
    await reading
    assert.equal((await h.call('/api/admin/accounts?limit=1', { headers: AUTH })).status, 200)
    assert(await h.login())
  } finally { release({ available: false, stale: false, report: null }) }
  assert.equal((await overview).status, 200)
})

const report: FootballAdminReport = { generatedAt: NOW, since: NOW - 30_000, until: NOW, totals: { page_view: 10 },
  daily: [{ date: '2026-11-16', events: 10, careersCreated: 2, firstMatchesCompleted: 1 }], screens: [{ screen: 'menu', count: 4 }],
  devices: [{ device: 'desktop', count: 10 }], errors: [{ name: 'TypeError', source: 'react.js', count: 1 }] }

test('Football uses only the fixed TLS URL and scoped HMAC, deduplicates requests and caches for five minutes', async () => {
  let calls = 0, clock = NOW
  const derived = deriveFootballReportKey(KEY)!
  assert.equal(derived, createHmac('sha256', KEY).update('nrnplay:football-admin-report:v1').digest('base64url'))
  assert.notEqual(derived, KEY); assert.equal(deriveFootballReportKey('short'), null)
  const client = createFootballAdminClient({ dashboardKey: KEY, now: () => clock, request: (async (input, init) => {
    calls++; assert.equal(String(input), 'https://football.nrnplay.com/api/admin-report'); assert.equal(init?.method, 'GET')
    assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store')
    assert.equal((init?.headers as any).Authorization, `Bearer ${derived}`)
    assert(!JSON.stringify(init?.headers).includes(KEY))
    await Promise.resolve(); return Response.json({ ...report, privateUnknown: 'must-not-appear' })
  }) as typeof fetch })
  const responses = await Promise.all(Array.from({ length: 10 }, () => client.read()))
  assert.equal(calls, 1); assert(responses.every(value => value.available && !value.stale))
  assert(!JSON.stringify(responses).includes('privateUnknown')); assert(!JSON.stringify(responses).includes('must-not-appear'))
  responses[0].report!.totals.page_view = 999
  assert.equal((await client.read()).report!.totals.page_view, 10, 'Caller mutation cannot poison cached report')
  clock += 299_999; await client.read(); assert.equal(calls, 1)
  clock++; await client.read(); assert.equal(calls, 2)
})

test('Football unconfigured, timeout, HTTP errors and invalid/oversized JSON are unavailable without exposing errors', async () => {
  let calls = 0
  const notConfigured = createFootballAdminClient({ request: (async () => { calls++; throw new Error('must not request') }) as typeof fetch })
  assert.deepEqual(await notConfigured.read(), { available: false, stale: false, report: null }); assert.equal(calls, 0)
  const slow = createFootballAdminClient({ dashboardKey: KEY, timeoutMs: 5, request: (async () => await new Promise(() => undefined)) as typeof fetch })
  assert.deepEqual(await slow.read(), { available: false, stale: false, report: null })
  const responses = [new Response('private provider error', { status: 503 }), Response.json({ wrong: 'shape' }),
    new Response('{broken', { headers: { 'Content-Type': 'application/json' } }),
    new Response('x'.repeat(65_537), { headers: { 'Content-Type': 'application/json' } }),
    new Response('{}', { headers: { 'Content-Type': 'application/json', 'Content-Length': '65537' } })]
  for (const response of responses) {
    const client = createFootballAdminClient({ dashboardKey: KEY, request: (async () => response) as typeof fetch })
    assert.deepEqual(await client.read(), { available: false, stale: false, report: null })
  }
  for (const invalid of [{ ...report, totals: { count: -1 } }, { ...report, since: report.until + 1 }, { ...report, daily: [{ ...report.daily[0], date: '2026-02-31' }] },
    { ...report, errors: [{ name: 'Error\nsecret', source: 'x', count: 1 }] }]) assert.equal(parseFootballAdminReport(invalid), null)
})

test('Football failed refresh keeps only the last valid report as stale and failure attempts are cached', async () => {
  let clock = NOW, calls = 0
  const client = createFootballAdminClient({ dashboardKey: KEY, now: () => clock, request: (async () => {
    calls++; if (calls === 1) return Response.json(report)
    throw new Error('provider error with hypothetical private contents')
  }) as typeof fetch })
  assert.equal((await client.read()).available, true)
  clock += 300_000
  const stale = await client.read(); assert.equal(stale.available, false); assert.equal(stale.stale, true); assert.deepEqual(stale.report, report)
  for (let i = 0; i < 5; i++) await client.read()
  assert.equal(calls, 2)
})
