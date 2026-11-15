import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { MembershipService } from '../src/membership.js'
import { type ResumeCredential } from '../src/recovery.js'
import type { SnapshotStore } from '../src/storage.js'

class MemoryStore implements SnapshotStore {
  value: any = null
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value) }
  async close() {}
}

async function harness(t: TestContext) {
  const gameStore = new MemoryStore(), accountStore = new MemoryStore()
  const inbox = new Map<string, string>()
  const membership = await new MembershipService({ store: accountStore,
    authSecret: 'personal-stats-integration-test-secret-only',
    sendCode: async (email, code) => { inbox.set(email, code) },
  }).load()
  const server = await createGameServer(gameStore, { membership })
  const url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`
  const sockets: Socket[] = []
  let serverClosed = false
  async function closeServer() { if (!serverClosed) { serverClosed = true; await server.close() } }
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await closeServer(); await membership.close() })
  async function account(email: string) {
    await membership.requestCode(email, 'es', email)
    return membership.verifyCode(email, inbox.get(email)!, email)
  }
  async function peer(token?: string, resume?: ResumeCredential) {
    const socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'],
      auth: { membershipToken: token, ...(resume ? { resume } : {}) } })
    sockets.push(socket)
    const connected = once(socket, 'connect', { signal: AbortSignal.timeout(3000) })
    const joined = resume ? once(socket, 'joined', { signal: AbortSignal.timeout(3000) }) : null
    socket.connect(); await connected
    if (joined) await joined
    return socket
  }
  async function enter(socket: Socket, event: 'create' | 'join', payload: unknown) {
    const joined = once(socket, 'joined', { signal: AbortSignal.timeout(3000) })
    socket.emit(event, payload)
    return (await joined)[0] as { roomId: string; playerId: string; resumeToken: string }
  }
  async function action(socket: Socket, event: string, payload: unknown) {
    const response = await socket.timeout(3000).emitWithAck(event, payload)
    assert.equal(response.ok, true, JSON.stringify(response))
  }
  async function stats(token?: string, extra = '') {
    const response = await fetch(`${url}/api/membership/stats${extra}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') }
  }
  return { server, membership, gameStore, account, peer, enter, action, stats, closeServer }
}

const settings = { mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1 }
async function finishOneCard(h: Awaited<ReturnType<typeof harness>>, roomId: string, peers: Map<string, Socket>) {
  for (let index = 0; index < 2; index++) {
    const state = h.server.repository.get(roomId)!.room.pocha!
    await h.action(peers.get(state.players[state.currentPlayerIndex].id)!, 'pocha_action', { type: 'bid', value: 1 })
  }
  for (let index = 0; index < 2; index++) {
    const state = h.server.repository.get(roomId)!.room.pocha!
    const player = state.players[state.currentPlayerIndex]
    await h.action(peers.get(player.id)!, 'pocha_action', { type: 'play', cardId: player.hand[0].id })
  }
  assert.equal(h.server.repository.get(roomId)!.room.phase, 'game_end')
}

test('authenticated socket seats earn one private result per completed game, across refresh, rematch and shutdown', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const h = await harness(t)
  const a = await h.account('ana@stats.example'), b = await h.account('luis@stats.example')
  const outsider = await h.account('other@stats.example')
  const host = await h.peer(a.token), guest = await h.peer(b.token)
  const hj = await h.enter(host, 'create', { gameType: 'pocha', name: 'Ana' })
  const gj = await h.enter(guest, 'join', { roomId: hj.roomId, name: 'Luis' })
  const peers = new Map([[hj.playerId, host], [gj.playerId, guest]])
  await h.action(host, 'start', { pochaSettings: settings, accountId: outsider.account.id })
  await finishOneCard(h, hj.roomId, peers)
  const first = (await h.stats(a.token)).body
  const second = (await h.stats(b.token)).body
  assert.equal(first.overall.played, 1)
  assert.equal(second.overall.played, 1)
  assert.equal(first.overall.wins + second.overall.wins, 1)
  assert.equal(first.overall.losses + second.overall.losses, 1)
  assert.equal(first.byGame.continental.played, 0)
  assert.equal(first.recentGames[0].id, second.recentGames[0].id)
  assert(!JSON.stringify(first).includes(b.account.id))
  assert(!JSON.stringify(first).includes(b.account.email))
  assert(!JSON.stringify(first).includes(a.token))
  assert.equal((await h.stats()).status, 401)
  assert.equal((await h.stats(a.token)).cache, 'no-store')
  assert.equal((await h.stats(outsider.token, `?accountId=${a.account.id}`)).body.overall.played, 0)
  const publicState = h.server.repository.get(hj.roomId)!.room.getState(hj.playerId)
  assert(!JSON.stringify(publicState).includes(a.account.id))
  assert(!JSON.stringify(publicState).includes(a.account.email))
  // Later saves and reconnections cannot turn the same final position into a new victory.
  await h.action(host, 'chat_send', { clientId: 'stats-after-game', text: 'Buena partida' })
  const renewed = await h.peer(a.token, { roomId: hj.roomId, playerId: hj.playerId, token: hj.resumeToken })
  peers.set(hj.playerId, renewed)
  assert.equal((await h.stats(a.token)).body.overall.played, 1)
  t.mock.timers.tick(4100)
  await h.action(renewed, 'rematch', {})
  await h.action(renewed, 'start', { pochaSettings: settings })
  await finishOneCard(h, hj.roomId, peers)
  assert.equal((await h.stats(a.token)).body.overall.played, 2)
  const ids = (await h.stats(a.token)).body.recentGames.map((game: any) => game.id)
  assert.equal(new Set(ids).size, 2)
  await h.closeServer()
  const recovered = await createGameServer(h.gameStore, { membership: h.membership })
  try { assert.equal(recovered.repository.getPersonalStats(a.account.id).overall.played, 2) }
  finally { await recovered.close() }
})

test('signing in or changing accounts after the deal cannot transfer a recorded result', async t => {
  const h = await harness(t)
  const a = await h.account('original@stats.example'), b = await h.account('later@stats.example')
  const host = await h.peer(a.token), guest = await h.peer()
  const hj = await h.enter(host, 'create', { gameType: 'pocha', name: 'Original' })
  const gj = await h.enter(guest, 'join', { roomId: hj.roomId, name: 'Guest' })
  await h.action(host, 'start', { pochaSettings: settings })
  await h.action(host, 'membership_auth', { token: b.token })
  await h.action(guest, 'membership_auth', { token: b.token })
  await finishOneCard(h, hj.roomId, new Map([[hj.playerId, host], [gj.playerId, guest]]))
  assert.equal((await h.stats(a.token)).body.overall.played, 1)
  assert.equal((await h.stats(b.token)).body.overall.played, 0)
})

test('the same account in multiple seats cannot farm personal victories', async t => {
  const h = await harness(t)
  const a = await h.account('same@stats.example')
  const host = await h.peer(a.token), guest = await h.peer(a.token)
  const hj = await h.enter(host, 'create', { gameType: 'pocha', name: 'One' })
  const gj = await h.enter(guest, 'join', { roomId: hj.roomId, name: 'Two' })
  await h.action(host, 'start', { pochaSettings: settings })
  await finishOneCard(h, hj.roomId, new Map([[hj.playerId, host], [gj.playerId, guest]]))
  assert.equal((await h.stats(a.token)).body.overall.played, 0)
})
