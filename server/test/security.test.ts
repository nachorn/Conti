import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { RateLimiter } from '../src/security.js'

const ORIGIN = 'https://conti-six.vercel.app'
const KEY = 'local-security-test-admin-key-with-32-characters'

async function harness(t: TestContext) {
  let saves = 0
  const server = await createGameServer({
    async load() { return null }, async save() { saves++ }, async close() {},
  }, { origins: [ORIGIN], dashboardKey: KEY })
  const port = await server.listen(0, '127.0.0.1')
  const url = `http://127.0.0.1:${port}`
  const sockets: Socket[] = []
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await server.close() })
  const connect = async (origin?: string) => {
    const socket = io(url, { autoConnect: false, transports: ['websocket'], reconnection: false,
      ...(origin === undefined ? {} : { extraHeaders: { Origin: origin } }),
    })
    sockets.push(socket)
    const result = once(socket, 'connect', { signal: AbortSignal.timeout(2_000) })
    socket.connect()
    await result
    return socket
  }
  return { server, url, sockets, connect, saves: () => saves }
}

test('limits recover after their window without rejected requests extending it or evicting active counters', () => {
  let now = 100
  const limit = new RateLimiter(2, 5_000, () => now, 2)
  assert.equal(limit.take('a'), 0)
  assert.equal(limit.take('a'), 0)
  assert.equal(limit.take('a'), 5)
  assert.equal(limit.take('b'), 0)
  assert.equal(limit.take('c'), 5, 'new identities cannot grow memory or evict a blocked identity')
  now += 4_001
  assert.equal(limit.take('a'), 1)
  now += 999
  assert.equal(limit.take('c'), 0, 'expired identities are reclaimed')
  assert.equal(limit.take('a'), 0)
})

test('HTTP responses include defensive headers and hide the server framework', async t => {
  const h = await harness(t)
  const response = await fetch(h.url + '/health')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('x-powered-by'), null)
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.match(response.headers.get('content-security-policy')!, /frame-ancestors 'none'/)
})

test('both polling and WebSocket handshakes reject foreign origins while approved and native clients connect', async t => {
  const h = await harness(t)
  for (const origin of ['https://untrusted.example', 'null']) {
    const response = await fetch(h.url + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: origin } })
    assert.equal(response.status, 403)
    const socket = io(h.url, { autoConnect: false, transports: ['websocket'], reconnection: false, extraHeaders: { Origin: origin } })
    h.sockets.push(socket)
    const rejected = once(socket, 'connect_error', { signal: AbortSignal.timeout(2_000) })
    socket.connect()
    await rejected
    assert.equal(socket.connected, false)
  }
  assert.equal((await h.connect(ORIGIN)).connected, true)
  assert.equal((await h.connect()).connected, true)
  const polling = await fetch(h.url + '/socket.io/?EIO=4&transport=polling', { headers: { Origin: ORIGIN } })
  assert.equal(polling.status, 200)
  assert.equal(polling.headers.get('x-content-type-options'), 'nosniff')
})

test('admin login throttles repeated attempts even when forwarded headers are forged; existing sessions still work', async t => {
  const h = await harness(t)
  const login = (password: string, n = 0) => fetch(h.url + '/api/admin/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1', Origin: ORIGIN,
      'X-Forwarded-For': `203.0.113.${n}`, 'CF-Connecting-IP': `203.0.113.${n}` },
    body: JSON.stringify({ password, remember: false }),
  })
  const session = await login(KEY)
  assert.equal(session.status, 200)
  const cookie = session.headers.get('set-cookie')!.split(';')[0]
  for (let n = 1; n < 10; n++) {
    const response = await login('incorrect', n)
    assert.equal(response.status, 401)
    await response.text()
  }
  const blocked = await login('incorrect', 11)
  assert.equal(blocked.status, 429)
  assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  assert.equal(blocked.headers.get('cache-control'), 'no-store')
  assert.equal(blocked.headers.get('set-cookie'), null)
  assert.equal((await fetch(h.url + '/api/admin/dashboard', { headers: { Cookie: cookie } })).status, 200)
})

test('repeated room-code guesses are stopped before game state is saved', async t => {
  const h = await harness(t)
  const socket = await h.connect(ORIGIN)
  for (let n = 0; n < 10; n++) {
    const error = once(socket, 'error', { signal: AbortSignal.timeout(2_000) })
    socket.emit('join', { roomId: '0000', name: 'Guest' })
    assert.equal((await error)[0].message, 'Room not found')
  }
  const blocked = once(socket, 'error', { signal: AbortSignal.timeout(2_000) })
  socket.emit('join', { roomId: '0000', name: 'Guest' })
  assert.equal((await blocked)[0].code, 'rate_limited')
  assert.equal(h.saves(), 0)
})

test('unauthenticated admin API floods cannot block an existing owner session or cookie clearing', async t => {
  const h = await harness(t)
  const login = await fetch(h.url + '/api/admin/session', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1', Origin: ORIGIN },
    body: JSON.stringify({ password: KEY, remember: false }),
  })
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  for (let n = 0; n < 119; n++) {
    const response = await fetch(h.url + '/api/admin/dashboard')
    assert.equal(response.status, 401)
    await response.text()
  }
  assert.equal((await fetch(h.url + '/api/admin/dashboard')).status, 429)
  assert.equal((await fetch(h.url + '/api/admin/dashboard', { headers: { Cookie: cookie } })).status, 200)
  const logout = await fetch(h.url + '/api/admin/session', { method: 'DELETE', headers: { 'X-Admin-Request': '1', Origin: ORIGIN } })
  assert.equal(logout.status, 200)
  assert.match(logout.headers.get('set-cookie')!, /Expires=/)
})

test('socket event floods receive a failed acknowledgement before entering the shared game queue', async t => {
  const h = await harness(t)
  const socket = await h.connect(ORIGIN)
  for (let n = 0; n < 120; n++) {
    const result = await socket.timeout(2_000).emitWithAck('membership_auth', { token: null })
    assert.equal(result.ok, true)
  }
  const blocked = await socket.timeout(2_000).emitWithAck('membership_auth', { token: null })
  assert.deepEqual(blocked, { ok: false, error: 'Too many attempts. Please wait before trying again.', code: 'rate_limited' })
  assert.equal(h.saves(), 0)
})
