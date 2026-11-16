import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import type { SnapshotStore } from '../src/storage.js'

class MemoryStore implements SnapshotStore {
  value: unknown = null
  healthy = true
  async load() { return this.value }
  async save(value: unknown) { this.value = structuredClone(value) }
  async close() {}
  isHealthy() { return this.healthy }
}
const key = 'local-operations-test-access-key-32-characters'

test('operations requires owner authentication and remains passive during storage outage', async t => {
  const store = new MemoryStore()
  const server = await createGameServer(store, { dashboardKey: key })
  const port = await server.listen(0, '127.0.0.1')
  t.after(() => server.close())
  const url = `http://127.0.0.1:${port}/api/admin/operations`
  for (const suffix of ['', `?key=${key}`]) {
    const response = await fetch(url + suffix)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'unauthorized' })
  }
  const read = () => fetch(url, { headers: { Authorization: `Bearer ${key}` } })
  let response = await read()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const data = await response.json() as any
  assert.equal(data.healthy, true)
  assert.equal(data.storage.games.limitBytes, 16 * 1024 * 1024)
  assert.equal(data.storage.accounts, null)
  assert.equal(data.email, null)
  assert.ok(data.process.rssBytes > 0)
  assert.ok(!JSON.stringify(data).includes(key))
  store.healthy = false
  response = await read()
  assert.equal(response.status, 200)
  assert.equal((await response.json() as any).healthy, false)
  assert.equal(store.value, null, 'passive metrics must not write a snapshot')
})

test('capacity refuses a new deal without changing saved seats or failing the server', async t => {
  const store = new MemoryStore()
  const server = await createGameServer(store)
  const port = await server.listen(0, '127.0.0.1')
  const peers: Socket[] = []
  t.after(async () => { peers.forEach(peer => peer.disconnect()); await server.close() })
  const connect = async () => {
    const socket = io(`http://127.0.0.1:${port}`, { autoConnect: false, reconnection: false, transports: ['websocket'] })
    peers.push(socket)
    const connected = once(socket, 'connect', { signal: AbortSignal.timeout(3000) })
    socket.connect(); await connected
    return socket
  }
  for (const gameType of ['continental', 'pocha']) {
    const host = await connect()
    let joined = once(host, 'joined', { signal: AbortSignal.timeout(3000) })
    host.emit('create', { name: 'Host', gameType })
    const [seat] = await joined
    const guest = await connect()
    joined = once(guest, 'joined', { signal: AbortSignal.timeout(3000) })
    guest.emit('join', { name: 'Guest', roomId: seat.roomId }); await joined
    const stored = structuredClone(store.value)
    const original = server.repository.canStartNewGame.bind(server.repository)
    server.repository.canStartNewGame = () => false
    const result = await host.timeout(3000).emitWithAck('start', {})
    assert.equal(result.code, 'storage_capacity')
    assert.equal(server.repository.failed, false)
    assert.equal(server.repository.get(seat.roomId)?.room.phase, 'lobby')
    assert.deepEqual(store.value, stored)
    server.repository.canStartNewGame = original
    assert.equal((await host.timeout(3000).emitWithAck('start', {})).ok, true)
  }
})
