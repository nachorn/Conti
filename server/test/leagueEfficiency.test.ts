import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import test from 'node:test'
import { GameRepository, type RoomRecord } from '../src/recovery.js'
import { Room } from '../src/room.js'
import type { DurableGameResult } from '../src/personalStats.js'
import type { SnapshotStore } from '../src/storage.js'
import { createLeagueSimulations } from './fixtures/leagueSimulation.js'

class MemoryStore implements SnapshotStore {
  fail = false
  ambiguous = false
  constructor(public value: any) {}
  async load() { return structuredClone(this.value) }
  async save(value: unknown) {
    if (this.fail && !this.ambiguous) throw new Error('Synthetic save failure')
    this.value = structuredClone(value)
    if (this.fail) throw new Error('Synthetic lost acknowledgement')
  }
  async close() {}
}
const fixtures = createLeagueSimulations()
function snapshot(leagueCount: number, gamesPerLeague: number) {
  const sample = fixtures.find(f => f.gameType === 'pocha')!
  const leagues = Array.from({ length: leagueCount }, (_, i) => ({ ...structuredClone(sample.league), id: `benchmark-league-${i}`, inviteCode: i.toString(16).toUpperCase().padStart(10, '0') }))
  const results = leagues.flatMap((league, i) => Array.from({ length: gamesPerLeague }, (_, game) => ({ ...structuredClone(sample.results[game % sample.results.length]),
    id: `benchmark-result-${i}-${game}`, leagueId: league.id, startedAt: league.createdAt + 10_000 + game, finishedAt: league.createdAt + 20_000 + game })))
  return { version: 3, savedAt: Date.now(), rooms: [], leagues, results }
}
/** Real one-card Pocha actions create a new result; no score or game_end is assigned. */
function completedRoom(leagueId?: string): RoomRecord {
  const room = new Room({ roomId: '9797', gameType: 'pocha' })
  for (let i = 0; i < 2; i++) room.addPlayer(`benchmark-seat-${i}`, `Fixture ${i + 1}`)
  assert.equal(room.startPochaGame({ mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1 }).ok, true)
  const startedAt = Date.now()
  const record: RoomRecord = { room, sessions: room.players.map((player, i) => ({ playerId: player.id, tokenHash: String(i).padStart(64, '0') })),
    paused: null, updatedAt: startedAt, ...(leagueId ? { leagueId } : {}),
    match: { id: 'benchmark-new-result', startedAt, eligible: true, ...(leagueId ? { leagueId } : {}),
      participants: room.players.map((p, i) => ({ playerId: p.id, accountId: `simulation-account-${i}`, name: p.name })) } }
  while (room.pocha!.phase === 'bidding') {
    const player = room.pocha!.players[room.pocha!.currentPlayerIndex]
    assert.equal(room.pochaAction(player.id, { type: 'bid', value: room.getState(player.id).pocha!.blockedBid === 0 ? 1 : 0 }).ok, true)
  }
  while (room.pocha!.phase === 'playing') {
    const player = room.pocha!.players[room.pocha!.currentPlayerIndex]
    assert.equal(room.pochaAction(player.id, { type: 'play', cardId: room.getState(player.id).pocha!.legalCardIds![0] }).ok, true)
  }
  assert.equal(room.phase, 'game_end')
  return record
}
/** Count visited global ledger entries, without exposing any private data or requiring timing thresholds. */
function countGlobalVisits<T>(repository: GameRepository, read: () => T) {
  const ledger = (repository as unknown as { results: Map<string, DurableGameResult> }).results
  const original = ledger.values.bind(ledger)
  let visits = 0
  Object.defineProperty(ledger, 'values', { configurable: true, value: function* () {
    for (const result of original()) { visits++; yield result }
  } })
  try { const result = read(); return { result, visits } }
  finally { Reflect.deleteProperty(ledger, 'values') }
}

test('league reads reuse only their own immutable results after another league changes, and membership/closure still refresh', async () => {
  const store = new MemoryStore(snapshot(2, 3)), repo = new GameRepository(store)
  await repo.load()
  const before = repo.getAdminLeagueDetail('benchmark-league-0')!
  const otherBefore = repo.getAdminLeagueDetail('benchmark-league-1')!.gameCount
  await repo.commit('9797', completedRoom('benchmark-league-1'))
  const observed = countGlobalVisits(repo, () => {
    const same = repo.getLeagueDetail('benchmark-league-0', 'simulation-account-0')!
    const admin = repo.getAdminLeagueDetail('benchmark-league-0')!
    repo.listLeagues('simulation-account-0')
    repo.listAdminLeagues({ q: '', status: 'all', offset: 0, limit: 50 })
    return { same, admin }
  })
  assert(isDeepStrictEqual(observed.result.admin, before), 'Unrelated results cannot change this league')
  assert.equal(observed.visits, 0, 'Unchanged league reads and summaries must not scan the complete global ledger')
  assert.equal(repo.getAdminLeagueDetail('benchmark-league-1')!.gameCount, otherBefore + 1)
  const code = store.value.leagues[0].inviteCode
  await repo.joinLeague({ id: 'new-synthetic-account', name: 'Nueva' }, code)
  const joined = repo.getAdminLeagueDetail('benchmark-league-0')!
  assert.equal(joined.memberCount, 6)
  assert(joined.standings.some(row => row.name === 'Nueva' && row.played === 0 && row.provisional))
  await repo.closeLeague('benchmark-league-0', 'simulation-account-0')
  const closed = repo.getAdminLeagueDetail('benchmark-league-0')!
  assert(closed.closedAt !== null)
  assert(isDeepStrictEqual(closed.standings, joined.standings))
})

test('failed and uncertain saves never publish a new league index; restart rebuilds only the durable history', async () => {
  for (const ambiguous of [false, true]) {
    const store = new MemoryStore(snapshot(2, 2)), repo = new GameRepository(store)
    await repo.load()
    const beforeA = repo.getAdminLeagueDetail('benchmark-league-0')!, beforeB = repo.getAdminLeagueDetail('benchmark-league-1')!
    store.fail = true; store.ambiguous = ambiguous
    await assert.rejects(() => repo.commit('9797', completedRoom('benchmark-league-1')))
    assert.equal(repo.failed, true)
    assert(isDeepStrictEqual(repo.getAdminLeagueDetail('benchmark-league-0'), beforeA))
    assert(isDeepStrictEqual(repo.getAdminLeagueDetail('benchmark-league-1'), beforeB))
    const restored = new GameRepository(store); await restored.load()
    assert(isDeepStrictEqual(restored.getAdminLeagueDetail('benchmark-league-0'), beforeA))
    assert.equal(restored.getAdminLeagueDetail('benchmark-league-1')!.gameCount, beforeB.gameCount + Number(ambiguous))
  }
})

test('synthetic league growth benchmark records work and latency without flaky timing assertions', async () => {
  const store = new MemoryStore(snapshot(20, 100)), repo = new GameRepository(store)
  await repo.load()
  const readAll = () => Array.from({ length: 20 }, (_, i) => repo.getAdminLeagueDetail(`benchmark-league-${i}`))
  const coldStart = performance.now(), before = readAll(), coldMs = performance.now() - coldStart
  const warmStart = performance.now(); readAll(); const warmMs = performance.now() - warmStart
  await repo.commit('9797', completedRoom())
  const afterStart = performance.now(), after = countGlobalVisits(repo, readAll), afterUnrelatedMs = performance.now() - afterStart
  assert(isDeepStrictEqual(after.result, before))
  const phase = process.env.NRN_LEAGUE_BENCHMARK_PHASE === 'baseline' ? 'baseline' : 'after'
  const index = (repo as unknown as { resultsByLeague?: Map<string, DurableGameResult[] | { bySeason: Map<string, DurableGameResult[]> }> }).resultsByLeague
  const seasonEntries = index ? [...index.values()].flatMap(ledger => Array.isArray(ledger) ? [ledger] : [...ledger.bySeason.values()]) : []
  const additionalIndexReferences = seasonEntries.reduce((total, results) => total + results.length, 0)
  const evidence = { scope: 'Synthetic MemoryStore only, no production state or network', phase, leagues: 20, gamesPerLeague: 100, recordedGames: 2000,
    coldMs: Math.round(coldMs * 100) / 100, warmMs: Math.round(warmMs * 100) / 100, afterUnrelatedMs: Math.round(afterUnrelatedMs * 100) / 100,
    globalResultEntriesVisitedAfterUnrelated: after.visits, additionalIndexReferences }
  const directory = fileURLToPath(new URL('../../output/nrn-security-review/', import.meta.url))
  await mkdir(directory, { recursive: true })
  await writeFile(directory + `/league-efficiency-${phase}.json`, JSON.stringify(evidence, null, 2) + '\n')
})
