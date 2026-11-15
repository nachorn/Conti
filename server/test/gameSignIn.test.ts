import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import express from 'express'
import cors from 'cors'
import test, { type TestContext } from 'node:test'
import { MembershipService } from '../src/membership.js'
import { DEFAULT_GAME_ORIGINS, gameOriginsFromEnvironment, validateGameOrigins } from '../src/gameSignIn.js'
import type { SnapshotStore } from '../src/storage.js'

const ROOT = 'https://nrnplay.com'
const FOOTBALL = 'https://football.nrnplay.com'
const CONTI = 'https://conti.nrnplay.com'
const sourceKey = () => randomBytes(32).toString('base64url')
const proof = () => { const verifier = sourceKey(); return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') } }

class MemoryStore implements SnapshotStore {
  value: any = null
  fail = false
  healthy = true
  isHealthy() { return this.healthy }
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { if (this.fail) throw new Error('test-only storage failure'); this.value = structuredClone(value) }
  async close() {}
}

async function harness(t: TestContext) {
  const store = new MemoryStore(), clock = { now: 1_900_000_000_000 }, inbox = new Map<string, string>()
  const service = await new MembershipService({ store, authSecret: 'game-sign-in-tests-secret-not-a-production-key',
    gameOrigins: [ROOT, FOOTBALL, CONTI], appUrl: ROOT, now: () => clock.now,
    sendCode: async (email, code) => { inbox.set(email, code) },
  }).load()
  await service.requestCode('ana@example.com', 'es', 'signup-ip')
  const source = await service.verifyCode('ana@example.com', inbox.get('ana@example.com')!, 'signup-ip')
  const app = express()
  app.use(['/api/membership/game-authorize', '/api/membership/game-exchange'], service.gameSignInCors([ROOT]))
  // The general policy intentionally excludes games: only the two SSO routes widen CORS.
  app.use(cors({ origin: [ROOT] }))
  service.registerRoutes(app, [ROOT])
  const server = createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await service.close() })
  const call = (path: string, body?: unknown, token?: string, origin: string | null = ROOT) => fetch(`${url}/api/membership/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const authorize = async (challenge: string, origin = FOOTBALL) => {
    const response = await call('game-authorize', { origin, challenge }, source.token)
    assert.equal(response.status, 200)
    return await response.json() as { code: string; expiresAt: number }
  }
  return { service, store, clock, source, inbox, url, call, authorize }
}

test('an origin-bound PKCE code gives the game a separate session for the same existing account', async t => {
  const h = await harness(t), pkce = proof(), issued = await h.authorize(pkce.challenge)
  assert.match(issued.code, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(issued.code, h.source.token)
  assert.equal(issued.expiresAt, h.clock.now + 60_000)
  const response = await h.call('game-exchange', { code: issued.code, verifier: pkce.verifier }, undefined, FOOTBALL)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), FOOTBALL)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const linked = await response.json()
  assert.equal(linked.account.id, h.source.account.id)
  assert.equal(linked.account.email, h.source.account.email)
  assert.notEqual(linked.token, h.source.token)
  assert.equal(h.service.authenticate(linked.token)?.id, h.source.account.id)
  assert.equal(h.service.authenticate(h.source.token)?.id, h.source.account.id)
  assert.equal(JSON.stringify(h.store.value).includes(linked.token), false)
  assert.equal(JSON.stringify(h.store.value).includes(issued.code), false)
  assert.equal(h.store.value.accounts.length, 1)
})

test('a code cannot be replayed, including by concurrent exchange requests', async t => {
  const h = await harness(t), pkce = proof(), issued = await h.authorize(pkce.challenge)
  const body = { code: issued.code, verifier: pkce.verifier }
  const responses = await Promise.all([h.call('game-exchange', body, undefined, FOOTBALL), h.call('game-exchange', body, undefined, FOOTBALL)])
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400])
  assert.equal((await h.call('game-exchange', body, undefined, FOOTBALL)).status, 400)
  assert.equal(h.store.value.sessions.length, 2)
})

test('wrong origin, missing Origin and wrong verifier cannot redeem or invalidate the rightful proof', async t => {
  const h = await harness(t), pkce = proof(), issued = await h.authorize(pkce.challenge)
  const body = { code: issued.code, verifier: pkce.verifier, origin: FOOTBALL }
  assert.equal((await h.call('game-exchange', body, undefined, CONTI)).status, 403)
  assert.equal((await h.call('game-exchange', body, undefined, null)).status, 403)
  assert.equal((await h.call('game-exchange', { ...body, verifier: sourceKey() }, undefined, FOOTBALL)).status, 400)
  assert.equal((await h.call('game-exchange', { ...body, verifier: 'short' }, undefined, FOOTBALL)).status, 400)
  assert.equal((await h.call('game-exchange', body, undefined, FOOTBALL)).status, 200)
})

test('expired codes and proofs backed by an expired source session are rejected', async t => {
  const h = await harness(t), pkce = proof(), issued = await h.authorize(pkce.challenge)
  h.clock.now += 60_001
  assert.equal((await h.call('game-exchange', { code: issued.code, verifier: pkce.verifier }, undefined, FOOTBALL)).status, 400)
  h.clock.now = h.source.expiresAt - 10_000
  const nearExpiry = await h.authorize(pkce.challenge)
  const first = await h.call('game-exchange', { code: nearExpiry.code, verifier: pkce.verifier }, undefined, FOOTBALL)
  assert.equal(first.status, 200)
  assert.equal((await first.json()).expiresAt, h.source.expiresAt, 'a game cannot extend the root login lifetime')
  const pending = await h.authorize(pkce.challenge)
  h.clock.now += 10_001
  assert.equal((await h.call('game-exchange', { code: pending.code, verifier: pkce.verifier }, undefined, FOOTBALL)).status, 401)
})

test('logging out the source session revokes pending game sign-ins', async t => {
  const h = await harness(t), pkce = proof(), issued = await h.authorize(pkce.challenge)
  assert.equal((await h.call('logout', {}, h.source.token)).status, 200)
  const response = await h.call('game-exchange', { code: issued.code, verifier: pkce.verifier }, undefined, FOOTBALL)
  assert.equal(response.status, 401)
  assert.equal(h.store.value.sessions.length, 0)
})

test('a password reset also revokes codes issued before the reset', async t => {
  const h = await harness(t), pkce = proof(), issued = await h.authorize(pkce.challenge)
  await h.service.requestPasswordReset('ana@example.com', 'es', 'reset-ip')
  const next = await h.service.confirmPasswordReset('ana@example.com', h.inbox.get('ana@example.com')!, 'Una frase nueva para todos mis juegos', 'reset-ip')
  assert.equal(next.account.id, h.source.account.id)
  assert.equal((await h.call('game-exchange', { code: issued.code, verifier: pkce.verifier }, undefined, FOOTBALL)).status, 401)
  assert.equal(h.store.value.sessions.length, 1)
})

test('unapproved destinations, malformed challenges and unauthenticated issuers never receive a code', async t => {
  const h = await harness(t), pkce = proof()
  assert.equal((await h.call('game-authorize', { origin: 'https://evil.example', challenge: pkce.challenge }, h.source.token)).status, 403)
  assert.equal((await h.call('game-authorize', { origin: FOOTBALL + '/redirect', challenge: pkce.challenge }, h.source.token)).status, 403)
  assert.equal((await h.call('game-authorize', { origin: FOOTBALL, challenge: 'not-a-sha256-challenge' }, h.source.token)).status, 400)
  assert.equal((await h.call('game-authorize', { origin: FOOTBALL, challenge: pkce.challenge })).status, 401)
})

test('game CORS preflights work without broadening membership or admin routes', async t => {
  const h = await harness(t)
  const preflight = await fetch(`${h.url}/api/membership/game-exchange`, { method: 'OPTIONS', headers: {
    Origin: FOOTBALL, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
  } })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), FOOTBALL)
  assert.equal(preflight.headers.get('cache-control'), 'no-store')
  const unknown = await fetch(`${h.url}/api/membership/game-exchange`, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } })
  assert.equal(unknown.status, 403)
  assert.equal(unknown.headers.get('access-control-allow-origin'), null)
  const ordinary = await h.call('me', undefined, h.source.token, FOOTBALL)
  assert.equal(ordinary.headers.get('access-control-allow-origin'), null)
  const admin = await fetch(`${h.url}/api/admin/memberships`, { headers: { Origin: FOOTBALL } })
  assert.equal(admin.headers.get('access-control-allow-origin'), null)
})

test('authorization is rate limited and repeated game launches preserve the root session within the bounded session list', async t => {
  const h = await harness(t), pkce = proof()
  for (let index = 0; index < 15; index++) {
    const issued = await h.authorize(pkce.challenge)
    assert.equal((await h.call('game-exchange', { code: issued.code, verifier: pkce.verifier }, undefined, FOOTBALL)).status, 200)
  }
  assert.equal(h.store.value.sessions.length, 10)
  assert.equal(h.service.authenticate(h.source.token)?.id, h.source.account.id)
  for (let index = 15; index < 30; index++) await h.authorize(pkce.challenge)
  assert.equal((await h.call('game-authorize', { origin: FOOTBALL, challenge: pkce.challenge }, h.source.token)).status, 429)
})

test('storage failure cannot acknowledge a linked session or change the stored account', async t => {
  const h = await harness(t), pkce = proof(), issued = await h.authorize(pkce.challenge)
  const before = structuredClone(h.store.value)
  h.store.fail = true
  const response = await h.call('game-exchange', { code: issued.code, verifier: pkce.verifier }, undefined, FOOTBALL)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'server_unavailable' })
  assert.deepEqual(h.store.value, before)
})

test('production origins are exact HTTPS destinations and development HTTP never leaks into production defaults', () => {
  assert.deepEqual(gameOriginsFromEnvironment({ NODE_ENV: 'production' }), [...DEFAULT_GAME_ORIGINS])
  assert(gameOriginsFromEnvironment({ NODE_ENV: 'development' }).includes('http://localhost:5174'))
  assert.throws(() => gameOriginsFromEnvironment({ NODE_ENV: 'production', MEMBERSHIP_GAME_ORIGINS: 'http://localhost:5174' }), /exact HTTPS/)
  assert.deepEqual(gameOriginsFromEnvironment({ NODE_ENV: 'production', MEMBERSHIP_GAME_ORIGINS: FOOTBALL }), [FOOTBALL])
  for (const origin of ['https://football.nrnplay.com/', 'https://football.nrnplay.com/path', 'https://user@football.nrnplay.com', '*.nrnplay.com', 'null', 'http://evil.example']) assert.throws(() => validateGameOrigins([origin]), /exact HTTPS/)
})
