import assert from 'node:assert/strict'
import { once } from 'node:events'
import test from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { pochaBotAction } from '../src/testBot.js'
import { createPochaHandState, applyPochaAction, publicPochaState } from '../src/game/pocha/pochaEngine.js'
import { authenticate, cloneRecord, GameRepository, issueCredential } from '../src/recovery.js'
import type { PochaDeckSize } from '../src/game/pocha/pochaTypes.js'

const KEY = 'private-local-bot-tests-key-32-characters'
const ORIGIN = 'https://conti.example'

test('test players complete legal Pocha hands using only their private view across decks, seats and both modes', () => {
  let hands = 0
  for (const deck of [32, 36, 40, 48] as PochaDeckSize[]) for (const count of [2, 3, 7, 10]) {
    for (const mode of ['normal', 'subastada'] as const) for (const cards of [1, Math.floor(deck / count)]) {
      const players = Array.from({ length: count }, (_, index) => ({ id: 'p' + index, name: 'Bot ' + index, seatIndex: index, score: 0, connected: true }))
      const state = createPochaHandState('1234', players, cards, 0, deck, { mode, maxCards: cards, oneCardRounds: 1, peakRounds: 1 })
      let steps = 0
      while (state.phase !== 'hand_end' && state.phase !== 'game_end') {
        assert.ok(++steps < 1000)
        const id = state.players[state.currentPlayerIndex]!.id
        const view = publicPochaState(state, id)
        assert.ok(view.players.filter(player => player.id !== id).every(player => player.hand.every(card => card.id === 'hidden')))
        const action = pochaBotAction(view, id)
        assert.ok(action)
        if (action.type === 'play') assert.ok(view.legalCardIds?.includes(action.cardId))
        assert.deepEqual(applyPochaAction(state, id, action, Math.max(Date.now(), (state.trickReviewUntil ?? 0) + 1)), { ok: true })
      }
      hands++
    }
  }
  assert.equal(hands, 64)
})

test('only the owner can add one bot; it plays, pauses with the human, survives recovery, and disappears when the host leaves', async t => {
  let snapshot: unknown = null
  const store = { async load() { return structuredClone(snapshot) }, async save(value: unknown) { snapshot = structuredClone(value) }, async close() {} }
  const server = await createGameServer(store, { dashboardKey: KEY, origins: [ORIGIN], turnstile: { siteKey: 'local-test-site-key', async verify(token) { return token === 'valid-human-proof' } } })
  const url = `http://127.0.0.1:${await server.listen(0, '127.0.0.1')}`
  const sockets: Socket[] = []
  t.after(async () => { sockets.forEach(socket => socket.disconnect()); await server.close() })
  const connect = async (resume?: unknown) => {
    const socket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'], auth: resume ? { resume } : {} })
    sockets.push(socket)
    const connected = once(socket, 'connect', { signal: AbortSignal.timeout(2000) })
    const joined = resume ? once(socket, 'joined', { signal: AbortSignal.timeout(2000) }) : null
    socket.connect(); await connected
    if (joined) await joined
    return socket
  }
  const host = await connect()
  const joined = once(host, 'joined', { signal: AbortSignal.timeout(2000) })
  host.emit('create', { gameType: 'pocha', name: 'Human', turnstileToken: 'valid-human-proof' })
  const seat = (await joined)[0]
  const endpoint = url + `/api/admin/rooms/${seat.roomId}/test-bot`
  const headers = { authorization: 'Bearer ' + KEY, 'x-admin-request': '1', origin: ORIGIN }
  for (const [override, status] of [[{ authorization: '' }, 401], [{ 'x-admin-request': '' }, 403], [{ origin: 'https://attacker.example' }, 403]] as const) {
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, ...override } })).status, status)
    assert.equal(server.repository.get(seat.roomId)!.room.players.length, 1)
  }
  const response = await fetch(endpoint, { method: 'POST', headers })
  assert.equal(response.status, 200)
  const bot = await response.json() as { playerId: string }
  assert.equal('token' in bot, false)
  const duplicate = await fetch(endpoint, { method: 'POST', headers })
  assert.equal((await duplicate.json() as { playerId: string }).playerId, bot.playerId)
  assert.equal(server.repository.get(seat.roomId)!.room.players.length, 2)
  const wrong = await connect()
  const denied = await wrong.timeout(2000).emitWithAck('join', { roomId: seat.roomId, name: 'Unverified' })
  assert.equal(denied.code, 'verification_failed', 'a bot must not disable Turnstile for human entries')
  assert.equal((await host.timeout(2000).emitWithAck('start', { pochaSettings: { mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1 } })).ok, true)
  const moved = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('bot did not bid')), 3000)
    const check = (state: any) => { if (state.pocha.bids[bot.playerId] !== undefined) { clearTimeout(timer); host.off('state', check); resolve() } }
    host.on('state', check)
  })
  const initial = server.repository.get(seat.roomId)!.room.getState(seat.playerId).pocha!
  const humanMove = pochaBotAction(initial, seat.playerId)
  if (humanMove) assert.equal((await host.timeout(2000).emitWithAck('pocha_action', humanMove)).ok, true)
  await moved
  assert.equal((await fetch(endpoint, { method: 'POST', headers })).status, 409)
  host.disconnect()
  await new Promise(resolve => setTimeout(resolve, 50))
  await server.idle()
  const paused = server.repository.get(seat.roomId)!
  assert.ok(paused.paused)
  assert.ok(paused.room.players.every(player => !player.connected))
  const restoredRepository = new GameRepository(store)
  await restoredRepository.load()
  assert.equal(restoredRepository.get(seat.roomId)!.sessions.find(session => session.playerId === bot.playerId)?.bot, true)
  const issued = issueCredential(seat.roomId)
  const restricted = cloneRecord(paused)
  restricted.sessions[0] = { ...issued.session, bot: true }
  assert.equal(authenticate(restricted, issued.credential), false, 'a server bot cannot be taken over through browser recovery')
  const restored = await connect({ roomId: seat.roomId, playerId: seat.playerId, token: seat.resumeToken })
  assert.ok(server.repository.get(seat.roomId)!.room.players.every(player => player.connected))
  const left = once(restored, 'left', { signal: AbortSignal.timeout(2000) })
  restored.emit('leave'); await left
  assert.equal(server.repository.get(seat.roomId), undefined)
})
