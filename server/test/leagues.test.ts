import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import express from 'express'
import { Room } from '../src/room.js'
import { GameRepository, issueCredential, cloneRecord, type RoomRecord } from '../src/recovery.js'
import { beginPersonalMatch, type DurableGameResult } from '../src/personalStats.js'
import { buildLeagueTable, LeagueError, parseLeagues, registerLeagues, validLeagueMatch, type StoredLeague } from '../src/leagues.js'
import { initialLeagueRating, updateLeagueRatings, leagueRatingPoints } from '../src/leagueRating.js'
import type { MembershipAccount } from '../../shared/membership.js'
import type { SnapshotStore } from '../src/storage.js'

class MemoryStore implements SnapshotStore {
  value: any = null
  fail = false
  ambiguous = false
  saves = 0
  async load() { return structuredClone(this.value) }
  async save(value: unknown) {
    this.saves++
    if (this.fail) throw new Error('Local save failed')
    this.value = structuredClone(value)
    if (this.ambiguous) throw new Error('Local acknowledgement lost')
  }
  async close() {}
}
const account = (n: number): MembershipAccount => ({ id: `account-${n}`, name: `Jugador ${n}`, email: `player-${n}@example.test`, adFree: false, source: null, expiresAt: null })
async function setup(n = 6, minGames = 5) {
  const store = new MemoryStore(), repo = new GameRepository(store)
  const league = await repo.createLeague(account(0), { name: 'Familia', gameType: 'pocha', minGames })
  for (let i = 1; i < n; i++) await repo.joinLeague(account(i), league.inviteCode)
  return { store, repo, league }
}
function playing(leagueId: string, members: number[], roomId = '1234'): RoomRecord {
  const room = new Room({ roomId, gameType: 'pocha' })
  const sessions = members.map(member => {
    const { credential, session } = issueCredential(roomId)
    room.addPlayer(credential.playerId, account(member).name!)
    return session
  })
  const record: RoomRecord = { room, sessions, updatedAt: Date.now(), paused: null, chat: [], leagueId }
  assert.equal(room.startPochaGame({ mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1 }).ok, true)
  beginPersonalMatch(record, Object.fromEntries(room.players.map((p, i) => [p.id, account(members[i]).id])))
  return record
}
function finish(record: RoomRecord) {
  const state = record.room.pocha!
  while (state.phase === 'bidding') {
    const player = state.players[state.currentPlayerIndex]
    assert.equal(record.room.pochaAction(player.id, { type: 'bid', value: 1 }).ok, true)
  }
  while (state.phase === 'playing') {
    const player = state.players[state.currentPlayerIndex]
    const legal = record.room.getState(player.id).pocha!.legalCardIds!
    assert.equal(record.room.pochaAction(player.id, { type: 'play', cardId: legal[0] }).ok, true)
  }
  assert.equal(record.room.phase, 'game_end')
}

test('private league creation, code joins and ownership are durable, bounded and never expose account identity', async () => {
  const { store, repo, league } = await setup(3)
  assert.equal(store.value.version, 3)
  assert.equal(repo.listLeagues('stranger').length, 0)
  assert.equal(repo.getLeagueDetail(league.id, 'stranger'), null)
  const owner = repo.getLeagueDetail(league.id, account(0).id)!
  assert.equal(owner.minGames, 5)
  assert.equal(owner.memberCount, 3)
  assert.equal(owner.isOwner, true)
  assert.match(owner.inviteCode, /^[A-F0-9]{10}$/)
  assert(owner.standings.every(row => row.rank === null && row.provisional && row.played === 0 && row.rating === 0))
  assert.equal(owner.standings.filter(row => row.isMe).length, 1)
  const publicView = JSON.stringify(owner)
  for (const secret of ['account-', '@example.test', 'accountId', 'ownerAccountId', 'password', 'token', 'mu', 'sigma']) assert.equal(publicView.includes(secret), false)
  const before = store.saves
  await repo.joinLeague(account(1), ' ' + owner.inviteCode.toLowerCase() + ' ')
  assert.equal(store.saves, before, 'join is idempotent')
  const restored = new GameRepository(store)
  await restored.load()
  assert.deepEqual(restored.getLeagueDetail(league.id, account(0).id), owner)
  await assert.rejects(restored.closeLeague(league.id, account(1).id), (e: unknown) => e instanceof LeagueError && e.code === 'league_owner_required')
  await assert.rejects(restored.closeLeague(league.id, 'stranger'), (e: unknown) => e instanceof LeagueError && e.code === 'league_not_found')
  await restored.closeLeague(league.id, account(0).id)
  await assert.rejects(restored.joinLeague(account(4), owner.inviteCode), /league_closed/)
  assert.equal((await restored.joinLeague(account(1), owner.inviteCode)).memberCount, 3)
})

test('a selected league permits only members of its game with separate accounts, while ordinary play remains possible', async () => {
  const { repo, league } = await setup(3)
  assert.equal(repo.validateLeagueSelection(league.id, 'pocha', account(0).id), null)
  assert.equal(repo.validateLeagueSelection(league.id, 'continental', account(0).id), 'league_wrong_game')
  assert.equal(repo.validateLeagueSelection(league.id, 'pocha', null), 'league_members_only')
  assert.equal(repo.validateLeagueSelection('missing', 'pocha', account(0).id), 'league_not_found')
  assert.equal(repo.validateLeagueStart(league.id, 'pocha', [account(0).id, account(1).id]), null)
  for (const accounts of [[account(0).id, null], [account(0).id, account(9).id], [account(0).id]]) assert.equal(repo.validateLeagueStart(league.id, 'pocha', accounts), 'league_members_only')
  assert.equal(repo.validateLeagueStart(league.id, 'pocha', [account(0).id, account(0).id]), 'league_duplicate_account')
  assert.equal(repo.validateLeagueStart(league.id, 'pocha', [account(0).id, account(1).id], true), 'league_members_only')
  const game = playing(league.id, [0, 1])
  assert.equal(game.match!.leagueId, league.id)
  assert.equal(cloneRecord(game).leagueId, league.id)
  delete game.leagueId
  assert.equal(game.match!.leagueId, league.id, 'clearing a lobby selection later cannot move the pinned game')
})

test('ten completed games with changing tables and all final places replay exactly once and survive cleanup, shutdown and restart', async () => {
  const { store, repo, league } = await setup(6, 3)
  const groups = [[0, 1], [0, 2, 3], [1, 2, 4, 5], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 0], [0, 3], [2, 4, 5], [0, 1, 4, 5], [0, 1, 2], [0, 1, 2, 3, 4, 5]]
  let totalSeats = 0
  for (let i = 0; i < groups.length; i++) {
    const game = playing(league.id, groups[i], String(1234 + i))
    await repo.commit(game.room.roomId, game)
    finish(game)
    await repo.commit(game.room.roomId, game)
    await repo.commit(game.room.roomId, cloneRecord(game))
    totalSeats += groups[i].length
  }
  const detail = repo.getLeagueDetail(league.id, account(0).id)!
  assert.equal(detail.gameCount, 10)
  assert.equal(detail.recentGames.length, 10)
  assert.equal(detail.standings.reduce((n, row) => n + row.played, 0), totalSeats)
  assert.equal(detail.standings.reduce((n, row) => n + row.wins, 0), 10)
  assert(detail.standings.every(row => !row.provisional && row.rank !== null && Number.isFinite(row.rating)))
  assert.equal(store.value.results.length, 10)
  assert.equal(repo.getPersonalStats(account(0).id).overall.played, groups.filter(g => g.includes(0)).length)
  const ratings = new Map(Array.from({ length: 6 }, (_, i) => [account(i).id, initialLeagueRating()]))
  for (const result of [...store.value.results as DurableGameResult[]].sort((a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id))) {
    const updated = updateLeagueRatings(result.players.map(p => ({ id: p.accountId!, ...ratings.get(p.accountId!)!, position: p.position })))
    for (const [key, value] of updated) ratings.set(key, value)
  }
  for (const row of detail.standings) {
    const member = store.value.leagues[0].members.find((m: any) => m.id === row.memberId)
    assert.equal(row.rating, leagueRatingPoints(ratings.get(member.accountId)!))
  }
  await repo.commitRemovalBatch([...repo.records.keys()])
  await repo.saveShutdown([])
  const restored = new GameRepository(store, 1)
  await restored.load(Date.now() + 1_000_000)
  assert.equal(restored.records.size, 0)
  assert.deepEqual(restored.getLeagueDetail(league.id, account(0).id), detail)
  assert.equal(store.value.version, 3)
  const leaked = JSON.stringify(restored.getLeagueDetail(league.id, account(3).id))
  for (const secret of ['account-', 'accountId', 'email', 'token', 'playerId', 'hand']) assert.equal(leaked.includes(secret), false)
})

test('league closure blocks new games and admits a game already dealt, including after restart', async () => {
  const { store, repo, league } = await setup(3)
  const game = playing(league.id, [0, 1])
  await repo.commit('1234', game)
  const closed = await repo.closeLeague(league.id, account(0).id)
  assert.equal(repo.validateLeagueStart(league.id, 'pocha', [account(0).id, account(1).id]), 'league_closed')
  assert(closed.closedAt! >= game.match!.startedAt)
  const restored = new GameRepository(store)
  await restored.load()
  const inProgress = restored.records.get('1234')!
  finish(inProgress)
  await restored.commit('1234', inProgress)
  assert.equal(restored.getLeagueDetail(league.id, account(0).id)!.gameCount, 1)
  assert.equal(validLeagueMatch(store.value.leagues[0], 'pocha', { ...inProgress.match!, startedAt: closed.closedAt! + 1 }), false)
})

test('ties use the complete final ranking and conservative provisional players do not take qualified places', async () => {
  const { store, repo, league } = await setup(4, 1)
  const game = playing(league.id, [0, 1, 2])
  game.room.pocha!.settings = { ...game.room.pocha!.settings, exactBidPoints: 0, trickPoints: 0, missPenalty: 0 }
  finish(game)
  await repo.commit('1234', game)
  const detail = repo.getLeagueDetail(league.id, account(0).id)!
  assert.equal(detail.standings.reduce((n, row) => n + row.draws, 0), 3)
  assert(detail.standings.slice(0, 3).every(row => row.rank !== null && !row.provisional && row.wins === 0 && row.winRate === 0))
  // The reference factor graph approximates a multiway draw. Identical priors
  // can differ by a few hundredths in conservative confidence, never by seats.
  const drawRatings = detail.standings.slice(0, 3).map(row => row.rating)
  assert(Math.max(...drawRatings) - Math.min(...drawRatings) < .05)
  assert.equal(detail.standings[3].rank, null)
  assert.equal(detail.standings[3].played, 0)
  const original = store.value.leagues[0] as StoredLeague
  const reversed = structuredClone(store.value.results) as DurableGameResult[]
  reversed[0].players.reverse()
  const replay = buildLeagueTable(original, reversed)
  assert.deepEqual(replay.standings, buildLeagueTable(original, store.value.results).standings)
})

test('leagues never claim old or unrelated games and snapshots reject broken membership references', async () => {
  const { store, repo, league } = await setup(3)
  const game = playing(league.id, [0, 1])
  delete game.leagueId; delete game.match!.leagueId
  finish(game)
  await repo.commit('1234', game)
  assert.equal(repo.getPersonalStats(account(0).id).overall.played, 1)
  assert.equal(repo.getLeagueDetail(league.id, account(0).id)!.gameCount, 0)
  const good = structuredClone(store.value)
  for (const mutate of [
    (v: any) => { v.results[0].leagueId = 'missing' },
    (v: any) => { v.results[0].leagueId = league.id; v.results[0].players[0].accountId = 'stranger' },
    (v: any) => { v.rooms[0].leagueId = 'missing' },
    (v: any) => { v.leagues[0].members[0].id = v.leagues[0].members[0].accountId },
    (v: any) => { v.version = 2 },
  ]) {
    store.value = structuredClone(good); mutate(store.value)
    await assert.rejects(new GameRepository(store).load(), /league/i)
  }
  store.value = good
  const loaded = new GameRepository(store)
  await loaded.load()
  assert.equal(loaded.getLeagueDetail(league.id, account(0).id)!.gameCount, 0)
})

test('create and finished-match persistence failures do not publish partial leagues or ratings; lost acknowledgements recover safely', async () => {
  const emptyStore = new MemoryStore(), emptyRepo = new GameRepository(emptyStore)
  emptyStore.fail = true
  await assert.rejects(emptyRepo.createLeague(account(0), { name: 'Familia', gameType: 'pocha' }))
  assert.equal(emptyRepo.listLeagues(account(0).id).length, 0)
  assert.equal(emptyRepo.failed, true)
  const { store, repo, league } = await setup(2)
  const game = playing(league.id, [0, 1])
  await repo.commit('1234', game)
  finish(game)
  store.ambiguous = true
  await assert.rejects(repo.commit('1234', game))
  assert.equal(repo.failed, true)
  assert.equal(repo.getLeagueDetail(league.id, account(0).id)!.gameCount, 0)
  store.ambiguous = false
  const recovered = new GameRepository(store)
  await recovered.load()
  assert.equal(recovered.getLeagueDetail(league.id, account(0).id)!.gameCount, 1)
  await recovered.commit('1234', cloneRecord(recovered.records.get('1234')!))
  assert.equal(recovered.getLeagueDetail(league.id, account(0).id)!.gameCount, 1)
})

test('legacy v1 rooms and v2 personal history migrate to v3 without claiming historical league games', async () => {
  for (const initialVersion of [1, 2]) {
    const store = new MemoryStore(), repo = new GameRepository(store)
    if (initialVersion === 1) store.value = { version: 1, savedAt: Date.now(), rooms: [] }
    else {
      const old = playing('unused', [0, 1])
      delete old.leagueId; delete old.match!.leagueId
      finish(old)
      await repo.commit('1234', old)
      assert.equal(store.value.version, 2)
    }
    const loaded = new GameRepository(store)
    await loaded.load()
    const before = loaded.getPersonalStats(account(0).id).overall
    const league = await loaded.createLeague(account(0), { name: 'Nueva liga', gameType: 'pocha' })
    assert.equal(store.value.version, 3)
    assert.equal(store.value.leagues[0].ratingVersion, 1)
    assert.equal(league.gameCount, 0)
    assert.deepEqual(loaded.getPersonalStats(account(0).id).overall, before)
  }
})

test('league inputs and persisted limits reject malformed names, formats and unbounded membership', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  for (const input of [{ name: '', gameType: 'pocha' }, { name: 'a'.repeat(61), gameType: 'pocha' }, { name: 'Familia\nAdmin', gameType: 'pocha' }, { name: 'Familia', gameType: 'chess' }, { name: 'Familia', gameType: 'pocha', minGames: 0 }, { name: 'Familia', gameType: 'pocha', minGames: 51 }, null]) await assert.rejects(repo.createLeague(account(0), input), LeagueError)
  assert.equal(store.saves, 0)
  const league = await repo.createLeague(account(0), { name: 'Familia', gameType: 'pocha' })
  for (const code of [null, '', 'ABC', 'a'.repeat(1000)]) await assert.rejects(repo.joinLeague(account(1), code), /invalid_invite_code/)
  await assert.rejects(repo.joinLeague(account(1), 'FFFFFFFFFF'), /league_not_found/)
  const raw = structuredClone(store.value.leagues)
  raw[0].members = Array.from({ length: 201 }, (_, i) => ({ id: `m-${i}`, accountId: `a-${i}`, name: 'Name', joinedAt: raw[0].createdAt }))
  assert.throws(() => parseLeagues(raw), /Invalid league storage/)
  assert.equal(league.gameCount, 0)
})

test('HTTP leagues require a session, keep business errors and serialize mutations without exposing invitation codes to strangers', async t => {
  const store = new MemoryStore(), repo = new GameRepository(store), app = express()
  let queue: Promise<unknown> = Promise.resolve()
  const sessions = new Map(['owner', 'other', 'stranger'].map((token, i) => [token, account(i)]))
  registerLeagues(app, { repository: repo, authenticate: token => sessions.get(token) ?? null, isHealthy: () => !repo.failed,
    runMutation: work => { const result = queue.then(work); queue = result.catch(() => undefined); return result } })
  const server = createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address() as { port: number }
  const call = (path: string, token: string | null, body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/leagues${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  assert.equal((await call('', null)).status, 401)
  const invalid = await call('', 'owner', { name: '', gameType: 'pocha' })
  assert.equal(invalid.status, 400)
  assert.deepEqual(await invalid.json(), { error: 'invalid_league_name' })
  const create = await call('', 'owner', { name: 'Familia', gameType: 'pocha' })
  assert.equal(create.status, 201)
  assert.equal(create.headers.get('cache-control'), 'no-store')
  const created = await create.json() as any
  const inaccessible = await call('/' + created.id, 'stranger')
  assert.equal(inaccessible.status, 404)
  assert.deepEqual(await (await call('', 'stranger')).json(), { leagues: [] })
  assert.equal((await call('/join', 'other', { code: created.inviteCode })).status, 200)
  assert.equal((await call('/' + created.id + '/close', 'other', {})).status, 403)
  assert.equal((await call('/' + created.id + '/close', 'owner', {})).status, 200)
  assert.equal((await call('/join', 'stranger', { code: created.inviteCode })).status, 409)
  assert.equal(repo.getLeagueDetail(created.id, account(0).id)!.memberCount, 2)
})
