import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { dashboardSnapshot } from '../src/dashboard.js'
import { GameRepository, issueCredential } from '../src/recovery.js'
import { Room } from '../src/room.js'
import type { SnapshotStore } from '../src/storage.js'
import type { DashboardSnapshot } from '../../shared/dashboard.js'

const KEY = 'dashboard-test-key-for-local-tests-only'
class MemoryStore implements SnapshotStore {
  value: unknown = null
  saves = 0
  healthy = true
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.saves++; this.value = structuredClone(value) }
  async close() {}
  isHealthy() { return this.healthy }
}
async function harness(t: TestContext, dashboardKey: string | undefined = KEY) {
  const store = new MemoryStore()
  const server = await createGameServer(store, { dashboardKey, origins: ['https://games.example'] })
  const port = await server.listen(0, '127.0.0.1')
  const url = `http://127.0.0.1:${port}`
  const peers: Socket[] = []
  t.after(async () => { for (const peer of peers) peer.disconnect(); await server.close() })
  return {
    server, store,
    read: (key = KEY, suffix = '') => fetch(`${url}/api/admin/dashboard${suffix}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} }),
    async connect(resume?: unknown) {
      const socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: resume ? { resume } : {} })
      peers.push(socket)
      const connected = once(socket, 'connect', { signal: AbortSignal.timeout(2_000) })
      socket.connect(); await connected
      return socket
    },
  }
}
async function request(socket: Socket, event: string, payload: unknown, response = 'joined') {
  const result = once(socket, response, { signal: AbortSignal.timeout(2_000) })
  socket.emit(event, payload)
  return (await result)[0]
}
async function acknowledge(socket: Socket, event: string, payload: unknown) {
  const result = await socket.timeout(2_000).emitWithAck(event, payload)
  assert.equal(result.ok, true, result.error)
}

test('dashboard fails closed without a strong key and requires a header credential', async t => {
  for (const key of ['', 'short', 'x'.repeat(257)]) {
    const h = await harness(t, key)
    const response = await h.read()
    assert.equal(response.status, 503)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'dashboard_not_configured' })
  }
  const h = await harness(t)
  for (const [key, suffix] of [['', ''], ['incorrect', ''], ['', `?key=${KEY}`], ['x'.repeat(257), '']]) {
    const response = await h.read(key, suffix)
    assert.equal(response.status, 401)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
  }
  const response = await h.read()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json() as DashboardSnapshot
  assert.deepEqual(data.summary, { onlinePlayers: 0, activeRooms: 0, waitingRooms: 0, offlineRooms: 0 })
})

test('dashboard follows real joins, starts, disconnects, recovery and leaving without exposing hands', async t => {
  const h = await harness(t)
  const host = await h.connect()
  const joined = await request(host, 'create', { name: 'Nacho', gameType: 'continental' })
  const guest = await h.connect()
  const guestJoined = await request(guest, 'join', { name: 'Ana', roomId: joined.roomId })
  // An idle browser connection must not count as a player.
  await h.connect()
  let data = await (await h.read()).json() as DashboardSnapshot
  assert.equal(data.summary.onlinePlayers, 2)
  assert.equal(data.summary.waitingRooms, 1)
  assert.equal(data.rooms[0].round, null)
  assert.equal(data.rooms[0].players[0].host, true)
  await acknowledge(host, 'start', {})
  const saves = h.store.saves
  data = await (await h.read()).json() as DashboardSnapshot
  assert.equal(h.store.saves, saves, 'dashboard reads must not write snapshots or extend room retention')
  assert.equal(data.summary.activeRooms, 1)
  assert.equal(data.summary.waitingRooms, 0)
  assert.equal(data.rooms[0].round, 1)
  assert.equal(data.rooms[0].totalRounds, 7)
  assert.ok(data.rooms[0].players.some(player => player.id === data.rooms[0].currentPlayerId))
  assert.deepEqual(Object.keys(data.rooms[0]).sort(), ['roomId', 'gameType', 'phase', 'round', 'totalRounds', 'onlinePlayers', 'currentPlayerId', 'updatedAt', 'players'].sort())
  for (const player of data.rooms[0].players) assert.deepEqual(Object.keys(player).sort(), ['id', 'name', 'online', 'host'].sort())
  const serialized = JSON.stringify(data)
  assert.ok(!serialized.includes(joined.resumeToken))
  assert.ok(!serialized.includes(guestJoined.resumeToken))
  assert.ok(!serialized.includes('tokenHash'))
  assert.ok(!serialized.includes('hand'))
  const disconnected = once(host, 'state', { signal: AbortSignal.timeout(2_000) })
  guest.disconnect(); await disconnected
  data = await (await h.read()).json() as DashboardSnapshot
  assert.equal(data.summary.onlinePlayers, 1)
  assert.equal(data.rooms[0].players.find(player => player.name === 'Ana')?.online, false)
  const resumed = once(host, 'state', { signal: AbortSignal.timeout(2_000) })
  const guestAgain = await h.connect({ roomId: guestJoined.roomId, playerId: guestJoined.playerId, token: guestJoined.resumeToken })
  await resumed
  data = await (await h.read()).json() as DashboardSnapshot
  assert.equal(data.summary.onlinePlayers, 2)
  assert.equal(data.rooms[0].players.length, 2)
  await request(guestAgain, 'leave', {}, 'left')
  await request(host, 'leave', {}, 'left')
  data = await (await h.read()).json() as DashboardSnapshot
  assert.equal(data.rooms.length, 0)
})

test('dashboard reports Pocha phases and rounds from the Pocha engine', async t => {
  const h = await harness(t)
  const host = await h.connect()
  const joined = await request(host, 'create', { name: 'Host', gameType: 'pocha' })
  const guest = await h.connect()
  await request(guest, 'join', { name: 'Guest', roomId: joined.roomId })
  await acknowledge(host, 'start', { pochaSettings: { mode: 'subastada', maxCards: 2, oneCardRounds: 1, peakRounds: 1 } })
  const data = await (await h.read()).json() as DashboardSnapshot
  const pocha = h.server.repository.get(joined.roomId)!.room.pocha!
  assert.equal(data.rooms[0].gameType, 'pocha')
  assert.equal(data.rooms[0].phase, pocha.phase)
  assert.notEqual(data.rooms[0].phase, 'lobby')
  assert.equal(data.rooms[0].round, pocha.handNumber)
  assert.equal(data.rooms[0].totalRounds, pocha.schedule.length)
  assert.equal(data.rooms[0].currentPlayerId, pocha.players[pocha.currentPlayerIndex].id)
  assert.equal(data.summary.activeRooms, 1)
})

test('offline saved seats remain visible, expired rooms are omitted, and live transport wins over saved flags', async () => {
  const repository = new GameRepository(new MemoryStore())
  for (const roomId of ['1234', '2345', '3456']) {
    const room = new Room({ roomId })
    const { credential, session } = issueCredential(roomId)
    room.addPlayer(credential.playerId, `Player ${roomId}`)
    if (roomId !== '1234') room.setConnected(credential.playerId, false)
    await repository.commit(roomId, { room, sessions: [session], updatedAt: Date.now(), paused: null })
  }
  repository.records.get('3456')!.updatedAt = Date.now() - repository.retentionMs - 100
  const data = dashboardSnapshot(repository, () => false)
  assert.equal(data.rooms.length, 2)
  assert.ok(!data.rooms.some(room => room.roomId === '3456'))
  assert.equal(data.summary.onlinePlayers, 0)
  assert.equal(data.summary.offlineRooms, 2)
  assert.ok(data.rooms.every(room => room.currentPlayerId === null))
})

test('dashboard returns unavailable on storage failure instead of a misleading live snapshot', async t => {
  const h = await harness(t)
  h.store.healthy = false
  const response = await h.read()
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'server_unavailable' })
})
