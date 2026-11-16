import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import express from 'express'
import { Room } from '../src/room.js'
import { cloneRecord, GameRepository, issueCredential, type RoomRecord } from '../src/recovery.js'
import { beginPersonalMatch, finishedPersonalMatch, parseGameResults, parsePersonalMatch, personalStats, registerPersonalStats, type DurableGameResult } from '../src/personalStats.js'
import type { SnapshotStore } from '../src/storage.js'

class MemoryStore implements SnapshotStore {
  value: any = null
  saves = 0
  fail = false
  ambiguous = false
  gate: Promise<void> | null = null
  started: (() => void) | null = null
  async load() { return structuredClone(this.value) }
  async save(value: unknown) {
    this.saves++
    if (this.fail) throw new Error('Local save failure')
    const captured = structuredClone(value)
    this.started?.()
    if (this.gate) await this.gate
    this.value = captured
    if (this.ambiguous) throw new Error('Local lost acknowledgement')
  }
  async close() {}
}

function record(gameType: 'pocha' | 'continental' = 'pocha', n = 2, roomId = '1234'): RoomRecord {
  const room = new Room({ roomId, gameType })
  const sessions = Array.from({ length: n }, (_, i) => {
    const { credential, session } = issueCredential(roomId)
    room.addPlayer(credential.playerId, `Player ${i + 1}`)
    return session
  })
  if (gameType === 'pocha') assert.equal(room.startPochaGame({ mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1 }).ok, true)
  else assert.equal(room.startGame(), true)
  const result: RoomRecord = { room, sessions, updatedAt: Date.now(), paused: null, chat: [] }
  beginPersonalMatch(result, Object.fromEntries(room.players.map((p, i) => [p.id, `account-${i}`])))
  return result
}

function finishPocha(r: RoomRecord) {
  const state = r.room.pocha!
  while (state.phase === 'bidding') {
    // Everyone predicts zero: the one winner misses; every other player hits zero.
    const player = state.players[state.currentPlayerIndex]
    assert.equal(r.room.pochaAction(player.id, { type: 'bid', value: 0 }).ok, true)
  }
  while (state.phase === 'playing') {
    const player = state.players[state.currentPlayerIndex]
    const legal = r.room.getState(player.id).pocha!.legalCardIds!
    assert.equal(r.room.pochaAction(player.id, { type: 'play', cardId: legal[0] }).ok, true)
  }
  assert.equal(r.room.phase, 'game_end')
}

function finishConti(r: RoomRecord) {
  // Exercise the real discard/round scoring path with a closing hand seeded in
  // each round; the remaining players keep their real dealt cards and penalties.
  for (let round = 1; round <= 7; round++) {
    const room = r.room
    room.currentPlayerIndex = 0
    room.discardOptionPlayerIndex = null
    room.discardOptionAvailableAt = null
    room.currentPlayerHasDrawn = true
    const winner = room.players[0]
    winner.hand = [winner.hand[0]]
    assert.deepEqual(room.discard(winner.id, winner.hand[0].id), { ok: true })
    assert.equal(room.roundHistory.length, round)
    if (round < 7) assert.equal(room.nextRound(), true)
  }
  assert.equal(r.room.phase, 'game_end')
}

test('old snapshots keep working and old or incomplete rooms never become personal results', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const r = record()
  delete r.match
  await repo.commit('1234', r)
  assert.equal(store.value.version, 1, 'ordinary legacy rooms keep their original schema')
  assert.equal('results' in store.value, false)
  const loaded = new GameRepository(store)
  await loaded.load()
  assert.equal(loaded.records.get('1234')!.match, undefined)
  finishPocha(r)
  await repo.commit('1234', r)
  assert.equal(repo.getPersonalStats('account-0').overall.played, 0)
  const started = record('pocha', 2, '2345')
  await repo.commit('2345', started)
  assert.equal(store.value.version, 2, 'account-bound match metadata opts into the protected schema')
  assert.equal(repo.getPersonalStats('account-0').overall.played, 0)
})

for (const gameType of ['pocha', 'continental'] as const) test(`${gameType}: a completed game is atomic, durable and counted exactly once across reconnects and retries`, async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const r = record(gameType)
  await repo.commit('1234', r)
  const originalRun = structuredClone(r.match)
  if (gameType === 'pocha') finishPocha(r)
  else finishConti(r)
  let release!: () => void
  store.gate = new Promise<void>(resolve => { release = resolve })
  const began = new Promise<void>(resolve => { store.started = resolve })
  const completed = repo.commit('1234', cloneRecord(r))
  await began
  assert.equal(repo.getPersonalStats('account-0').overall.played, 0, 'pending save is not visible as a win')
  release(); await completed
  assert.equal(store.value.results.length, 1)
  assert.equal(store.value.version, 2, 'older servers must refuse rather than overwrite permanent statistics')
  assert.equal(store.value.rooms[0].room.phase, 'game_end')
  const scores = r.room.players.map(p => p.score)
  const winner = gameType === 'pocha' ? scores.indexOf(Math.max(...scores)) : scores.indexOf(Math.min(...scores))
  assert.equal(repo.getPersonalStats(`account-${winner}`).overall.wins, 1)
  assert.equal(repo.getPersonalStats(`account-${1 - winner}`).overall.losses, 1)
  assert.equal(repo.getPersonalStats(`account-${winner}`).overall.winRate, 100)
  assert.deepEqual(repo.records.get('1234')!.match, originalRun)
  const reconstructed = new GameRepository(store)
  await reconstructed.load()
  await reconstructed.commit('1234', cloneRecord(reconstructed.records.get('1234')!))
  assert.equal(reconstructed.getPersonalStats(`account-${winner}`).overall.played, 1)
  assert.equal(store.value.results.length, 1)
  const personal = reconstructed.getPersonalStats(`account-${winner}`)
  assert.equal(personal.byGame[gameType].played, 1)
  assert.equal(personal.recentGames[0].gameType, gameType)
  assert.equal(personal.recentGames[0].playerCount, 2)
  assert.equal(personal.recentGames[0].position, 1)
  assert.equal(personal.recentGames[0].outcome, 'win')
  const json = JSON.stringify(personal)
  for (const secret of ['accountId', 'playerId', 'email', 'tokenHash', 'hand', 'chat']) assert.equal(json.includes(secret), false)
})

test('completed history survives room deletion, retention, bulk cleanup and graceful shutdown', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store, 100)
  const r = record('continental')
  finishConti(r)
  await repo.commit('1234', r)
  const before = repo.getPersonalStats('account-0')
  await repo.commit('1234', null)
  assert.equal(repo.records.size, 0)
  assert.equal(repo.getPersonalStats('account-0').overall.played, 1)
  await repo.saveShutdown([])
  const restored = new GameRepository(store, 100)
  await restored.load(Date.now() + 500)
  assert.equal(restored.records.size, 0)
  assert.deepEqual(restored.getPersonalStats('account-0').overall, before.overall)
  const old = record('pocha', 2, '2345')
  old.room.players.forEach(p => old.room.setConnected(p.id, false))
  await restored.commit('2345', old)
  await restored.commitRemovalBatch(['2345'])
  assert.equal(restored.getPersonalStats('account-0').overall.played, 1)
  await restored.saveShutdown([])
  assert.equal(store.value.results.length, 1)
  assert.equal(store.value.version, 2, 'deleting all rooms never downgrades a permanent-results snapshot')
})

test('ties are separate from wins and negative/custom points rank in the right direction', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const r = record('pocha', 3)
  r.room.pocha!.settings = { ...r.room.pocha!.settings, exactBidPoints: 0, trickPoints: 0, missPenalty: 100 }
  finishPocha(r)
  await repo.commit('1234', r)
  const winners = r.room.players.filter(p => p.score === 0)
  assert.equal(winners.length, 2)
  for (const winner of winners) {
    const account = r.match!.participants.find(p => p.playerId === winner.id)!.accountId!
    const summary = repo.getPersonalStats(account)
    assert.deepEqual(summary.overall, { played: 1, wins: 0, draws: 1, losses: 0, winRate: 0 })
    assert.equal(summary.recentGames[0].outcome, 'draw')
    assert.equal(summary.recentGames[0].settings!.missPenalty, 100)
  }
  const loss = r.room.players.find(p => p.score < 0)!
  const account = r.match!.participants.find(p => p.playerId === loss.id)!.accountId!
  assert.equal(repo.getPersonalStats(account).recentGames[0].position, 3)
  assert.equal(repo.getPersonalStats(account).recentGames[0].score, -100)
})

test('guests can be opponents but duplicate accounts, test bots, departures and untracked legacy seats cannot inflate stats', async () => {
  for (const scenario of ['guest', 'duplicate', 'bot', 'departure', 'replacement', 'forced-end', 'test-mode', 'no-accounts', 'offline-start'] as const) {
    const store = new MemoryStore(), repo = new GameRepository(store)
    const r = record(scenario === 'forced-end' ? 'continental' : 'pocha')
    if (scenario === 'guest') r.match!.participants[1].accountId = null
    if (scenario === 'duplicate') r.match!.participants[1].accountId = r.match!.participants[0].accountId
    if (scenario === 'bot') r.sessions[1].bot = true
    if (scenario === 'test-mode') r.match!.eligible = false
    if (scenario === 'no-accounts') { r.match!.eligible = false; r.match!.participants.forEach(p => p.accountId = null) }
    if (scenario === 'offline-start') {
      r.room.setConnected(r.room.players[1].id, false)
      beginPersonalMatch(r, Object.fromEntries(r.room.players.map((p, i) => [p.id, `account-${i}`])))
      r.room.setConnected(r.room.players[1].id, true)
    }
    if (scenario === 'forced-end') r.room.removePlayer(r.room.players[1].id)
    else finishPocha(r)
    if (scenario === 'departure') r.room.removePlayer(r.room.players[1].id)
    if (scenario === 'replacement') r.match!.participants[1].playerId = 'different-seat'
    await repo.commit('1234', r)
    assert.equal(repo.getPersonalStats('account-0').overall.played, scenario === 'guest' ? 1 : 0, scenario)
    if (['departure', 'replacement', 'bot', 'duplicate'].includes(scenario)) assert.equal(repo.records.get('1234')!.match!.eligible, false)
  }
})

test('result metadata retains the actual deck and validates settings against it while accepting legacy results', async () => {
  for (const gameType of ['pocha', 'continental'] as const) {
    const store = new MemoryStore(), repo = new GameRepository(store)
    const r = record(gameType)
    if (gameType === 'pocha') finishPocha(r)
    else finishConti(r)
    await repo.commit('1234', r)
    const saved = store.value.results[0]
    const result = repo.getPersonalStats('account-0').recentGames[0]
    if (gameType === 'pocha') {
      assert.equal(saved.deckSize, 40)
      assert.equal(result.deckSize, 40)
      assert.throws(() => parseGameResults([{ ...saved, deckSize: 32, settings: { ...saved.settings, maxCards: 17 } }]))
      assert.throws(() => parseGameResults([{ ...saved, deckCount: 2 }]))
      const legacy = { ...saved }; delete legacy.deckSize
      assert.equal([...parseGameResults([legacy]).values()][0].deckSize, undefined)
    } else {
      assert.equal(saved.deckCount, 2)
      assert.equal(result.deckCount, 2)
      assert.throws(() => parseGameResults([{ ...saved, deckCount: 4 }]))
      assert.throws(() => parseGameResults([{ ...saved, deckSize: 40 }]))
      const legacy = { ...saved }; delete legacy.deckCount
      assert.equal([...parseGameResults([legacy]).values()][0].deckCount, undefined)
    }
  }
})

test('account bindings are pinned and each rematch has a new immutable run identifier', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const r = record('continental')
  const first = r.match!.id
  finishConti(r); await repo.commit('1234', r)
  assert.equal(r.room.rematch(), true)
  beginPersonalMatch(r, Object.fromEntries(r.room.players.map((p, i) => [p.id, i === 0 ? 'different-account' : null])))
  assert.notEqual(r.match!.id, first)
  finishConti(r); await repo.commit('1234', r)
  assert.equal(repo.getPersonalStats('account-0').overall.played, 1)
  assert.equal(repo.getPersonalStats('different-account').overall.played, 1)
  assert.equal(repo.getPersonalStats('account-1').overall.played, 1)
  assert.equal(store.value.results.length, 2)
})

test('failed and ambiguous saves cannot publish a result or continue writing from uncertain memory', async () => {
  for (const ambiguous of [false, true]) {
    const store = new MemoryStore(), repo = new GameRepository(store)
    const r = record()
    await repo.commit('1234', cloneRecord(r))
    finishPocha(r)
    store.fail = !ambiguous; store.ambiguous = ambiguous
    await assert.rejects(repo.commit('1234', r))
    assert.equal(repo.failed, true)
    assert.equal(repo.getPersonalStats('account-0').overall.played, 0)
    await assert.rejects(repo.commit('1234', r))
    store.fail = false; store.ambiguous = false
    const restarted = new GameRepository(store)
    await restarted.load()
    assert.equal(restarted.getPersonalStats('account-0').overall.played, ambiguous ? 1 : 0)
    if (ambiguous) {
      await restarted.commit('1234', cloneRecord(restarted.records.get('1234')!))
      assert.equal(restarted.getPersonalStats('account-0').overall.played, 1)
    }
  }
})

test('statistics parser allowlists private metadata and rejects corrupt or duplicate results', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const r = record()
  finishPocha(r); await repo.commit('1234', r)
  const valid = structuredClone(store.value.results[0])
  const unknown = structuredClone(valid)
  unknown.secret = 'discard'; unknown.players[0].email = 'discard@example.test'
  const parsed = [...parseGameResults([unknown]).values()][0]
  assert.equal('secret' in parsed, false)
  assert.equal('email' in parsed.players[0], false)
  assert.throws(() => parseGameResults([valid, valid]))
  for (const mutate of [
    (v: any) => { v.players[0].score = Infinity }, (v: any) => { v.players[0].position = 10 },
    (v: any) => { v.players[0].accountId = v.players[1].accountId },
    (v: any) => { v.finishedAt = v.startedAt - 1 },
  ]) {
    const bad = structuredClone(valid); mutate(bad)
    assert.throws(() => parseGameResults([bad]))
  }
  assert.deepEqual(parsePersonalMatch({ ...r.match, secret: 'discard' }), r.match)
  assert.throws(() => parsePersonalMatch({ ...r.match, participants: [] }))
})

test('the private HTTP view uses the authenticated account, ignores account selectors, and never caches or leaks credentials', async t => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const r = record('continental')
  finishConti(r); await repo.commit('1234', r)
  const app = express()
  let healthy = true
  registerPersonalStats(app, { repository: repo, isHealthy: () => healthy, authenticate: token => token === 'test-A' ? 'account-0' : token === 'test-B' ? 'unrelated' : null })
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => http.close(() => resolve())))
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  const unauthenticated = await fetch(base + '/api/membership/stats')
  assert.equal(unauthenticated.status, 401)
  assert.equal(unauthenticated.headers.get('cache-control'), 'no-store')
  const mine = await fetch(base + '/api/membership/stats?accountId=unrelated', { headers: { Authorization: 'Bearer test-A' } })
  assert.equal(mine.status, 200)
  const data = await mine.json() as any
  assert.equal(data.overall.played, 1)
  assert.equal(data.overall.wins, 1)
  for (const secret of ['test-A', 'account-0', 'account-1', 'email', 'tokenHash', 'playerId']) assert.equal(JSON.stringify(data).includes(secret), false)
  const other = await fetch(base + '/api/membership/stats?accountId=account-0', { headers: { Authorization: 'Bearer test-B' } })
  assert.equal((await other.json() as any).overall.played, 0)
  healthy = false
  assert.equal((await fetch(base + '/api/membership/stats', { headers: { Authorization: 'Bearer test-A' } })).status, 503)
})

test('aggregate percentages use all games while recent history is bounded, ordered and isolated from callers', () => {
  const results: DurableGameResult[] = Array.from({ length: 60 }, (_, i) => {
    const gameType = i % 2 ? 'continental' as const : 'pocha' as const
    const outcome = Math.floor(i / 2) % 3
    const winner = gameType === 'pocha' ? 9 : -10, loser = gameType === 'pocha' ? -2 : 80
    const mine = outcome === 0 ? winner : outcome === 1 ? 0 : loser
    const other = outcome === 0 ? loser : outcome === 1 ? 0 : winner
    return {
      id: `game-${i}`, gameType, startedAt: 0, finishedAt: i + 1,
      players: [
        { accountId: 'me', name: 'My name', score: mine, position: outcome === 2 ? 2 : 1 },
        { accountId: 'other', name: 'Their name', score: other, position: outcome === 0 ? 2 : 1 },
      ],
      ...(gameType === 'pocha' ? { deckSize: 40, settings: { mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1, missPenalty: 2 } } : { deckCount: 2 }),
    }
  })
  const stats = personalStats(results, 'me', 500, 100)
  assert.equal(stats.generatedAt, 100)
  assert.deepEqual(stats.overall, { played: 60, wins: 20, draws: 20, losses: 20, winRate: 33.3 })
  for (const totals of Object.values(stats.byGame)) assert.deepEqual(totals, { played: 30, wins: 10, draws: 10, losses: 10, winRate: 33.3 })
  assert.equal(stats.recentGames.length, 50)
  assert.equal(stats.recentGames[0].id, 'game-59')
  assert.equal(stats.recentGames.at(-1)!.id, 'game-10')
  const short = personalStats(results, 'me', 2)
  assert.equal(short.recentGames.length, 2)
  assert.equal(short.overall.played, 60)
  short.recentGames[0].players[0].name = 'Changed'
  short.recentGames[1].settings!.missPenalty = 99
  assert.equal(results.at(-1)!.players[0].name, 'My name')
  assert.equal(results.at(-2)!.settings!.missPenalty, 2)
  assert.equal(personalStats(results, 'unrelated').overall.played, 0)
  for (const gameType of ['pocha', 'continental'] as const) {
    const scoped = personalStats(results, 'me', 2, 100, gameType)
    assert.deepEqual(scoped.overall, stats.byGame[gameType], 'scoped totals still include games beyond the history limit')
    assert.deepEqual(scoped.byGame[gameType], scoped.overall)
    assert.deepEqual(scoped.byGame[gameType === 'pocha' ? 'continental' : 'pocha'], { played: 0, wins: 0, draws: 0, losses: 0, winRate: 0 })
    assert.equal(scoped.recentGames.length, 2)
    assert.ok(scoped.recentGames.every(game => game.gameType === gameType))
  }
})

test('game-scoped HTTP statistics retain older matches before limiting history and keep account privacy', async t => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const results: DurableGameResult[] = Array.from({ length: 51 }, (_, i) => ({
    id: `game-${i}`, gameType: i === 0 ? 'continental' : 'pocha', startedAt: 0, finishedAt: i + 1,
    players: [
      { accountId: 'account-0', name: 'My name', score: i === 0 ? 0 : 20, position: 1 },
      { accountId: 'account-1', name: 'Their name', score: i === 0 ? 20 : 0, position: 2 },
    ],
  }))
  store.value = { version: 2, savedAt: 100, rooms: [], results }
  await repo.load()
  const app = express()
  let healthy = true
  registerPersonalStats(app, { repository: repo, isHealthy: () => healthy, authenticate: token => token === 'test-A' ? 'account-0' : token === 'test-B' ? 'unrelated' : null })
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => http.close(() => resolve())))
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/membership/stats`
  const get = (query: string, token = 'test-A') => fetch(base + query, { headers: { Authorization: `Bearer ${token}` } })

  const unscoped = await (await get('')).json() as any
  assert.equal(unscoped.overall.played, 51)
  assert.equal(unscoped.byGame.continental.played, 1)
  assert.equal(unscoped.byGame.pocha.played, 50)
  assert.equal(unscoped.recentGames.length, 50)
  assert.equal(unscoped.recentGames[0].id, 'game-50')
  assert.equal(unscoped.recentGames.at(-1).id, 'game-1')

  const contiResponse = await get('?gameType=continental&accountId=unrelated')
  assert.equal(contiResponse.status, 200)
  assert.equal(contiResponse.headers.get('cache-control'), 'no-store')
  assert.equal(contiResponse.headers.get('x-robots-tag'), 'noindex, nofollow')
  const conti = await contiResponse.json() as any
  assert.deepEqual(conti.overall, { played: 1, wins: 1, draws: 0, losses: 0, winRate: 100 })
  assert.deepEqual(conti.byGame.continental, conti.overall)
  assert.deepEqual(conti.byGame.pocha, { played: 0, wins: 0, draws: 0, losses: 0, winRate: 0 })
  assert.deepEqual(conti.recentGames.map((game: any) => game.id), ['game-0'])
  assert.equal(conti.recentGames[0].gameType, 'continental')
  for (const secret of ['test-A', 'account-0', 'account-1', 'accountId', 'email', 'tokenHash', 'playerId']) assert.equal(JSON.stringify(conti).includes(secret), false)

  const pocha = await (await get('?gameType=pocha')).json() as any
  assert.deepEqual(pocha.overall, { played: 50, wins: 50, draws: 0, losses: 0, winRate: 100 })
  assert.deepEqual(pocha.byGame.pocha, pocha.overall)
  assert.deepEqual(pocha.byGame.continental, { played: 0, wins: 0, draws: 0, losses: 0, winRate: 0 })
  assert.equal(pocha.recentGames.length, 50)
  assert.ok(pocha.recentGames.every((game: any) => game.gameType === 'pocha'))
  const other = await (await get('?gameType=continental&accountId=account-0', 'test-B')).json() as any
  assert.equal(other.overall.played, 0)
  assert.deepEqual(other.recentGames, [])
  assert.equal((await get('?gameType=continental', 'invalid')).status, 401)

  for (const query of ['?gameType=', '?gameType=football', '?gameType=Pocha', '?gameType=pocha&gameType=continental', '?gameType=pocha&gameType=pocha', '?gameType[]=pocha', '?gameType[name]=pocha']) {
    const response = await get(query)
    assert.equal(response.status, 400, query)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { error: 'invalid_game_type' })
  }
  healthy = false
  assert.equal((await get('?gameType=continental')).status, 503)
  assert.equal(store.saves, 0, 'statistics reads never change stored history')
})
