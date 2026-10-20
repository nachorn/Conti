import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import type { RoomCleanupSelection } from '../src/dashboard.js'
import { GameRepository, issueCredential, type RoomRecord } from '../src/recovery.js'
import { Room } from '../src/room.js'
import type { SnapshotStore } from '../src/storage.js'

const KEY = 'dashboard-cleanup-local-test-key-only'
const ORIGIN = 'https://games.example'
const DAY = 86_400_000
class MemoryStore implements SnapshotStore {
  value: any = null
  saves = 0
  healthy = true
  failSaves = false
  failAfterSave = false
  saveGate: Promise<void> | null = null
  saveStarted: (() => void) | null = null
  async load() { return structuredClone(this.value) }
  async save(value: unknown) {
    this.saves++
    if (this.failSaves) throw new Error('local write failure')
    const captured = structuredClone(value)
    this.saveStarted?.()
    if (this.saveGate) await this.saveGate
    this.value = captured
    if (this.failAfterSave) throw new Error('local ambiguous acknowledgement')
  }
  async close() {}
  isHealthy() { return this.healthy }
}
async function harness(t: TestContext, key = KEY) {
  const store = new MemoryStore()
  const server = await createGameServer(store, { dashboardKey: key, origins: [ORIGIN] })
  const url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`
  const peers: Socket[] = []
  t.after(async () => { for (const peer of peers) peer.disconnect(); await server.close() })
  const headers = { Authorization: `Bearer ${KEY}`, 'x-admin-request': '1', 'content-type': 'application/json', origin: ORIGIN }
  return {
    server, store, url, headers,
    post: (rooms: unknown, overrides: Record<string, string> = {}) => fetch(`${url}/api/admin/rooms/cleanup`, {
      method: 'POST', headers: { ...headers, ...overrides }, body: JSON.stringify({ rooms }),
    }),
    async connect(resume?: unknown) {
      const socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: resume ? { resume } : {} })
      peers.push(socket)
      const joined = resume ? once(socket, 'joined', { signal: AbortSignal.timeout(2_000) }) : null
      const connected = once(socket, 'connect', { signal: AbortSignal.timeout(2_000) })
      socket.connect(); await connected
      if (joined) await joined
      return socket
    },
  }
}
function seed(h: Awaited<ReturnType<typeof harness>>, roomId: string, ageDays = 10, gameType: 'continental' | 'pocha' = 'continental') {
  const room = new Room({ roomId, gameType })
  const issued = issueCredential(roomId)
  room.addPlayer(issued.credential.playerId, `Local ${roomId}`)
  room.setConnected(issued.credential.playerId, false)
  const record: RoomRecord = { room, sessions: [issued.session], updatedAt: Date.now() - ageDays * DAY, paused: null, manualPaused: false, chat: [] }
  h.server.repository.records.set(roomId, record)
  syncFixtureStore(h)
  return { record, credential: issued.credential }
}
function syncFixtureStore(h: Awaited<ReturnType<typeof harness>>) {
  h.store.value = { version: 1, savedAt: Date.now(), rooms: [...h.server.repository.records.values()].map(record => ({
    ...record, room: record.room.toSnapshot(),
  })) }
  h.store.value = structuredClone(h.store.value)
}
function selection(record: RoomRecord): RoomCleanupSelection {
  return { roomId: record.room.roomId, expectedUpdatedAt: record.updatedAt, expectedPhase: record.room.pocha?.phase ?? record.room.phase }
}
async function request(socket: Socket, event: string, payload: unknown, response = 'joined') {
  const result = once(socket, response, { signal: AbortSignal.timeout(2_000) })
  socket.emit(event, payload)
  return (await result)[0]
}

test('cleanup requires strong admin authentication, write protection and a precise bounded selection', async t => {
  const h = await harness(t)
  const { record } = seed(h, '1234')
  const chosen = [selection(record)]
  for (const [overrides, status] of [
    [{ Authorization: '' }, 401], [{ Authorization: 'Bearer wrong' }, 401],
    [{ 'x-admin-request': '' }, 403], [{ origin: 'https://untrusted.example' }, 403],
  ] as const) {
    const response = await h.post(chosen, overrides)
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  for (const rooms of [[], null, {}, [chosen[0], chosen[0]], [{ ...chosen[0], expectedUpdatedAt: -1 }],
    [{ ...chosen[0], expectedUpdatedAt: 1.1 }], [{ ...chosen[0], expectedPhase: 'fake' }],
    [{ ...chosen[0], force: true }], [{ ...chosen[0], roomId: '../1234' }], Array(501).fill(chosen[0])]) {
    assert.equal((await h.post(rooms)).status, 400)
  }
  const extra = await fetch(`${h.url}/api/admin/rooms/cleanup`, { method: 'POST', headers: h.headers, body: JSON.stringify({ rooms: chosen, all: true }) })
  assert.equal(extra.status, 400)
  assert.equal(h.store.saves, 0)
  assert.equal(h.server.repository.records.size, 1)
  const unconfigured = await harness(t, '')
  assert.equal((await unconfigured.post(chosen)).status, 503)
})

test('cleanup supports the existing admin cookie and deletes only the selected offline rooms in one durable save', async t => {
  const h = await harness(t)
  const first = seed(h, '1234', 10), second = seed(h, '2345', 15, 'pocha')
  seed(h, '3456', 2)
  seed(h, '4567', 31) // Even an unrelated expired record is not silently swept by this explicit operation.
  const before = structuredClone(h.store.value)
  const login = await fetch(`${h.url}/api/admin/session`, { method: 'POST', headers: h.headers, body: JSON.stringify({ password: KEY, remember: false }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie')!.split(';')[0]
  const response = await h.post([selection(first.record), selection(second.record)], { Authorization: '', cookie })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, deletedRoomIds: ['1234', '2345'] })
  assert.equal(h.store.saves, 1)
  assert.deepEqual([...h.server.repository.records.keys()], ['3456', '4567'])
  assert.deepEqual(h.store.value.rooms, before.rooms.filter((r: any) => !['1234', '2345'].includes(r.room.roomId)))
  const restored = new GameRepository(h.store)
  await restored.load()
  assert.equal(restored.get('1234'), undefined)
  assert.equal(restored.get('2345'), undefined)
  assert.equal(restored.get('3456')!.updatedAt, before.rooms.find((r: any) => r.room.roomId === '3456').updatedAt)
  assert.equal((await h.post([selection(first.record)])).status, 409, 'a retry cannot delete a newly reused room code')
})

test('one missing, stale, changed-phase or connected selection rejects the entire cleanup without writes', async t => {
  const h = await harness(t)
  const a = seed(h, '1234'), b = seed(h, '2345')
  const expected = [selection(a.record), selection(b.record)]
  const initial = structuredClone(h.store.value)
  assert.equal((await h.post([...expected, { ...expected[0], roomId: '9999' }])).status, 409)
  assert.equal((await h.post([expected[0], { ...expected[1], expectedUpdatedAt: expected[1].expectedUpdatedAt - 1 }])).status, 409)
  assert.equal((await h.post([expected[0], { ...expected[1], expectedPhase: 'game_end' }])).status, 409)
  b.record.room.setConnected(b.credential.playerId, true)
  assert.equal((await h.post(expected)).status, 409)
  b.record.room.setConnected(b.credential.playerId, false)
  const live = await h.connect(b.credential)
  const connectedRecord = h.server.repository.records.get('2345')!
  connectedRecord.room.setConnected(b.credential.playerId, false) // Live transport still protects a seat with a stale saved flag.
  const saves = h.store.saves
  assert.equal((await h.post([selection(a.record), selection(connectedRecord)])).status, 409)
  assert.equal(h.store.saves, saves)
  assert.equal(h.server.repository.records.size, 2)
  assert.deepEqual(h.store.value.rooms[0], initial.rooms[0])
  live.disconnect()
})

test('cleanup checks selection again after earlier queued game changes and cannot overwrite a resumed room', async t => {
  const h = await harness(t)
  const old = seed(h, '1234'), other = seed(h, '2345')
  const chosen = [selection(old.record), selection(other.record)]
  let release!: () => void
  h.store.saveGate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { h.store.saveStarted = resolve })
  const resumed = h.connect(old.credential)
  await started
  const cleanup = h.post(chosen)
  release()
  const peer = await resumed
  const response = await cleanup
  assert.equal(response.status, 409)
  assert.equal(h.store.saves, 1, 'only the reconnect was saved')
  assert.equal(h.server.repository.records.size, 2)
  assert.equal(h.server.repository.get('1234')!.room.players[0].connected, true)
  peer.disconnect()
})

test('cleanup waits for durable saving and serialized later game creation preserves unrelated and new rooms', async t => {
  const h = await harness(t)
  const old = seed(h, '1234'), keep = seed(h, '2345', 1)
  const outsider = await h.connect()
  let release!: () => void
  h.store.saveGate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { h.store.saveStarted = resolve })
  let acknowledged = false
  const cleanup = h.post([selection(old.record)]).then(response => { acknowledged = true; return response })
  await started
  assert.equal(acknowledged, false)
  assert.equal(h.server.repository.records.has('1234'), true)
  const created = request(outsider, 'create', { name: 'Later player', gameType: 'pocha' })
  release()
  assert.deepEqual(await (await cleanup).json(), { ok: true, deletedRoomIds: ['1234'] })
  const joined = await created
  assert.equal(h.server.repository.records.has('1234'), false)
  assert.equal(h.server.repository.records.has(joined.roomId), true)
  assert.equal(h.server.repository.records.get('2345')!.updatedAt, keep.record.updatedAt)
  assert.deepEqual(h.store.value.rooms.map((record: any) => record.room.roomId).sort(), ['2345', joined.roomId].sort())
})

test('cleanup write failures never publish deletion and stop later actions until recovery', async t => {
  const h = await harness(t)
  const a = seed(h, '1234'), b = seed(h, '2345')
  const before = structuredClone(h.store.value)
  h.store.failSaves = true
  const response = await h.post([selection(a.record)])
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { ok: false, error: 'server_unavailable' })
  assert.equal(h.server.repository.failed, true)
  assert.equal(h.server.repository.records.size, 2)
  assert.deepEqual(h.store.value, before)
  assert.equal((await h.post([selection(b.record)])).status, 503)
  assert.equal(h.store.saves, 1)
})

test('ambiguous cleanup acknowledgement fails closed and restart trusts the durable result', async t => {
  const h = await harness(t)
  const a = seed(h, '1234'), b = seed(h, '2345')
  h.store.failAfterSave = true
  assert.equal((await h.post([selection(a.record)])).status, 503)
  assert.equal(h.server.repository.failed, true)
  assert.equal(h.server.repository.records.size, 2, 'uncertain memory must never continue play')
  h.store.failAfterSave = false
  const restored = new GameRepository(h.store)
  await restored.load()
  assert.equal(restored.get('1234'), undefined)
  assert.equal(restored.get('2345')!.updatedAt, b.record.updatedAt)
})

test('unhealthy storage rejects cleanup without attempting a write', async t => {
  const h = await harness(t)
  const { record } = seed(h, '1234')
  h.store.healthy = false
  assert.equal((await h.post([selection(record)])).status, 503)
  assert.equal(h.store.saves, 0)
  assert.equal(h.server.repository.records.size, 1)
})
