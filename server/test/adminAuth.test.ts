import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import express from 'express'
import test, { type TestContext } from 'node:test'
import { AdminAuth, ADMIN_REMEMBER_MS, ADMIN_SESSION_MS, ADMIN_SESSION_COOKIE, registerAdminSessions } from '../src/adminAuth.js'
import { createGameServer } from '../src/app.js'
import { MembershipService } from '../src/membership.js'
import type { SnapshotStore } from '../src/storage.js'

const KEY = 'admin-session-test-key-with-at-least-32-chars'
const HEADERS = { 'Content-Type': 'application/json', 'X-Admin-Request': '1' }
class MemoryStore implements SnapshotStore {
  value: unknown = null
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value) }
  async close() {}
}
async function harness(t: TestContext, key = KEY) {
  const clock = { now: Date.now() }
  const app = express()
  const auth = new AdminAuth(key, ['https://games.example'], () => clock.now)
  registerAdminSessions(app, auth, () => true)
  app.get('/api/admin/test', (req, res) => res.set('Cache-Control', 'no-store').status(auth.authenticate(req) ? 200 : 401).json({ ok: !!auth.authenticate(req) }))
  const membership = await new MembershipService({ store: new MemoryStore(), authSecret: 'membership-test-secret-with-32-characters', dashboardKey: key, now: () => clock.now }).load()
  membership.registerRoutes(app, ['https://games.example'])
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  t.after(async () => { await new Promise<void>(resolve => http.close(() => resolve())); await membership.close() })
  const request = (path: string, options: RequestInit = {}) => fetch(origin + path, options)
  const login = (remember = true, headers = HEADERS) => request('/api/admin/session', { method: 'POST', headers, body: JSON.stringify({ password: KEY, remember }) })
  const read = (cookie: string) => request('/api/admin/test', { headers: { Cookie: cookie } })
  return { auth, clock, origin, request, login, read }
}
function cookie(response: Response) {
  const value = response.headers.get('set-cookie')
  assert.ok(value, 'successful login must set its session cookie')
  return value.split(';')[0]
}

test('remembered session uses a private 30-day cookie and never exposes the admin password', async t => {
  const h = await harness(t)
  const response = await h.login(true, { ...HEADERS, Origin: 'https://games.example', 'X-Forwarded-Proto': 'https' })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  const header = response.headers.get('set-cookie')!
  assert.match(header, /HttpOnly/)
  assert.match(header, /SameSite=Strict/)
  assert.match(header, /Secure/)
  assert.match(header, /Path=\/api\/admin/)
  assert.match(header, /Max-Age=2592000/)
  assert.match(header, /Expires=/)
  assert.ok(!header.includes(KEY))
  assert.ok(!header.includes('Domain='), 'cookie must remain specific to the frontend host')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const session = cookie(response)
  const read = await h.read(session)
  assert.equal(read.status, 200)
  assert.equal(read.headers.get('set-cookie'), null, 'reads must not extend the fixed expiry')
  h.clock.now += ADMIN_REMEMBER_MS - 1
  assert.equal((await h.read(session)).status, 200)
  h.clock.now++
  assert.equal((await h.read(session)).status, 401)
})

test('unchecked remember creates a browser-session cookie with a 12-hour server expiry', async t => {
  const h = await harness(t)
  const response = await h.login(false)
  assert.equal(response.status, 200)
  assert.doesNotMatch(response.headers.get('set-cookie')!, /Max-Age=|Expires=/)
  const session = cookie(response)
  h.clock.now += ADMIN_SESSION_MS - 1
  assert.equal((await h.read(session)).status, 200)
  h.clock.now++
  assert.equal((await h.read(session)).status, 401)
})

test('sessions survive an auth instance restart, reject tampering, and are revoked by key rotation', async t => {
  const h = await harness(t)
  const session = cookie(await h.login())
  const restarted = await harness(t)
  assert.equal((await restarted.read(session)).status, 200)
  const rotated = await harness(t, 'a-different-admin-session-key-at-least-32-chars')
  assert.equal((await rotated.read(session)).status, 401)
  for (const bad of [session.replace('v1.', 'v2.'), session.replace(/\.\d+\./, '.0.'), session + 'a', session.slice(0, -5), `${session}; ${session}`]) {
    assert.equal((await h.read(bad)).status, 401)
  }
  assert.equal((await h.request('/api/admin/test', { headers: { Cookie: session, Authorization: 'Bearer wrong' } })).status, 401)
})

test('session login fails closed for weak config, invalid bodies and incorrect passwords', async t => {
  for (const key of ['', 'short', 'x'.repeat(257)]) {
    const h = await harness(t, key)
    const response = await h.login()
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('set-cookie'), null)
  }
  const h = await harness(t)
  for (const [body, status] of [[{ password: 'wrong', remember: true }, 401], [{ password: KEY }, 400], [{ password: KEY, remember: 'yes' }, 400], [{ password: 'x'.repeat(257), remember: true }, 401]] as const) {
    const response = await h.request('/api/admin/session', { method: 'POST', headers: HEADERS, body: JSON.stringify(body) })
    assert.equal(response.status, status)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  for (const [body, status] of [['{"password":', 400], ['x'.repeat(2000), 413]] as const) {
    const response = await h.request('/api/admin/session', { method: 'POST', headers: HEADERS, body })
    assert.equal(response.status, status)
    assert.deepEqual(await response.json(), { error: 'invalid_request' })
  }
  assert.equal((await h.request(`/api/admin/session?password=${KEY}`, { method: 'POST', headers: HEADERS, body: '{}' })).status, 400)
})

test('login and logout require a non-simple request and reject untrusted origins', async t => {
  const h = await harness(t)
  for (const headers of [{ 'Content-Type': 'application/json' }, { ...HEADERS, Origin: 'https://attacker.example' }, { ...HEADERS, Origin: 'null' }]) {
    const response = await h.login(true, headers)
    assert.equal(response.status, 403)
    assert.equal(response.headers.get('set-cookie'), null)
    const logout = await h.request('/api/admin/session', { method: 'DELETE', headers })
    assert.equal(logout.status, 403)
    assert.equal(logout.headers.get('set-cookie'), null)
  }
  assert.equal((await h.login(true, { ...HEADERS, Origin: h.origin })).status, 200)
  const form = await h.request('/api/admin/session', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Admin-Request': '1' }, body: `password=${KEY}&remember=true` })
  assert.equal(form.status, 400)
})

test('logout clears the exact private cookie and remains available without a current session', async t => {
  const h = await harness(t)
  const response = await h.request('/api/admin/session', { method: 'DELETE', headers: { 'X-Admin-Request': '1', 'X-Forwarded-Proto': 'https' } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  const cleared = response.headers.get('set-cookie')!
  assert.match(cleared, new RegExp(`^${ADMIN_SESSION_COOKIE}=;`))
  assert.match(cleared, /Path=\/api\/admin/)
  assert.match(cleared, /HttpOnly/)
  assert.match(cleared, /Secure/)
  assert.match(cleared, /SameSite=Strict/)
  assert.match(cleared, /Expires=Thu, 01 Jan 1970/)
  assert.equal((await h.read(cookie(response))).status, 401)
})

test('the same cookie authorizes membership reads and CSRF-protected changes; bearer clients stay compatible', async t => {
  const h = await harness(t)
  const session = cookie(await h.login())
  const body = JSON.stringify({ email: 'friend@example.com', expiresAt: null })
  assert.equal((await h.request('/api/admin/memberships', { headers: { Cookie: session } })).status, 200)
  for (const headers of [{ 'Content-Type': 'application/json', Cookie: session }, { ...HEADERS, Cookie: session, Origin: 'https://attacker.example' }]) {
    assert.equal((await h.request('/api/admin/memberships/grant', { method: 'POST', headers, body })).status, 403)
  }
  assert.equal((await h.request('/api/admin/memberships/grant', { method: 'POST', headers: { ...HEADERS, Cookie: session, Origin: 'https://games.example' }, body })).status, 200)
  const grants = await (await h.request('/api/admin/memberships', { headers: { Cookie: session } })).json() as { grants: { active: boolean }[] }
  assert.equal(grants.grants.length, 1)
  assert.equal(grants.grants[0].active, true)
  assert.equal((await h.request('/api/admin/memberships/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` }, body })).status, 200)
  assert.equal((await h.request('/api/admin/test', { headers: { Authorization: `Bearer ${KEY}` } })).status, 200)
  h.clock.now += ADMIN_REMEMBER_MS
  assert.equal((await h.request('/api/admin/memberships', { headers: { Cookie: session } })).status, 401)
})

test('real game server login cookie opens the dashboard and storage failure remains fail closed', async t => {
  const store = new MemoryStore()
  const server = await createGameServer(store, { dashboardKey: KEY, origins: ['https://games.example'] })
  const port = await server.listen(0, '127.0.0.1')
  t.after(() => server.close())
  const url = `http://127.0.0.1:${port}`
  const login = await fetch(`${url}/api/admin/session`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ password: KEY, remember: true }) })
  assert.equal(login.status, 200)
  const session = cookie(login)
  const read = () => fetch(`${url}/api/admin/dashboard`, { headers: { Cookie: session } })
  assert.equal((await read()).status, 200)
  server.repository.failed = true
  assert.equal((await read()).status, 503)
  const offlineLogin = await fetch(`${url}/api/admin/session`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ password: KEY, remember: true }) })
  assert.equal(offlineLogin.status, 503)
  assert.equal(offlineLogin.headers.get('set-cookie'), null)
})
