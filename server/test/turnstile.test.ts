import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { TurnstileVerifier, turnstileFromEnvironment, type RoomEntryVerifier } from '../src/turnstile.js'

const HOST = 'conti-six.vercel.app'
const NOW = Date.parse('2026-10-31T18:00:00Z')
const SITE_KEY = 'public-widget-key-for-tests'
const SECRET = 'private-verifier-key-for-tests'
const valid = () => ({ success: true, hostname: HOST, action: 'room_entry', challenge_ts: new Date(NOW).toISOString() })

test('verification requires success, exact hostname/action and a recent timestamp, and rejects bad provider responses', async () => {
  const cases: unknown[] = [null, [], {}, { ...valid(), success: 'true' }, { ...valid(), success: false },
    { ...valid(), hostname: 'attacker.example' }, { ...valid(), hostname: HOST + '.attacker.example' },
    { ...valid(), action: 'other_form' }, { ...valid(), challenge_ts: 'invalid' },
    { ...valid(), challenge_ts: new Date(NOW - 300_001).toISOString() },
    { ...valid(), challenge_ts: new Date(NOW + 30_001).toISOString() }]
  let calls = 0
  let body: unknown = valid()
  const verifier = new TurnstileVerifier(SITE_KEY, SECRET, [HOST], async (url, init) => {
    calls++
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(init!.body as string), { secret: SECRET, response: 'proof' })
    assert.ok(init?.signal)
    return new Response(JSON.stringify(body))
  }, () => NOW)
  assert.equal(await verifier.verify('proof'), true)
  for (body of cases) assert.equal(await verifier.verify('proof'), false)
  const before = calls
  for (const token of [null, undefined, {}, '', ' ', 'x'.repeat(2049)]) assert.equal(await verifier.verify(token), false)
  assert.equal(calls, before, 'malformed tokens must not trigger an external request')
  for (const fetcher of [async () => new Response('{}', { status: 503 }), async () => new Response('not JSON'), async () => { throw new Error('private provider failure') }]) {
    const failed = new TurnstileVerifier(SITE_KEY, SECRET, [HOST], fetcher, () => NOW)
    assert.equal(await failed.verify('proof'), false)
  }
})

test('a proof is revalidated instead of caching success, so provider replay rejection is respected', async () => {
  let used = false
  const verifier = new TurnstileVerifier(SITE_KEY, SECRET, [HOST], async () => {
    const result = used ? { success: false, 'error-codes': ['timeout-or-duplicate'] } : valid()
    used = true
    return new Response(JSON.stringify(result))
  }, () => NOW)
  assert.equal(await verifier.verify('proof'), true)
  assert.equal(await verifier.verify('proof'), false)
})

test('concurrent verification work is bounded and capacity returns when requests finish', async () => {
  const release: ((response: Response) => void)[] = []
  const verifier = new TurnstileVerifier(SITE_KEY, SECRET, [HOST], () => new Promise(resolve => release.push(resolve)), () => NOW)
  const pending = Array.from({ length: 20 }, () => verifier.verify('proof'))
  assert.equal(await verifier.verify('proof'), false)
  assert.equal(release.length, 20)
  for (const resolve of release) resolve(new Response(JSON.stringify(valid())))
  assert.ok((await Promise.all(pending)).every(Boolean))
  const next = verifier.verify('proof')
  assert.equal(release.length, 21)
  release[20](new Response(JSON.stringify(valid())))
  assert.equal(await next, true)
})

test('configuration is optional, fails closed when incomplete, and refuses dummy production keys', () => {
  assert.equal(turnstileFromEnvironment({}, ['https://' + HOST]), undefined)
  for (const env of [{ TURNSTILE_SITE_KEY: SITE_KEY }, { TURNSTILE_SECRET_KEY: SECRET },
    { NODE_ENV: 'production', TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: SECRET }]) {
    assert.throws(() => turnstileFromEnvironment(env, ['https://' + HOST]))
  }
  assert.throws(() => turnstileFromEnvironment({ TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: SECRET }, []))
  assert.ok(turnstileFromEnvironment({ TURNSTILE_SITE_KEY: SITE_KEY, TURNSTILE_SECRET_KEY: SECRET }, ['https://' + HOST]))
})

async function harness(t: TestContext, turnstile: RoomEntryVerifier) {
  let saves = 0
  const server = await createGameServer({ async load() { return null }, async save() { saves++ }, async close() {} }, {
    origins: ['https://' + HOST], turnstile,
  })
  const port = await server.listen(0, '127.0.0.1')
  const url = `http://127.0.0.1:${port}`
  const sockets: Socket[] = []
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close() })
  const peer = (auth?: object) => {
    const socket = io(url, { autoConnect: false, transports: ['websocket'], reconnection: false, auth })
    sockets.push(socket)
    return socket
  }
  const connect = async () => {
    const socket = peer()
    const connected = once(socket, 'connect', { signal: AbortSignal.timeout(2_000) })
    socket.connect(); await connected
    return socket
  }
  return { server, url, peer, connect, saves: () => saves }
}

test('new create and join need a valid proof, while an authenticated seat can reconnect without another challenge', async t => {
  const seen: unknown[] = []
  const used = new Set<unknown>()
  const h = await harness(t, { siteKey: SITE_KEY, async verify(token) {
    seen.push(token)
    if (typeof token !== 'string' || !token.startsWith('valid-') || used.has(token)) return false
    used.add(token); return true
  } })
  const config = await fetch(h.url + '/api/security/config')
  assert.equal(config.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await config.json(), { turnstileSiteKey: SITE_KEY })
  const host = await h.connect()
  const rejected = once(host, 'error', { signal: AbortSignal.timeout(2_000) })
  host.emit('create', { name: 'Host' })
  assert.equal((await rejected)[0].code, 'verification_failed')
  assert.equal(h.saves(), 0)
  const created = once(host, 'joined', { signal: AbortSignal.timeout(2_000) })
  host.emit('create', { name: 'Host', turnstileToken: 'valid-create' })
  const seat = (await created)[0]
  const guest = await h.connect()
  const replayed = once(guest, 'error', { signal: AbortSignal.timeout(2_000) })
  guest.emit('join', { roomId: seat.roomId, name: 'Guest', turnstileToken: 'valid-create' })
  assert.equal((await replayed)[0].code, 'verification_failed')
  assert.equal(h.server.repository.get(seat.roomId)!.room.players.length, 1)
  const joined = once(guest, 'joined', { signal: AbortSignal.timeout(2_000) })
  guest.emit('join', { roomId: seat.roomId, name: 'Guest', turnstileToken: 'valid-join' })
  await joined
  const calls = seen.length
  host.disconnect()
  const resumed = h.peer({ resume: { roomId: seat.roomId, playerId: seat.playerId, token: seat.resumeToken } })
  const restored = once(resumed, 'joined', { signal: AbortSignal.timeout(2_000) })
  resumed.connect()
  assert.equal((await restored)[0].playerId, seat.playerId)
  assert.equal(seen.length, calls)
})

test('a slow external verification never blocks another socket or accepts two pending entries from one socket', async t => {
  let release!: (valid: boolean) => void
  let started!: () => void
  const entered = new Promise<void>(resolve => { started = resolve })
  const h = await harness(t, { siteKey: SITE_KEY, verify() {
    started()
    return new Promise<boolean>(resolve => { release = resolve })
  } })
  const waiting = await h.connect()
  const other = await h.connect()
  waiting.emit('create', { name: 'Waiting', turnstileToken: 'proof' })
  await entered
  const duplicate = once(waiting, 'error', { signal: AbortSignal.timeout(2_000) })
  waiting.emit('create', { name: 'Duplicate', turnstileToken: 'other' })
  assert.equal((await duplicate)[0].code, 'verification_pending')
  assert.equal((await other.timeout(500).emitWithAck('membership_auth', { token: null })).ok, true)
  assert.equal(h.saves(), 0)
  const created = once(waiting, 'joined', { signal: AbortSignal.timeout(2_000) })
  release(true)
  await created
  assert.equal(h.server.repository.records.size, 1)
})
