import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { AdGate, MAX_AD_ATTEMPT_MS, MIN_AD_ATTEMPT_MS, type AdConfig, type AdGateState } from '../src/adGate.js'
import { createGameServer } from '../src/app.js'
import { cloneRecord } from '../src/recovery.js'
import type { MembershipService } from '../src/membership.js'
import type { SnapshotStore } from '../src/storage.js'
import type { MembershipAccount } from '../../shared/membership.js'
import type { AdGateState as SharedGate } from '../../shared/adGate.js'
import { publicPochaState } from '../src/game/pocha/pochaEngine.js'

const configured: AdConfig = { provider: 'google-h5', publisherId: 'ca-pub-1234567890123456' }
const fixture = (roomId = '1234') => ({ roomId, phase: 'lobby' as const, players: [{ id: 'host', connected: true }, { id: 'guest', connected: true }] })

test('unconfigured ads preserve play; completed breaks require every connected seat', () => {
  const room = fixture()
  for (const config of [undefined, { provider: 'google-h5', publisherId: null }, { provider: 'google-h5', publisherId: 'not-a-publisher' }] as (AdConfig | undefined)[]) {
    const gate = new AdGate(config)
    assert.equal(gate.snapshot(room, false).required, false)
    assert.equal(gate.snapshot(room, false).canStart, true)
    assert.equal(gate.begin(room, 'host', false).ok, false)
  }
  let now = 1000
  const gate = new AdGate(configured, () => now)
  const state: SharedGate = gate.snapshot(room, false)
  assert.equal(state.canStart, false)
  assert.equal(state.publisherId, configured.publisherId)
  const host = gate.begin(room, 'host', false)
  const guest = gate.begin(room, 'guest', false)
  now += MIN_AD_ATTEMPT_MS
  assert.equal(gate.complete(room, 'host', { attemptId: host.attemptId, outcome: 'viewed' }, false).ok, true)
  assert.equal(gate.snapshot(room, false).canStart, false)
  assert.equal(gate.complete(room, 'guest', { attemptId: guest.attemptId, outcome: 'dismissed' }, false).ok, true)
  assert.equal(gate.snapshot(room, false).canStart, true)
  room.players[1]!.connected = false
  assert.equal(gate.snapshot(room, false).canStart, false)
  assert.equal(gate.snapshot(room, true).canStart, true)
  room.players[1]!.connected = true
  room.players.push({ id: 'newcomer', connected: true })
  assert.equal(gate.snapshot(room, false).canStart, false)
  assert.equal(gate.snapshot(room, false).players[0]!.status, 'ready')
  gate.consume(room.roomId)
  assert.notEqual(gate.snapshot(room, false).cycle, state.cycle)
  assert.ok(gate.snapshot(room, false).players.every(player => player.status === 'pending'))
  assert.equal(gate.snapshot({ ...room, phase: 'playing' }, false).required, false)
  assert.equal(gate.snapshot({ ...room, phase: 'round_end' }, false).required, false)
})

test('ad attempts are private, one-use, age-bounded and scoped to room, cycle and seat', () => {
  let now = 1000
  const gate = new AdGate(configured, () => now)
  const room = fixture()
  const attempt = gate.begin(room, 'host', false)
  assert.equal(gate.begin(room, 'host', false).code, 'ad_in_progress')
  assert.equal(JSON.stringify(gate.snapshot(room, false)).includes(attempt.attemptId!), false)
  assert.equal(gate.complete(room, 'guest', { attemptId: attempt.attemptId, outcome: 'viewed' }, false).ok, false)
  assert.equal(gate.complete(fixture('9999'), 'host', { attemptId: attempt.attemptId, outcome: 'viewed' }, false).ok, false)
  assert.equal(gate.complete(room, 'host', { attemptId: attempt.attemptId, outcome: 'viewed' }, false).ok, false)
  now += MIN_AD_ATTEMPT_MS
  assert.equal(gate.complete(room, 'host', { attemptId: attempt.attemptId, outcome: 'viewed' }, false).ok, false)
  for (const outcome of ['unavailable', 'error', 'made-up']) {
    const next = gate.begin(room, 'host', false)
    now += MIN_AD_ATTEMPT_MS
    assert.equal(gate.complete(room, 'host', { attemptId: next.attemptId, outcome }, false).ok, false)
    assert.equal(gate.snapshot(room, false).players[0]!.status, 'pending')
    assert.equal(gate.complete(room, 'host', { attemptId: next.attemptId, outcome: 'viewed' }, false).ok, false)
  }
  const expired = gate.begin(room, 'host', false)
  now += MAX_AD_ATTEMPT_MS + 1
  assert.equal(gate.complete(room, 'host', { attemptId: expired.attemptId, outcome: 'viewed' }, false).ok, false)
  const interrupted = gate.begin(room, 'host', false)
  gate.interrupt(room.roomId, 'host')
  assert.equal(gate.snapshot(room, false).players[0]!.status, 'pending')
  assert.equal(gate.complete(room, 'host', { attemptId: interrupted.attemptId, outcome: 'viewed' }, false).ok, false)
  const previousCycle = gate.begin(room, 'host', false)
  gate.consume(room.roomId)
  now += MIN_AD_ATTEMPT_MS
  assert.equal(gate.complete(room, 'host', { attemptId: previousCycle.attemptId, outcome: 'viewed' }, false).ok, false)
})

class MemoryStore implements SnapshotStore {
  value: unknown = null
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value) }
  async close() {}
}
class FakeMembership {
  accounts = new Map<string, MembershipAccount>()
  healthy = true
  listeners = new Set<() => void>()
  authenticate(token: string) { return this.accounts.get(token) ?? null }
  registerRoutes() {}
  isHealthy() { return this.healthy }
  onChange(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  changed() { for (const listener of this.listeners) listener() }
  grant(token: string, source: 'gift' | 'purchase') {
    this.accounts.set(token, { id: `account-${token}`, email: `${token}@example.test`, adFree: true, source, expiresAt: null })
  }
}
type Joined = { roomId: string; playerId: string; resumeToken: string }
type Ack = { ok: boolean; code?: string; error?: string; attemptId?: string; account?: MembershipAccount | null }
class Peer {
  socket: Socket
  received: { event: string; value: any }[] = []
  private events = new EventEmitter()
  constructor(url: string, auth: object = {}) {
    this.socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth })
    this.socket.onAny((event, value) => { this.received.push({ event, value }); this.events.emit('received') })
  }
  wait<T>(event: string, predicate: (value: T) => boolean = () => true, after = 0): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.received.slice(after).find(item => item.event === event && predicate(item.value))
        if (found) { clearTimeout(timer); this.events.off('received', check); resolve(found.value) }
      }
      const timer = setTimeout(() => { this.events.off('received', check); reject(new Error(`Missing ${event}`)) }, 3000)
      this.events.on('received', check); check()
    })
  }
  async connect() {
    const connected = new Promise<void>((resolve, reject) => { this.socket.once('connect', resolve); this.socket.once('connect_error', reject) })
    this.socket.connect(); await connected; return this
  }
  ack(event: string, payload: unknown = {}): Promise<Ack> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Missing ${event} acknowledgement`)), 3000)
      this.socket.emit(event, payload, (value: Ack) => { clearTimeout(timer); resolve(value) })
    })
  }
  send<T>(event: string, payload: unknown, response: string) {
    const after = this.received.length
    this.socket.emit(event, payload)
    return this.wait<T>(response, () => true, after)
  }
}
async function harness(t: TestContext, config: AdConfig | undefined = configured) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const membership = new FakeMembership()
  const store = new MemoryStore()
  const server = await createGameServer(store, { adConfig: config, membership: membership as unknown as MembershipService })
  const port = await server.listen(0, '127.0.0.1')
  const peers: Peer[] = []
  t.after(async () => { await server.close(); peers.forEach(peer => peer.socket.disconnect()) })
  const peer = async (auth?: object) => { const p = new Peer(`http://127.0.0.1:${port}`, auth); peers.push(p); return p.connect() }
  const players = async (gameType = 'continental', guestToken?: string) => {
    const host = await peer()
    const hostJoined = await host.send<Joined>('create', { name: 'Host', gameType, discardOptionDelaySeconds: 0 }, 'joined')
    const guest = await peer(guestToken ? { membershipToken: guestToken } : undefined)
    const guestJoined = await guest.send<Joined>('join', { name: 'Guest', roomId: hostJoined.roomId }, 'joined')
    return { host, guest, hostJoined, guestJoined, roomId: hostJoined.roomId }
  }
  const watch = async (...viewers: Peer[]) => {
    const attempts = await Promise.all(viewers.map(p => p.ack('ad_begin')))
    attempts.forEach(result => assert.ok(result.attemptId))
    t.mock.timers.tick(MIN_AD_ATTEMPT_MS)
    for (const [index, viewer] of viewers.entries()) assert.equal((await viewer.ack('ad_complete', { attemptId: attempts[index]!.attemptId, outcome: 'viewed' })).ok, true)
  }
  const disconnect = async (p: Peer) => {
    const socket = server.io.sockets.sockets.get(p.socket.id!)!
    const done = new Promise<void>(resolve => socket.once('disconnect', resolve))
    p.socket.disconnect(); await done; await server.idle()
  }
  const finish = async (roomId: string) => {
    const next = cloneRecord(server.repository.get(roomId)!)
    next.room.round = 7; next.room.startRound(0); next.room.endRound(next.room.players[0]!.id, false)
    await server.repository.commit(roomId, next)
  }
  return { server, membership, peer, players, watch, disconnect, finish, store }
}
const resume = (seat: Joined) => ({ resume: { roomId: seat.roomId, playerId: seat.playerId, token: seat.resumeToken } })

test('socket start cannot bypass incomplete seats; reconnect preserves readiness and a newcomer must watch', async t => {
  const h = await harness(t)
  const p = await h.players()
  assert.equal((await p.host.ack('start', { adFree: true, watchedAd: true })).code, 'ad_pending')
  assert.equal((await p.host.ack('ad_complete', { attemptId: 'guessed', outcome: 'viewed' })).ok, false)
  await h.watch(p.host, p.guest)
  await h.disconnect(p.guest)
  assert.equal((await p.host.ack('start')).code, 'ad_pending')
  const guest = await h.peer(resume(p.guestJoined))
  await guest.wait('joined')
  const ready = await guest.wait<AdGateState>('ad_gate', gate => gate.canStart)
  assert.equal(ready.players.find(player => player.playerId === p.guestJoined.playerId)!.status, 'ready')
  const newcomer = await h.peer()
  await newcomer.send('join', { roomId: p.roomId, name: 'Newcomer' }, 'joined')
  assert.equal((await p.host.ack('start')).code, 'ad_pending')
  await newcomer.send('leave', {}, 'left')
  assert.equal((await p.host.ack('start')).ok, true)
  await h.disconnect(guest)
  const playingGuest = await h.peer(resume(p.guestJoined))
  const playing = await playingGuest.wait<AdGateState>('ad_gate', gate => gate.phase === 'playing')
  assert.equal(playing.required, false)
  assert.equal((await playingGuest.ack('ad_begin')).code, 'ad_not_required')
  await h.finish(p.roomId)
  assert.equal((await p.host.ack('rematch')).code, 'ad_pending')
  await h.watch(p.host, playingGuest)
  assert.equal((await p.host.ack('rematch')).ok, true)
})

test('purchase or owner gift on any current seat waives the table; revocation, logout and expiry cannot be bypassed', async t => {
  const h = await harness(t)
  for (const source of ['purchase', 'gift'] as const) {
    h.membership.grant(source, source)
    const p = await h.players('continental', source)
    const gate = await p.host.wait<AdGateState>('ad_gate', gate => gate.exempt)
    assert.equal(gate.canStart, true)
    assert.equal(JSON.stringify(gate).includes('@example.test'), false)
    assert.equal(JSON.stringify(gate).includes('account-'), false)
    assert.equal((await p.host.ack('start')).ok, true)
    await h.finish(p.roomId)
    h.membership.accounts.delete(source)
    h.membership.changed()
    await h.server.idle()
    assert.equal((await p.host.ack('rematch')).code, 'ad_pending')
    h.membership.grant(source, source)
    assert.equal((await p.guest.ack('membership_auth', { token: source })).account?.source, source)
    assert.equal((await p.host.ack('rematch')).ok, true)
  }
  h.membership.grant('active', 'gift')
  const p = await h.players('continental', 'active')
  assert.equal((await p.guest.ack('membership_auth', { token: null })).ok, true)
  assert.equal((await p.host.ack('start')).code, 'ad_pending')
  const loggedIn = await p.guest.ack('membership_auth', { token: 'active' })
  assert.equal(loggedIn.ok, true)
  assert.equal(h.server.repository.get(p.roomId)!.room.players.length, 2)
  // Simulates a session expiring between the UI's exemption and the start request.
  h.membership.accounts.delete('active')
  assert.equal((await p.host.ack('start')).code, 'ad_pending')
  h.membership.grant('active', 'gift')
  await p.guest.ack('membership_auth', { token: 'active' })
  h.membership.healthy = false
  assert.equal((await p.host.ack('start')).code, 'ad_pending')
  h.membership.healthy = true
  await h.disconnect(p.guest)
  assert.equal((await p.host.ack('start')).code, 'ad_pending')
})

test('no-fill does not become a view, interruption retries, and game snapshots contain no membership or attempt data', async t => {
  const h = await harness(t)
  const p = await h.players()
  const attempt = await p.guest.ack('ad_begin')
  assert.equal((await p.guest.ack('ad_complete', { attemptId: attempt.attemptId, outcome: 'unavailable' })).code, 'ad_unavailable')
  assert.equal((await p.host.ack('start')).code, 'ad_pending')
  const interrupted = await p.guest.ack('ad_begin')
  await h.disconnect(p.guest)
  const guest = await h.peer(resume(p.guestJoined))
  await guest.wait('joined')
  assert.equal((await guest.ack('ad_complete', { attemptId: interrupted.attemptId, outcome: 'viewed' })).ok, false)
  await h.watch(p.host, guest)
  assert.equal((await p.host.ack('start')).ok, true)
  assert.equal(JSON.stringify(h.store.value).includes(attempt.attemptId!), false)
  assert.equal(JSON.stringify(h.store.value).includes('membership'), false)
})

test('Pocha rematch keeps the same completed break through setup; round transitions never charge ads', async t => {
  const h = await harness(t)
  const p = await h.players('pocha')
  await h.watch(p.host, p.guest)
  const settings = { mode: 'normal', maxCards: 1, oneCardRounds: 2, peakRounds: 1 }
  assert.equal((await p.host.ack('start', { pochaSettings: settings })).ok, true)
  // Drive the tiny real game to completion while checking its hand transition.
  for (let actions = 0; h.server.repository.get(p.roomId)!.room.phase !== 'game_end' && actions < 30; actions++) {
    t.mock.timers.tick(4000)
    const room = h.server.repository.get(p.roomId)!.room
    const state = room.pocha!
    if (state.phase === 'hand_end') {
      assert.equal((await p.host.ack('next_round')).ok, true)
      assert.equal((await p.host.ack('ad_begin')).code, 'ad_not_required')
    } else {
      const id = state.players[state.currentPlayerIndex]!.id
      const current = id === p.hostJoined.playerId ? p.host : p.guest
      const action = state.phase === 'bidding'
        ? { type: 'bid', value: publicPochaState(state, id).blockedBid === 0 ? 1 : 0 }
        : { type: 'play', cardId: publicPochaState(state, id).legalCardIds![0] }
      assert.equal((await current.ack('pocha_action', action)).ok, true)
    }
  }
  assert.equal(h.server.repository.get(p.roomId)!.room.phase, 'game_end')
  t.mock.timers.tick(4000)
  assert.equal((await p.host.ack('rematch')).code, 'ad_pending')
  await h.watch(p.host, p.guest)
  assert.equal((await p.host.ack('rematch')).ok, true)
  assert.equal(h.server.repository.get(p.roomId)!.room.phase, 'lobby')
  assert.equal((await p.host.ack('start', { pochaSettings: settings })).ok, true)
})

test('disabled ads leave legacy socket starts and rematches unchanged', async t => {
  const h = await harness(t, { provider: 'disabled', publisherId: null })
  const p = await h.players()
  assert.equal((await p.host.ack('start')).ok, true)
  await h.finish(p.roomId)
  assert.equal((await p.host.ack('rematch')).ok, true)
})
