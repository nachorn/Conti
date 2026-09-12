import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import type { SnapshotStore } from '../src/storage.js'

class MemoryStore implements SnapshotStore {
  saves = 0
  healthy = true
  async load() { return null }
  async save() { this.saves++ }
  async close() {}
  isHealthy() { return this.healthy }
}

async function harness(t: TestContext) {
  const store = new MemoryStore()
  const server = await createGameServer(store)
  const port = await server.listen(0, '127.0.0.1')
  const url = `http://127.0.0.1:${port}`
  const peers: Socket[] = []
  t.after(async () => { for (const socket of peers) socket.disconnect(); await server.close() })
  return {
    server, store, read: (id: string) => fetch(`${url}/api/rooms/${id}/invite`),
    async connect() {
      const socket = io(url, { autoConnect: false, transports: ['websocket'], reconnection: false })
      peers.push(socket)
      const connected = once(socket, 'connect', { signal: AbortSignal.timeout(2_000) })
      socket.connect(); await connected
      return socket
    },
  }
}
async function request(socket: Socket, event: string, data: unknown, response = 'joined') {
  const result = once(socket, response, { signal: AbortSignal.timeout(2_000) })
  socket.emit(event, data)
  return (await result)[0]
}

test('invitations show the current host and allow a new player to join either game without exposing a room snapshot', async t => {
  for (const gameType of ['continental', 'pocha']) {
    const h = await harness(t)
    const host = await h.connect()
    const created = await request(host, 'create', { name: 'Lucía & Pablo', gameType })
    const saves = h.store.saves
    const updatedAt = h.server.repository.get(created.roomId)!.updatedAt
    const response = await h.read(created.roomId)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), {
      roomId: created.roomId, hostName: 'Lucía & Pablo', gameType, playerCount: 1, maxPlayers: 10, status: 'open',
    })
    assert.equal(h.store.saves, saves)
    assert.equal(h.server.repository.get(created.roomId)!.updatedAt, updatedAt)
    const guest = await h.connect()
    const joined = await request(guest, 'join', { roomId: created.roomId, name: 'Ana' })
    assert.equal(joined.roomId, created.roomId)
    assert.equal((await (await h.read(created.roomId)).json()).playerCount, 2)
    // Host migration is reflected without changing the invitation URL.
    await request(host, 'leave', {}, 'left')
    assert.equal((await (await h.read(created.roomId)).json()).hostName, 'Ana')
    await request(guest, 'leave', {}, 'left')
    assert.equal((await h.read(created.roomId)).status, 404)
  }
})

test('invitations distinguish full and started rooms and preserve the server join rules', async t => {
  const h = await harness(t)
  const host = await h.connect()
  const created = await request(host, 'create', { name: 'Host', gameType: 'pocha' })
  h.server.repository.get(created.roomId)!.room.maxPlayers = 2
  const guest = await h.connect()
  await request(guest, 'join', { roomId: created.roomId, name: 'Guest' })
  assert.equal((await (await h.read(created.roomId)).json()).status, 'full')
  const extra = await h.connect()
  const rejected = await request(extra, 'join', { roomId: created.roomId, name: 'Late' }, 'error')
  assert.equal(rejected.message, 'Room full or game started')
  assert.equal((await host.timeout(2_000).emitWithAck('start', {
    pochaSettings: { mode: 'subastada', maxCards: 1, oneCardRounds: 1, peakRounds: 1 },
  })).ok, true)
  const body = await (await h.read(created.roomId)).json()
  assert.equal(body.status, 'started')
  assert.deepEqual(Object.keys(body).sort(), ['roomId', 'hostName', 'gameType', 'playerCount', 'maxPlayers', 'status'].sort())
})

test('missing, malformed and expired invitations fail cleanly; unavailable storage never advertises an open room', async t => {
  const h = await harness(t)
  for (const code of ['0000', 'abc', '12345']) {
    const response = await h.read(code)
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'room_not_found' })
  }
  const host = await h.connect()
  const created = await request(host, 'create', { name: 'Host' })
  const record = h.server.repository.get(created.roomId)!
  record.room.setConnected(created.playerId, false)
  record.updatedAt = Date.now() - h.server.repository.retentionMs - 100
  assert.equal((await h.read(created.roomId)).status, 404)
  h.store.healthy = false
  const response = await h.read(created.roomId)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'server_unavailable' })
})
