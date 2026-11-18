import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { AdminLeaguesController, readAdminLeagueDetail, readAdminLeagues, type LeagueFilters } from '../src/lib/adminLeagues.ts'
import { configureAdminToken } from '../src/lib/adminApi.ts'

const TOKEN = 'A'.repeat(43), NOW = 1_800_000_000_000
const summary = (id = 'league-a') => ({ id, name: 'Liga familiar', gameType: 'pocha', ownerName: 'Owner', createdAt: NOW - 1000, closedAt: null,
  minGames: 1, memberCount: 2, gameCount: 1 })
const list = (id = 'league-a') => ({ generatedAt: NOW, total: 1, filtered: 1, offset: 0, limit: 25, leagues: [summary(id)] })
const detail = (id = 'league-a') => ({ generatedAt: NOW, league: { ...summary(id), ratingSystem: 'trueskill', standings: [
  { memberId: 'member-a', name: 'Owner', rank: 1, rating: 12.5, played: 1, wins: 1, draws: 0, losses: 0, winRate: 100, provisional: false, joinedAt: NOW - 1000, isOwner: true },
  { memberId: 'member-b', name: 'Player', rank: 2, rating: -3.5, played: 1, wins: 0, draws: 0, losses: 1, winRate: 0, provisional: false, joinedAt: NOW - 500, isOwner: false },
], recentGames: [{ id: 'match-a', finishedAt: NOW, playerCount: 2, players: [{ memberId: 'member-a', name: 'Owner', position: 1, score: 30 }, { memberId: 'member-b', name: 'Player', position: 2, score: 10 }] }] } })
const filters: LeagueFilters = { q: '', gameType: '', status: 'all', offset: 0 }
function scope(t: TestContext) { const cleanup = configureAdminToken(() => TOKEN); t.after(cleanup) }
const pending = () => { let resolve!: (response: Response) => void; const promise = new Promise<Response>(complete => { resolve = complete }); return { promise, resolve } }

test('league list selects only its bounded contract and rejects malformed paging, duplicate IDs and dates', () => {
  const raw = { ...list(), private: 'secret', leagues: [{ ...summary(), inviteCode: 'secret', accountId: 'secret' }] }
  assert.deepEqual(readAdminLeagues(raw), list())
  for (const changed of [{ ...list(), limit: 51 }, { ...list(), filtered: 2 }, { ...list(), leagues: [summary(), summary()] },
    { ...list(), leagues: [{ ...summary(), createdAt: 1e20 }] }, { ...list(), leagues: [{ ...summary(), id: '__proto__' }] }]) assert.equal(readAdminLeagues(changed), null)
})

test('league details preserve standings and scores while stripping private data at every level', () => {
  const raw = detail()
  const privateRaw = { ...raw, token: 'secret', league: { ...raw.league, inviteCode: 'secret', ownerAccountId: 'secret', standings: raw.league.standings.map(row => ({ ...row, accountId: 'secret', passwordHash: 'secret' })),
    recentGames: raw.league.recentGames.map(game => ({ ...game, cards: 'secret', players: game.players.map(player => ({ ...player, accountId: 'secret', tokenHash: 'secret' })) })) } }
  const parsed = readAdminLeagueDetail(privateRaw)
  assert.deepEqual(parsed, raw.league); assert.equal(JSON.stringify(parsed).includes('secret'), false)
  for (const changed of [{ ...raw.league, standings: [] }, { ...raw.league, standings: raw.league.standings.map(row => ({ ...row, isOwner: false })) },
    { ...raw.league, standings: raw.league.standings.map(row => ({ ...row, winRate: Infinity })) },
    { ...raw.league, recentGames: [{ ...raw.league.recentGames[0], players: [{ ...raw.league.recentGames[0].players[0], memberId: 'stranger' }, raw.league.recentGames[0].players[1]] }] },
    { ...raw.league, recentGames: Array(51).fill(raw.league.recentGames[0]) }]) assert.equal(readAdminLeagueDetail({ ...raw, league: changed }), null)
})

test('league searches and details use only GET with the current account and same-origin proof', async t => {
  scope(t)
  const calls: { path: string; init?: RequestInit }[] = []
  const controller = new AdminLeaguesController({ onSessionExpired() {}, request: (async (path, init) => {
    calls.push({ path: String(path), init }); return Response.json(String(path).includes('?') ? list() : detail())
  }) as typeof fetch })
  await controller.load({ q: 'Liga & otra', gameType: 'pocha', status: 'closed', offset: 25 })
  const query = new URL(calls[0].path, 'https://nrn.example.test').searchParams
  assert.equal(query.get('q'), 'Liga & otra'); assert.equal(query.get('gameType'), 'pocha'); assert.equal(query.get('status'), 'closed'); assert.equal(query.get('offset'), '25')
  await controller.select('league-a')
  assert.equal(controller.getState().detail?.id, 'league-a')
  for (const call of calls) {
    assert(call.path.startsWith('/api/admin/leagues'))
    assert.equal(call.init?.method, undefined); assert.equal(call.init?.body, undefined)
    assert.equal(call.init?.credentials, 'same-origin'); assert.equal(new Headers(call.init?.headers).get('Authorization'), `Bearer ${TOKEN}`)
  }
})

test('a newer search aborts the old read and its late response cannot restore stale league data', async t => {
  scope(t)
  const old = pending(), fresh = pending(); let calls = 0; const signals: AbortSignal[] = []
  const controller = new AdminLeaguesController({ onSessionExpired() {}, request: (async (_path, init) => {
    signals.push(init!.signal!); return ++calls === 1 ? old.promise : fresh.promise
  }) as typeof fetch })
  const earlier = controller.load(filters), latest = controller.load({ ...filters, q: 'fresh' })
  assert.equal(signals[0].aborted, true)
  fresh.resolve(Response.json(list('league-fresh'))); await latest
  old.resolve(Response.json(list('league-old'))); await earlier
  assert.equal(controller.getState().list?.leagues[0].id, 'league-fresh')
})

test('switching league details aborts the old selection and clearing or reloading cannot revive it', async t => {
  scope(t)
  const old = pending(), fresh = pending(); let calls = 0
  const controller = new AdminLeaguesController({ onSessionExpired() {}, request: (async () => ++calls === 1 ? old.promise : fresh.promise) as typeof fetch })
  const earlier = controller.select('league-old'), latest = controller.select('league-new')
  fresh.resolve(Response.json(detail('league-new'))); await latest
  old.resolve(Response.json(detail('league-old'))); await earlier
  assert.equal(controller.getState().detail?.id, 'league-new')
  controller.clearSelection(); assert.equal(controller.getState().detail, null); assert.equal(controller.getState().selected, null)
})

test('permission loss clears league data and missing details remain recoverable without retrying writes', async t => {
  scope(t)
  let status = 200, expired = 0
  const controller = new AdminLeaguesController({ onSessionExpired: () => { expired++ }, request: (async (path) => status === 200 ? Response.json(String(path).includes('?') ? list() : detail()) : Response.json({ error: 'forbidden' }, { status })) as typeof fetch })
  await controller.load(filters); await controller.select('league-a')
  status = 404; await controller.select('league-a'); assert.equal(controller.getState().error, 'missing'); assert.equal(expired, 0)
  status = 403; await controller.load(filters)
  assert.equal(expired, 1); assert.equal(controller.getState().detail, null); assert.equal(controller.getState().list, null); assert.equal(controller.getState().selected, null)
})

test('cancelled detail responses and a different league payload cannot appear as the selected league', async t => {
  scope(t)
  const late = pending(); let calls = 0
  const controller = new AdminLeaguesController({ onSessionExpired() {}, request: (async () => ++calls === 1 ? late.promise : Response.json(detail('different-league'))) as typeof fetch })
  const request = controller.select('league-a'); controller.cancel(); late.resolve(Response.json(detail())); await request
  assert.equal(controller.getState().detail, null); assert.equal(controller.getState().selected, null)
  await controller.select('league-a'); assert.equal(controller.getState().detail, null); assert.equal(controller.getState().error, 'detail')
})
