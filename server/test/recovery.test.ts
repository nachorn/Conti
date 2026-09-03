import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { cloneRecord, type ResumeCredential } from '../src/recovery.js'
import type { RoomSnapshot } from '../src/room.js'
import type { SnapshotStore } from '../src/storage.js'
import type { GameState } from '../src/types.js'

class MemoryStore implements SnapshotStore {
  value: unknown | null
  failSaves = false
  failAfterSave = false
  failLoad = false
  saveAttempts = 0
  closed = false
  saveGate: Promise<void> | null = null
  onSaveStarted: (() => void) | null = null

  constructor(initial: unknown | null = null) {
    this.value = structuredClone(initial)
  }

  async load(): Promise<unknown | null> {
    if (this.failLoad) throw new Error('Storage is offline')
    return structuredClone(this.value)
  }

  async save(snapshot: unknown): Promise<void> {
    const captured = structuredClone(snapshot)
    this.saveAttempts++
    if (this.failSaves) throw new Error('Simulated write failure')
    this.onSaveStarted?.()
    if (this.saveGate) await this.saveGate
    this.value = captured
    if (this.failAfterSave) throw new Error('Simulated lost commit acknowledgement')
  }

  async close(): Promise<void> { this.closed = true }
}

interface SavedGamesFixture {
  version: 1
  savedAt: number
  rooms: {
    room: RoomSnapshot
    sessions: { playerId: string; tokenHash: string }[]
    updatedAt: number
    paused: { turnRemainingMs: number | null; discardRemainingMs: number | null } | null
  }[]
}

interface Joined {
  roomId: string
  playerId: string
  resumeToken: string
  state: GameState
}

interface Received { event: string; payload: unknown }

/** Retains events so a fast handshake cannot race the test's awaited listener. */
class Peer {
  readonly socket: Socket
  readonly received: Received[] = []
  private readonly events = new EventEmitter()

  constructor(url: string, resume?: unknown) {
    this.socket = io(url, {
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
      auth: resume === undefined ? {} : { resume },
    })
    this.socket.onAny((event: string, payload: unknown) => this.record(event, payload))
    this.socket.on('connect', () => this.record('connect', undefined))
    this.socket.on('disconnect', reason => this.record('disconnect', reason))
    this.socket.on('connect_error', error => this.record('connect_error', error.message))
  }

  private record(event: string, payload: unknown): void {
    this.received.push({ event, payload })
    this.events.emit('received')
  }

  mark(): number { return this.received.length }

  wait<T>(event: string, predicate: (payload: T) => boolean = () => true, after = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const inspect = () => {
        const match = this.received.slice(after).find(item => item.event === event && predicate(item.payload as T))
        if (!match) return
        clearTimeout(timer)
        this.events.off('received', inspect)
        resolve(match.payload as T)
      }
      const timer = setTimeout(() => {
        this.events.off('received', inspect)
        reject(new Error(`Timed out waiting for ${event}; received ${this.received.slice(after).map(item => item.event).join(', ')}`))
      }, 2_000)
      this.events.on('received', inspect)
      inspect()
    })
  }

  async connect(): Promise<this> {
    const connected = this.wait('connect')
    this.socket.connect()
    await connected
    return this
  }

  request<T>(event: string, payload: unknown, response: string, predicate: (payload: T) => boolean = () => true): Promise<T> {
    const after = this.mark()
    this.socket.emit(event, payload)
    return this.wait<T>(response, predicate, after)
  }
}

type GameServer = Awaited<ReturnType<typeof createGameServer>>

interface Harness {
  server: GameServer
  store: MemoryStore
  url: string
  peers: Peer[]
  close(): Promise<void>
}

async function harness(t: TestContext, store = new MemoryStore()): Promise<Harness> {
  const server = await createGameServer(store)
  const port = await server.listen(0, '127.0.0.1')
  let closed = false
  const result: Harness = {
    server,
    store,
    url: `http://127.0.0.1:${port}`,
    peers: [],
    async close() {
      if (closed) return
      closed = true
      try { await server.close() }
      finally { for (const peer of result.peers) peer.socket.disconnect() }
    },
  }
  t.after(() => result.close())
  return result
}

async function peer(h: Harness, resume?: unknown): Promise<Peer> {
  const result = new Peer(h.url, resume)
  h.peers.push(result)
  return result.connect()
}

function credential(joined: Joined): ResumeCredential {
  return { roomId: joined.roomId, playerId: joined.playerId, token: joined.resumeToken }
}

async function twoPlayers(h: Harness) {
  const host = await peer(h)
  const hostJoined = await host.request<Joined>('create', { name: 'Host', discardOptionDelaySeconds: 0 }, 'joined')
  const guest = await peer(h)
  const guestJoined = await guest.request<Joined>('join', { name: 'Guest', roomId: hostJoined.roomId }, 'joined')
  return { host, guest, hostJoined, guestJoined, roomId: hostJoined.roomId }
}

async function start(h: Harness, players: Awaited<ReturnType<typeof twoPlayers>>, secondsPerTurn = 0): Promise<GameState> {
  const result = await players.host.request<GameState>('start', { discardOptionDelaySeconds: 0, secondsPerTurn }, 'state', state => state.phase === 'playing')
  await h.server.idle()
  return result
}

async function takeInitialDiscard(h: Harness, players: Awaited<ReturnType<typeof twoPlayers>>): Promise<Peer> {
  const room = h.server.repository.get(players.roomId)!.room
  const playerId = room.players[room.discardOptionPlayerIndex!]!.id
  const active = playerId === players.hostJoined.playerId ? players.host : players.guest
  await active.request<GameState>('take_discard', undefined, 'state', state => state.discardOptionPlayerIndex === null && state.currentPlayerHasDrawn)
  await h.server.idle()
  return active
}

async function disconnect(h: Harness, client: Peer): Promise<void> {
  const serverSocket = h.server.io.sockets.sockets.get(client.socket.id!)
  assert.ok(serverSocket)
  const disconnected = new Promise<void>(resolve => serverSocket.once('disconnect', () => resolve()))
  client.socket.disconnect()
  await disconnected
  await h.server.idle()
}

test('mid-turn server restart restores exact deck, hands, seats, turn and authenticated private views', async t => {
  const first = await harness(t)
  const players = await twoPlayers(first)
  await players.host.request<GameState>('set_seat', { seatIndex: 5 }, 'state', state => state.players[0]!.seatIndex === 5)
  await players.guest.request<GameState>('set_seat', { seatIndex: 2 }, 'state', state => state.players[1]!.seatIndex === 2)
  await start(first, players)
  await takeInitialDiscard(first, players)
  const before = first.server.repository.get(players.roomId)!.room.toSnapshot()

  // Copy the committed bytes BEFORE graceful shutdown, modelling an abrupt crash.
  const crashImage = new MemoryStore(first.store.value)
  await first.close()
  const second = await harness(t, crashImage)
  const offline = second.server.repository.get(players.roomId)!
  assert.ok(offline.room.players.every(player => !player.connected))
  assert.ok(offline.paused)

  const resumedHost = await peer(second, credential(players.hostJoined))
  const hostJoined = await resumedHost.wait<Joined>('joined')
  const resumedGuest = await peer(second, credential(players.guestJoined))
  const guestJoined = await resumedGuest.wait<Joined>('joined')
  await second.server.idle()
  const after = second.server.repository.get(players.roomId)!.room.toSnapshot()
  assert.deepEqual(after, before)
  assert.equal(hostJoined.playerId, players.hostJoined.playerId)
  assert.equal(hostJoined.resumeToken, players.hostJoined.resumeToken)
  for (const response of [hostJoined, guestJoined]) {
    const expectedHand = before.players.find(player => player.id === response.playerId)!.hand
    assert.deepEqual(response.state.players.find(player => player.id === response.playerId)!.hand, expectedHand)
    assert.ok(response.state.players.filter(player => player.id !== response.playerId).flatMap(player => player.hand).every(card => card.id === 'hidden'))
    assert.equal('stock' in response.state, false)
    assert.equal('sessions' in response.state, false)
    assert.equal('tokenHash' in response.state, false)
  }

  const current = after.players[after.currentPlayerIndex]!
  const active = current.id === hostJoined.playerId ? resumedHost : resumedGuest
  const cardId = current.hand[0]!.id
  const continued = await active.request<GameState>('discard', { cardId }, 'state', state => state.topDiscard?.id === cardId)
  assert.equal(continued.players.find(player => player.id === current.id)!.hand.length, current.hand.length - 1)
  assert.equal(continued.currentPlayerHasDrawn, false)
})

test('stored credentials are hashes and wrong tokens or public player IDs cannot reclaim a seat', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  await start(h, players)
  const saved = h.store.value as SavedGamesFixture
  assert.ok(saved.rooms[0]!.sessions.every(session => /^[a-f0-9]{64}$/.test(session.tokenHash)))
  assert.equal(JSON.stringify(saved).includes(players.hostJoined.resumeToken), false)
  assert.equal(JSON.stringify(saved).includes(players.guestJoined.resumeToken), false)

  const attempts: unknown[] = [
    { ...credential(players.hostJoined), token: 'x'.repeat(43) },
    { roomId: players.roomId, playerId: players.hostJoined.playerId },
    { ...credential(players.hostJoined), token: players.guestJoined.resumeToken },
    { ...credential(players.hostJoined), roomId: '0000' },
  ]
  for (const auth of attempts) {
    const attacker = await peer(h, auth)
    const rejected = await attacker.wait<{ message: string }>('resume_failed')
    assert.match(rejected.message, /invalid|expired/i)
    assert.equal(attacker.received.some(item => item.event === 'joined' || item.event === 'state'), false)
    const response = await attacker.request<{ message: string }>('draw', { playerId: players.hostJoined.playerId }, 'error')
    assert.match(response.message, /join or resume/i)
  }
  assert.equal(h.server.repository.get(players.roomId)!.room.players.length, 2)
})

test('disconnect retains the player, cards, host role and seat; same name cannot take over', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  await start(h, players)
  const before = h.server.repository.get(players.roomId)!.room.toSnapshot()
  await disconnect(h, players.host)
  const retained = h.server.repository.get(players.roomId)!.room
  assert.equal(retained.players.length, 2)
  assert.equal(retained.phase, 'playing')
  assert.equal(retained.players[0]!.id, players.hostJoined.playerId)
  assert.equal(retained.players[0]!.connected, false)
  assert.deepEqual(retained.players[0]!.hand, before.players[0]!.hand)
  assert.equal(retained.players[0]!.seatIndex, before.players[0]!.seatIndex)

  const attacker = await peer(h)
  const rejection = await attacker.request<{ message: string }>('join', { roomId: players.roomId, name: 'Host', playerId: players.hostJoined.playerId }, 'error')
  assert.match(rejection.message, /game started/i)
  assert.equal(attacker.received.some(item => item.event === 'state' || item.event === 'joined'), false)

  const resumed = await peer(h, credential(players.hostJoined))
  const restored = await resumed.wait<Joined>('joined')
  assert.equal(restored.state.players[0]!.id, players.hostJoined.playerId)
  assert.equal(restored.state.players[0]!.connected, true)
  assert.deepEqual(restored.state.players[0]!.hand, before.players[0]!.hand)
})

test('equal lobby names receive distinct identities rather than claiming an existing player', async t => {
  const h = await harness(t)
  const host = await peer(h)
  const first = await host.request<Joined>('create', { name: 'Same name' }, 'joined')
  const guest = await peer(h)
  const second = await guest.request<Joined>('join', { roomId: first.roomId, name: 'Same name' }, 'joined')
  assert.notEqual(first.playerId, second.playerId)
  assert.notEqual(first.resumeToken, second.resumeToken)
  assert.equal(second.state.players.length, 2)
  assert.equal(second.state.players[0]!.id, first.playerId)
})

test('a replacement session revokes its old connection without marking the replacement offline', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  const oldSocketId = players.host.socket.id
  const replacedAfter = players.host.mark()
  const replacement = await peer(h, credential(players.hostJoined))
  const joined = await replacement.wait<Joined>('joined')
  await players.host.wait('session_replaced', () => true, replacedAfter)
  await players.host.wait('disconnect', () => true, replacedAfter)
  await h.server.idle()

  assert.notEqual(replacement.socket.id, oldSocketId)
  assert.equal(h.server.io.sockets.sockets.has(oldSocketId!), false)
  assert.equal(h.server.repository.get(players.roomId)!.room.players[0]!.connected, true)
  assert.equal(joined.playerId, players.hostJoined.playerId)

  // A stale tab's buffered action must not affect the live replacement session.
  players.host.socket.emit('set_seat', { seatIndex: 4 })
  await replacement.request<GameState>('set_seat', { seatIndex: 3 }, 'state', state => state.players[0]!.seatIndex === 3)
  await h.server.idle()
  assert.equal(h.server.repository.get(players.roomId)!.room.players[0]!.seatIndex, 3)
  assert.equal(h.server.repository.get(players.roomId)!.room.players[0]!.connected, true)
})

test('explicit leave invalidates the saved credential and removes empty rooms durably', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  await players.host.request('leave', undefined, 'left')
  const room = h.server.repository.get(players.roomId)!
  assert.equal(room.room.players.length, 1)
  assert.equal(room.room.players[0]!.id, players.guestJoined.playerId)
  assert.equal(room.sessions.some(session => session.playerId === players.hostJoined.playerId), false)
  const formerHost = await peer(h, credential(players.hostJoined))
  await formerHost.wait('resume_failed')
  assert.equal(formerHost.received.some(item => item.event === 'state' || item.event === 'joined'), false)

  await players.guest.request('leave', undefined, 'left')
  assert.equal(h.server.repository.get(players.roomId), undefined)
  assert.equal((h.store.value as SavedGamesFixture).rooms.length, 0)
  const formerGuest = await peer(h, credential(players.guestJoined))
  await formerGuest.wait('resume_failed')
})

test('all-offline rooms pause both clocks and recovery grants a reconnect grace period', async t => {
  const first = await harness(t)
  const players = await twoPlayers(first)
  await start(first, players, 30)
  const next = cloneRecord(first.server.repository.get(players.roomId)!)
  next.room.turnDeadline = Date.now() + 2_000
  next.room.discardOptionAvailableAt = Date.now() + 500
  await first.server.repository.commit(players.roomId, next)
  await disconnect(first, players.host)
  await disconnect(first, players.guest)
  const paused = first.server.repository.get(players.roomId)!
  assert.equal(paused.room.turnDeadline, null)
  assert.equal(paused.room.discardOptionAvailableAt, null)
  assert.ok(paused.paused)
  assert.ok(paused.paused.turnRemainingMs! >= 0 && paused.paused.turnRemainingMs! <= 2_000)
  assert.ok(paused.paused.discardRemainingMs! >= 0 && paused.paused.discardRemainingMs! <= 500)
  const pausedTimers = { ...paused.paused }

  const crashValue = structuredClone(first.store.value) as SavedGamesFixture
  crashValue.savedAt -= 60 * 60 * 1000
  const crashImage = new MemoryStore(crashValue)
  await first.close()
  const second = await harness(t, crashImage)
  assert.deepEqual(second.server.repository.get(players.roomId)!.paused, pausedTimers)
  const reconnectStarted = Date.now()
  const resumed = await peer(second, credential(players.hostJoined))
  const joined = await resumed.wait<Joined>('joined')
  assert.ok(joined.state.turnDeadline! >= reconnectStarted + 10_000)
  assert.ok(joined.state.turnDeadline! <= Date.now() + 11_000)
  assert.ok(joined.state.discardOptionAvailableAt! >= reconnectStarted + pausedTimers.discardRemainingMs!)
  assert.equal(second.server.repository.get(players.roomId)!.paused, null)
  assert.equal(joined.state.players.find(player => player.id === players.guestJoined.playerId)!.connected, false)
})

test('failed saves do not publish or commit a move and the server stays fail-closed', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  const before = h.server.repository.get(players.roomId)!.room.toSnapshot()
  const durableBefore = structuredClone(h.store.value)
  const beforeStart = players.host.mark()
  h.store.failSaves = true
  const rejected = await players.host.request<{ message: string }>('start', { secondsPerTurn: 0 }, 'error')
  assert.match(rejected.message, /save|saving/i)
  await h.server.idle()
  assert.equal(h.server.repository.failed, true)
  assert.deepEqual(h.server.repository.get(players.roomId)!.room.toSnapshot(), before)
  assert.deepEqual(h.store.value, durableBefore)
  assert.equal(players.host.received.slice(beforeStart).some(item => item.event === 'state' && (item.payload as GameState).phase === 'playing'), false)
  const health = await fetch(`${h.url}/health`)
  assert.equal(health.status, 503)
  assert.deepEqual(await health.json(), { ok: false })

  h.store.failSaves = false
  const writesAfterFailure = h.store.saveAttempts
  await players.host.request('set_seat', { seatIndex: 3 }, 'error')
  await h.server.idle()
  assert.equal(h.store.saveAttempts, writesAfterFailure)
  assert.deepEqual(h.server.repository.get(players.roomId)!.room.toSnapshot(), before)
})

test('state is published only after durable saving and queued moves do not overwrite each other', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  h.store.saveGate = new Promise<void>(resolve => { releaseSave = resolve })
  const saveStarted = new Promise<void>(resolve => { signalSaveStarted = resolve })
  h.store.onSaveStarted = signalSaveStarted
  const before = h.server.repository.get(players.roomId)!.room.toSnapshot()
  const durableBefore = structuredClone(h.store.value)
  const hostMark = players.host.mark()
  const firstMove = players.host.request<GameState>('set_seat', { seatIndex: 3 }, 'state', state => state.players[0]!.seatIndex === 3)
  await saveStarted
  const secondMove = players.guest.request<GameState>('set_seat', { seatIndex: 4 }, 'state', state => state.players[1]!.seatIndex === 4)
  try {
    assert.deepEqual(h.server.repository.get(players.roomId)!.room.toSnapshot(), before)
    assert.deepEqual(h.store.value, durableBefore)
    assert.equal(players.host.received.slice(hostMark).some(item => item.event === 'state' && (item.payload as GameState).players[0]!.seatIndex === 3), false)
  } finally {
    h.store.onSaveStarted = null
    h.store.saveGate = null
    releaseSave()
  }
  await Promise.all([firstMove, secondMove])
  await h.server.idle()
  const after = h.server.repository.get(players.roomId)!.room
  assert.deepEqual(after.players.map(player => player.seatIndex), [3, 4])
  assert.deepEqual((h.store.value as SavedGamesFixture).rooms[0]!.room.players.map(player => player.seatIndex), [3, 4])
})

test('request queue saturation cannot drop disconnect cleanup or leave an offline game running', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  let releaseSave!: () => void
  let signalSaveStarted!: () => void
  h.store.saveGate = new Promise<void>(resolve => { releaseSave = resolve })
  const saveStarted = new Promise<void>(resolve => { signalSaveStarted = resolve })
  h.store.onSaveStarted = signalSaveStarted
  players.host.socket.emit('set_seat', { seatIndex: 3 })
  await saveStarted
  try {
    // One blocked write plus ten connections fills the per-socket/global caps.
    for (let index = 0; index < 10; index++) {
      const noisy = await peer(h)
      const after = noisy.mark()
      for (let action = 0; action < 21; action++) noisy.socket.emit('set_seat', { seatIndex: 4 })
      await noisy.wait<{ message: string }>('error', error => /too many pending/i.test(error.message), after)
    }
    const serverSockets = [players.host, players.guest].map(client => h.server.io.sockets.sockets.get(client.socket.id!)!)
    assert.ok(serverSockets.every(Boolean))
    const disconnections = serverSockets.map(socket => new Promise<void>(resolve => socket.once('disconnect', () => resolve())))
    players.host.socket.disconnect()
    players.guest.socket.disconnect()
    await Promise.all(disconnections)
  } finally {
    h.store.onSaveStarted = null
    h.store.saveGate = null
    releaseSave()
  }
  await h.server.idle()
  const saved = h.server.repository.get(players.roomId)!
  assert.ok(saved.room.players.every(player => player.connected === false))
  assert.ok(saved.paused)
  assert.equal(saved.room.turnDeadline, null)
  assert.equal(saved.room.players[0]!.seatIndex, 3)
  assert.ok((h.store.value as SavedGamesFixture).rooms[0]!.room.players.every(player => player.connected === false))
})

test('an ambiguous save acknowledgement stops play and restart trusts the durable committed value', async t => {
  const first = await harness(t)
  const players = await twoPlayers(first)
  first.store.failAfterSave = true
  await players.host.request('set_seat', { seatIndex: 3 }, 'error')
  await first.server.idle()
  assert.equal(first.server.repository.failed, true)
  assert.equal(first.server.repository.get(players.roomId)!.room.players[0]!.seatIndex, 0)
  assert.equal((first.store.value as SavedGamesFixture).rooms[0]!.room.players[0]!.seatIndex, 3)
  const crashImage = new MemoryStore(first.store.value)
  const beforeClose = first.store.saveAttempts
  await first.close()
  assert.equal(first.store.saveAttempts, beforeClose)

  const second = await harness(t, crashImage)
  const resumed = await peer(second, credential(players.hostJoined))
  const joined = await resumed.wait<Joined>('joined')
  assert.equal(joined.state.players[0]!.seatIndex, 3)
})

test('expired offline rooms do not consume the new-room capacity permanently', async t => {
  const h = await harness(t)
  const players = await twoPlayers(h)
  const seed = cloneRecord(h.server.repository.get(players.roomId)!)
  for (const player of seed.room.players) player.connected = false
  seed.updatedAt = Date.now() - h.server.repository.retentionMs - 1_000
  h.server.repository.records.clear()
  for (let index = 0; index < 500; index++) {
    const expired = cloneRecord(seed)
    expired.room.roomId = String(1000 + index)
    h.server.repository.records.set(expired.room.roomId, expired)
  }
  assert.equal(h.server.repository.records.size, 500)
  const newcomer = await peer(h)
  const joined = await newcomer.request<Joined>('create', { name: 'New host' }, 'joined')
  assert.equal(h.server.repository.records.size, 1)
  assert.equal(h.server.repository.get(joined.roomId)!.room.players[0]!.name, 'New host')
  assert.equal((h.store.value as SavedGamesFixture).rooms.length, 1)
})

test('startup rejects corrupt room/session snapshots without overwriting existing storage', async t => {
  const existing = await harness(t)
  await twoPlayers(existing)
  const valid = structuredClone(existing.store.value) as SavedGamesFixture
  const corruptions: unknown[] = [
    { version: 2, savedAt: Date.now(), rooms: [] },
    { ...valid, rooms: [{ ...valid.rooms[0]!, sessions: [] }] },
    { ...valid, rooms: [{ ...valid.rooms[0]!, sessions: valid.rooms[0]!.sessions.map(session => ({ ...session, tokenHash: 'not-a-hash' })) }] },
    { ...valid, rooms: [...valid.rooms, valid.rooms[0]] },
    { ...valid, rooms: [{ ...valid.rooms[0]!, room: { ...valid.rooms[0]!.room, phase: 'invalid' } }] },
    { ...valid, rooms: [{ ...valid.rooms[0]!, paused: { turnRemainingMs: -1, discardRemainingMs: null } }] },
  ]
  for (const corruption of corruptions) {
    const store = new MemoryStore(corruption)
    await assert.rejects(createGameServer(store), /snapshot|saved|metadata/i)
    assert.equal(store.saveAttempts, 0)
    assert.deepEqual(store.value, corruption)
  }
  const inaccessible = new MemoryStore(valid)
  inaccessible.failLoad = true
  await assert.rejects(createGameServer(inaccessible), /offline/)
  assert.equal(inaccessible.saveAttempts, 0)
})
