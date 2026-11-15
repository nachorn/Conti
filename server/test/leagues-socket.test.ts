import assert from 'node:assert/strict'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { MembershipService } from '../src/membership.js'
import type { ResumeCredential } from '../src/recovery.js'
import type { SnapshotStore } from '../src/storage.js'

class MemoryStore implements SnapshotStore {
  value: any = null
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value) }
  async close() {}
}

async function harness(t: TestContext) {
  const store = new MemoryStore(), accountStore = new MemoryStore(), inbox = new Map<string, string>()
  const membership = await new MembershipService({ store: accountStore, authSecret: 'league-socket-integration-local-only-secret',
    sendCode: async (email, code) => { inbox.set(email, code) } }).load()
  const server = await createGameServer(store, { membership })
  const url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`
  const sockets: Socket[] = []
  let closed = false
  async function close() { if (!closed) { closed = true; await server.close() } }
  t.after(async () => { for (const socket of sockets) socket.disconnect(); await close(); await membership.close() })
  async function account(email: string) {
    await membership.requestCode(email, 'es', email)
    return membership.verifyCode(email, inbox.get(email)!, email)
  }
  async function api(path: string, token?: string, body?: unknown) {
    const response = await fetch(`${url}/api/leagues${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') }
  }
  async function peer(token?: string, resume?: ResumeCredential) {
    const socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: { membershipToken: token, ...(resume ? { resume } : {}) } })
    sockets.push(socket)
    const updates: { state?: any; league?: any } = {}
    socket.on('state', state => { updates.state = state })
    socket.on('league_state', state => { updates.league = state })
    const connected = once(socket, 'connect', { signal: AbortSignal.timeout(3000) })
    const resumed = resume ? once(socket, 'joined', { signal: AbortSignal.timeout(3000) }) : null
    socket.connect(); await connected
    if (resumed) await resumed
    return { socket, updates }
  }
  async function enter(socket: Socket, event: 'create' | 'join', payload: unknown) {
    const joined = once(socket, 'joined', { signal: AbortSignal.timeout(3000) })
    socket.emit(event, payload)
    return (await joined)[0] as { roomId: string; playerId: string; resumeToken: string }
  }
  async function action(socket: Socket, event: string, payload: unknown, expected = true) {
    const result = await socket.timeout(3000).emitWithAck(event, payload)
    assert.equal(result.ok, expected, JSON.stringify(result))
    return result
  }
  return { server, store, membership, url, close, account, api, peer, enter, action }
}

const settings = { mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1 }
async function finish(h: Awaited<ReturnType<typeof harness>>, roomId: string, players: Map<string, Socket>) {
  for (let i = 0; i < 2; i++) {
    const state = h.server.repository.get(roomId)!.room.pocha!
    await h.action(players.get(state.players[state.currentPlayerIndex].id)!, 'pocha_action', { type: 'bid', value: 1 })
  }
  for (let i = 0; i < 2; i++) {
    const state = h.server.repository.get(roomId)!.room.pocha!, player = state.players[state.currentPlayerIndex]
    await h.action(players.get(player.id)!, 'pocha_action', { type: 'play', cardId: player.hand[0].id })
  }
  assert.equal(h.server.repository.get(roomId)!.room.phase, 'game_end')
}

test('league selection uses the host and verified members; one real game survives concurrent joins, refresh and shutdown', async t => {
  const h = await harness(t)
  const a = await h.account('ana@league.example'), b = await h.account('bea@league.example'), c = await h.account('carla@league.example')
  const league = (await h.api('', a.token, { name: 'Familia Pocha', gameType: 'pocha', minGames: 1 })).body
  assert.equal((await h.api(`/${league.id}`, c.token)).status, 404)
  assert.equal((await h.api('')).status, 401)
  const host = await h.peer(a.token), guest = await h.peer()
  const hj = await h.enter(host.socket, 'create', { gameType: 'pocha', name: 'Ana' })
  const gj = await h.enter(guest.socket, 'join', { roomId: hj.roomId, name: 'Bea' })
  await h.action(host.socket, 'set_league', { leagueId: league.id })
  await h.action(guest.socket, 'set_league', { leagueId: null }, false)
  assert.equal((await h.action(host.socket, 'start', { pochaSettings: settings }, false)).code, 'league_members_only')
  assert.equal(h.server.repository.get(hj.roomId)!.room.phase, 'lobby')
  await h.action(guest.socket, 'membership_auth', { token: b.token })
  assert.equal((await h.action(host.socket, 'start', { pochaSettings: settings }, false)).code, 'league_members_only')
  assert.equal((await h.api('/join', b.token, { code: league.inviteCode })).status, 200)
  await h.action(guest.socket, 'membership_auth', { token: a.token })
  assert.equal((await h.action(host.socket, 'start', { pochaSettings: settings }, false)).code, 'league_duplicate_account')
  await h.action(guest.socket, 'membership_auth', { token: b.token })
  await h.action(host.socket, 'start', { pochaSettings: settings })
  assert.equal(h.server.repository.get(hj.roomId)!.match?.leagueId, league.id)
  await h.action(host.socket, 'set_league', { leagueId: null }, false)
  // Account changes after the first deal cannot transfer a result to another member.
  await h.action(guest.socket, 'membership_auth', { token: c.token })
  await Promise.all([
    finish(h, hj.roomId, new Map([[hj.playerId, host.socket], [gj.playerId, guest.socket]])),
    h.api('/join', c.token, { code: league.inviteCode }).then(result => assert.equal(result.status, 200)),
  ])
  const response = await h.api(`/${league.id}`, a.token), detail = response.body
  assert.equal(response.cache, 'no-store')
  assert.equal(detail.gameCount, 1)
  assert.equal(detail.memberCount, 3)
  assert.deepEqual(detail.standings.map((r: any) => r.played).sort(), [0, 1, 1])
  assert.equal(detail.standings.reduce((n: number, r: any) => n + r.wins, 0), 1)
  assert.equal(detail.standings.find((r: any) => r.provisional)?.rank, null)
  assert.equal((await h.api(`/${league.id}`, c.token)).body.standings.find((r: any) => r.isMe).played, 0)
  for (const secret of [a.account.id, b.account.id, c.account.id, a.account.email, b.account.email, a.token]) {
    assert(!JSON.stringify(detail).includes(secret))
    assert(!JSON.stringify(host.updates.state).includes(secret))
    assert(!JSON.stringify(host.updates.league).includes(secret))
  }
  assert(!JSON.stringify(host.updates.league).includes(league.inviteCode))
  assert.equal(host.updates.league.league.id, league.id)
  const rejoined = await h.peer(a.token, { roomId: hj.roomId, playerId: hj.playerId, token: hj.resumeToken })
  await h.action(rejoined.socket, 'chat_send', { clientId: 'league-finished', text: 'Buena partida' })
  assert.equal((await h.api(`/${league.id}`, a.token)).body.gameCount, 1)
  await h.close()
  const recovered = await createGameServer(h.store, { membership: h.membership })
  try {
    assert.equal(recovered.repository.getLeagueDetail(league.id, a.account.id)!.gameCount, 1)
    assert.equal(recovered.repository.getPersonalStats(b.account.id).overall.played, 1)
    assert.equal(h.store.value.version, 3)
  } finally { await recovered.close() }
})

test('closing a league permits the running match to finish and Pocha rematch can return to a friendly lobby', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const h = await harness(t), a = await h.account('owner@closed.example'), b = await h.account('member@closed.example')
  const league = (await h.api('', a.token, { name: 'Domingo', gameType: 'pocha' })).body
  await h.api('/join', b.token, { code: league.inviteCode })
  const host = await h.peer(a.token), guest = await h.peer(b.token)
  const hj = await h.enter(host.socket, 'create', { gameType: 'pocha', name: 'Owner' })
  const gj = await h.enter(guest.socket, 'join', { roomId: hj.roomId, name: 'Member' })
  await h.action(host.socket, 'set_league', { leagueId: league.id })
  await h.action(host.socket, 'start', { pochaSettings: settings })
  assert.equal((await h.api(`/${league.id}/close`, b.token, {})).status, 403)
  assert.equal((await h.api(`/${league.id}/close`, a.token, {})).status, 200)
  await finish(h, hj.roomId, new Map([[hj.playerId, host.socket], [gj.playerId, guest.socket]]))
  assert.equal((await h.api(`/${league.id}`, a.token)).body.gameCount, 1)
  t.mock.timers.tick(4100)
  await h.action(host.socket, 'rematch', {})
  assert.equal(h.server.repository.get(hj.roomId)!.room.phase, 'lobby')
  assert.equal((await h.action(host.socket, 'start', {}, false)).code, 'league_closed')
  await h.action(host.socket, 'set_league', { leagueId: null })
  await h.action(host.socket, 'start', { pochaSettings: settings })
  await finish(h, hj.roomId, new Map([[hj.playerId, host.socket], [gj.playerId, guest.socket]]))
  assert.equal((await h.api(`/${league.id}`, a.token)).body.gameCount, 1)
  assert.equal(h.server.repository.getPersonalStats(a.account.id).overall.played, 2)
})

test('Continental refuses the wrong league and revalidates a direct rematch before dealing', async t => {
  const h = await harness(t), a = await h.account('owner@conti.example'), b = await h.account('member@conti.example')
  const league = (await h.api('', a.token, { name: 'Conti', gameType: 'continental' })).body
  const wrong = (await h.api('', a.token, { name: 'Pocha', gameType: 'pocha' })).body
  await h.api('/join', b.token, { code: league.inviteCode })
  const host = await h.peer(a.token), guest = await h.peer(b.token)
  const hj = await h.enter(host.socket, 'create', { gameType: 'continental', name: 'Owner' })
  await h.enter(guest.socket, 'join', { roomId: hj.roomId, name: 'Member' })
  assert.equal((await h.action(host.socket, 'set_league', { leagueId: wrong.id }, false)).code, 'league_wrong_game')
  await h.action(host.socket, 'set_league', { leagueId: league.id })
  await h.action(host.socket, 'start', {})
  // A synthetic end is deliberately incomplete and must never generate a result;
  // this isolates the direct-rematch guard without playing seven unrelated rounds.
  const room = h.server.repository.get(hj.roomId)!.room
  room.phase = 'game_end'
  await h.action(guest.socket, 'membership_auth', { token: null })
  assert.equal((await h.action(host.socket, 'rematch', {}, false)).code, 'league_members_only')
  assert.equal(room.phase, 'game_end')
  assert.equal((await h.api(`/${league.id}`, a.token)).body.gameCount, 0)
  await h.action(guest.socket, 'membership_auth', { token: b.token })
  await h.api(`/${league.id}/close`, a.token, {})
  assert.equal((await h.action(host.socket, 'rematch', {}, false)).code, 'league_closed')
  assert.equal(h.server.repository.get(hj.roomId)!.room.phase, 'game_end')
  await h.action(host.socket, 'set_league', { leagueId: null })
  await h.action(host.socket, 'rematch', {})
  assert.equal(h.server.repository.get(hj.roomId)!.room.phase, 'playing')
  assert.equal(h.server.repository.get(hj.roomId)!.match?.leagueId, undefined)
  assert.equal((await h.api(`/${league.id}`, a.token)).body.gameCount, 0)
})
