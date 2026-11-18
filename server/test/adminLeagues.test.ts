import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test, { type TestContext } from 'node:test'
import { createGameServer } from '../src/app.js'
import { MembershipService } from '../src/membership.js'
import { buildLeagueTable, type StoredLeague } from '../src/leagues.js'
import { GameRepository } from '../src/recovery.js'
import type { SnapshotStore } from '../src/storage.js'
import type { DurableGameResult } from '../src/personalStats.js'

const NOW = Date.now(), MASTER = 'synthetic-leagues-admin-master-2026-only'
const TOKENS = ['A'.repeat(43), 'B'.repeat(43), 'C'.repeat(43)]
class MemoryStore implements SnapshotStore {
  saves = 0; healthy = true
  constructor(public value: any = null) {}
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value); this.saves++ }
  async close() {}
  isHealthy() { return this.healthy }
}
function data() {
  const leagues: StoredLeague[] = Array.from({ length: 57 }, (_, i) => ({ id: `league-${i}`, name: `Liga ${String(i).padStart(2, '0')}`,
    gameType: i % 2 ? 'continental' : 'pocha', createdAt: NOW - 10_000 + i, closedAt: i % 3 ? null : NOW - 100,
    ownerAccountId: i === 0 ? 'ordinary-account' : `private-account-${i}`, inviteCode: i.toString(16).padStart(10, '0').toUpperCase(), minGames: 2, ratingVersion: 1,
    members: [{ id: `member-${i}-a`, accountId: i === 0 ? 'ordinary-account' : `private-account-${i}`, name: `Owner ${i}`, joinedAt: NOW - 10_000 + i },
      { id: `member-${i}-b`, accountId: `private-other-${i}`, name: `Player ${i}`, joinedAt: NOW - 9_000 }] }))
  const results: DurableGameResult[] = Array.from({ length: 3 }, (_, i) => ({ id: `result-${i}`, gameType: 'pocha', leagueId: 'league-0', startedAt: NOW - 2_000 + i,
    finishedAt: NOW - 1_000 + i, players: [{ accountId: 'ordinary-account', name: 'Owner 0', score: 30, position: 1 },
      { accountId: 'private-other-0', name: 'Player 0', score: 10, position: 2 }] }))
  return { version: 3, savedAt: NOW, rooms: [], results, leagues }
}
async function harness(t: TestContext) {
  const gameData = data(), gameStore = new MemoryStore(gameData)
  const accounts = ['admin-a', 'admin-b', 'ordinary'].map((email, i) => ({ id: i === 2 ? 'ordinary-account' : `admin-account-${i}`, email: `${email}@example.test`, name: email, createdAt: NOW - 1000 }))
  const membershipStore = new MemoryStore({ version: 1, accounts, sessions: TOKENS.map((token, i) => ({ accountId: accounts[i].id,
    tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: NOW + 60_000 })), challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [], bmcSubscriptions: [], plusAudit: [] })
  const membership = await new MembershipService({ store: membershipStore, authSecret: 'synthetic-league-membership-secret-2026',
    dashboardKey: MASTER, adminEmails: accounts.slice(0, 2).map(account => account.email) }).load()
  const server = await createGameServer(gameStore, { membership, dashboardKey: MASTER, footballAdmin: { read: async () => ({ available: false, stale: false, report: null }) } })
  const port = await server.listen(0, '127.0.0.1')
  t.after(async () => { await server.close(); await membership.close() })
  const call = (path: string, token: string | null = TOKENS[0], method = 'GET') => fetch(`http://127.0.0.1:${port}${path}`, { method, redirect: 'error', headers: token ? { Authorization: `Bearer ${token}` } : {} })
  return { call, gameData, gameStore, membershipStore, server }
}

test('admin leagues and details require one of the verified admin accounts, never a master key, forged flag or ordinary league owner', async t => {
  const h = await harness(t)
  for (const path of ['/api/admin/leagues', '/api/admin/leagues/league-0']) {
    for (const [token, status] of [[null, 401], [MASTER, 401], [TOKENS[2], 403], [TOKENS[0], 200], [TOKENS[1], 200]] as const) {
      const response = await h.call(path, token)
      assert.equal(response.status, status); assert.equal(response.headers.get('cache-control'), 'no-store')
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await h.call(path, TOKENS[0], method)).status, 404)
  }
  h.membershipStore.healthy = false
  assert.equal((await h.call('/api/admin/leagues')).status, 503)
  assert.equal((await h.call('/api/admin/leagues/league-0')).status, 503)
})

test('league list searches and filters across all owners, uses bounded pagination and never persists or exposes membership credentials', async t => {
  const h = await harness(t), before = structuredClone(h.gameStore.value), gameSaves = h.gameStore.saves, accountSaves = h.membershipStore.saves
  const first: any = await (await h.call('/api/admin/leagues')).json()
  assert.equal(first.total, 57); assert.equal(first.filtered, 57); assert.equal(first.limit, 25); assert.equal(first.leagues.length, 25)
  assert.equal(first.leagues[0].name, 'Liga 56')
  const second: any = await (await h.call('/api/admin/leagues?offset=25')).json()
  assert.equal(second.offset, 25); assert.equal(second.leagues.length, 25)
  assert.equal(first.leagues.some((a: any) => second.leagues.some((b: any) => a.id === b.id)), false)
  const capped: any = await (await h.call('/api/admin/leagues?limit=999')).json(); assert.equal(capped.limit, 50); assert.equal(capped.leagues.length, 50)
  const filtered: any = await (await h.call('/api/admin/leagues?gameType=pocha&status=closed&q=liga')).json()
  assert.equal(filtered.filtered, 10); assert(filtered.leagues.every((league: any) => league.gameType === 'pocha' && league.closedAt !== null))
  const owner: any = await (await h.call('/api/admin/leagues?q=Owner%200')).json()
  assert.equal(owner.filtered, 1); assert.equal(owner.leagues[0].gameCount, 3)
  const empty: any = await (await h.call('/api/admin/leagues?offset=999999999&q=missing')).json(); assert.deepEqual(empty.leagues, [])
  const encoded = JSON.stringify([first, second, filtered, owner])
  for (const field of ['inviteCode', 'accountId', 'ownerAccountId', 'private-account', 'private-other', '@example.test', 'tokenHash', 'passwordHash']) assert.equal(encoded.includes(field), false, field)
  assert.equal(h.gameStore.saves, gameSaves); assert.equal(h.membershipStore.saves, accountSaves)
  assert.deepEqual(h.gameStore.value, before, 'read-only lists cannot update a snapshot, room timestamp or retention')
})

test('admin detail replays the real standings without requiring league membership and explicitly redacts every nested row', async t => {
  const h = await harness(t), before = structuredClone(h.gameStore.value), saves = h.gameStore.saves
  assert.equal(h.server.repository.getLeagueDetail('league-0', 'admin-account-0'), null, 'the admin is not a league member')
  const body: any = await (await h.call('/api/admin/leagues/league-0')).json()
  const expected = buildLeagueTable(h.gameData.leagues[0], h.gameData.results), league = body.league
  assert.equal(league.gameCount, 3); assert.equal(league.memberCount, 2); assert.equal(league.ratingSystem, 'trueskill')
  assert.deepEqual(league.standings, expected.standings.map(({ accountId, ...row }) => ({ ...row,
    joinedAt: h.gameData.leagues[0].members.find(member => member.id === row.memberId)!.joinedAt, isOwner: accountId === 'ordinary-account' })))
  assert.deepEqual(league.recentGames, expected.recentGames)
  const encoded = JSON.stringify(body)
  for (const field of ['inviteCode', 'accountId', 'ownerAccountId', 'private-account', 'private-other', 'ordinary-account', '@example.test', 'tokenHash', 'passwordHash', 'isMe']) assert.equal(encoded.includes(field), false, field)
  assert.equal(h.gameStore.saves, saves); assert.deepEqual(h.gameStore.value, before)
  const restored = new GameRepository(h.gameStore); await restored.load()
  assert.deepEqual(restored.getAdminLeagueDetail('league-0'), league)
})

test('league reads reject ambiguous or malformed filters and IDs and distinguish missing leagues without leaking data', async t => {
  const h = await harness(t)
  for (const query of ['q=a&q=b', 'q[x]=a', 'gameType=pocha&gameType=continental', 'gameType=football', 'status=other', 'status=all&status=active',
    'offset=-1', 'offset=1.5', 'offset=9999999999', 'limit=0', 'limit=1&limit=2', 'q=%00', `q=${'x'.repeat(101)}`]) {
    const response = await h.call(`/api/admin/leagues?${query}`)
    assert.equal(response.status, 400, query); assert.deepEqual(await response.json(), { error: 'invalid_request' })
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  for (const id of ['constructor', '__proto__', 'prototype', '%2Fbad', 'x'.repeat(201)]) assert.equal((await h.call(`/api/admin/leagues/${id}`)).status, 400)
  const missing = await h.call('/api/admin/leagues/not-found'); assert.equal(missing.status, 404); assert.deepEqual(await missing.json(), { error: 'league_not_found' })
})
