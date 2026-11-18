import assert from 'node:assert/strict'
import test from 'node:test'
import { isLeagueDetail, isLeagueInvitation, isLeagueList, isLeagueResultReceipt, isLeagueSummary } from '../src/lib/leagues.ts'
import { forgetLeagueInvite, leagueAccountHash, parseLeagueAccountTarget, readLeagueInvite, rememberLeagueInvite } from '../src/lib/leagueLinks.ts'

const summary = () => ({ id: 'league-1', name: 'Las cartas del domingo', gameType: 'pocha', createdAt: 1_000,
  closedAt: null, minGames: 5, memberCount: 2, gameCount: 2, isOwner: true })
const standing = (memberId: string, isMe: boolean) => ({ memberId, name: memberId === 'member-a' ? 'Ana' : 'Luis', rank: null,
  rating: -0.25, played: 2, wins: 1, draws: 1, losses: 0, winRate: 50, provisional: true, isMe })
const detail = () => ({ ...summary(), inviteCode: '012345ABCD', ratingSystem: 'trueskill', ratingVersion: 1,
  standings: [standing('member-a', true), standing('member-b', false)],
  recentGames: [{ id: 'game-2', finishedAt: 2_000, playerCount: 2, players: [
    { memberId: 'member-a', name: 'Ana', position: 1, score: -2 }, { memberId: 'member-b', name: 'Luis', position: 1, score: -2 },
  ] }] })

test('league responses support negative conservative ratings, provisional members, ties and closed history', () => {
  assert.equal(isLeagueSummary(summary()), true)
  assert.equal(isLeagueList({ leagues: [summary()] }), true)
  assert.equal(isLeagueDetail(detail()), true)
  assert.equal(isLeagueDetail({ ...detail(), closedAt: 3_000 }), true)
  const qualified = { ...detail(), minGames: 2, standings: detail().standings.map((row, index) => ({ ...row, rank: index + 1, provisional: false })) }
  assert.equal(isLeagueDetail(qualified), true)
})

test('a partial or duplicate league list is not shown as an empty successful response', () => {
  for (const value of [null, {}, { leagues: null }, { leagues: [summary(), summary()] },
    { leagues: [{ ...summary(), minGames: 0 }] }, { leagues: [{ ...summary(), gameType: 'other' }] },
    { leagues: [{ ...summary(), memberCount: 201 }] }, { leagues: [{ ...summary(), closedAt: 999 }] }]) {
    assert.equal(isLeagueList(value), false)
  }
  assert.equal(isLeagueList({ leagues: [] }), true)
})

test('malformed standings, membership references or history never render as a valid ranking', () => {
  const sample = detail()
  const invalid = [
    { ...sample, ratingVersion: 2 }, { ...sample, inviteCode: 'wrong-code' }, { ...sample, recentGames: null },
    { ...sample, standings: [] }, { ...sample, standings: [sample.standings[0], sample.standings[0]] },
    { ...sample, standings: sample.standings.map(row => ({ ...row, isMe: false })) },
    { ...sample, standings: sample.standings.map(row => ({ ...row, rating: NaN })) },
    { ...sample, standings: sample.standings.map(row => ({ ...row, played: 3 })) },
    { ...sample, standings: sample.standings.map(row => ({ ...row, provisional: false, rank: 1 })) },
    { ...sample, recentGames: [{ ...sample.recentGames[0], finishedAt: Number.MAX_SAFE_INTEGER }] },
    { ...sample, recentGames: [{ ...sample.recentGames[0], players: [] }] },
    { ...sample, recentGames: [{ ...sample.recentGames[0], players: sample.recentGames[0].players.map(row => ({ ...row, memberId: 'outsider' })) }] },
  ]
  for (const value of invalid) assert.equal(isLeagueDetail(value), false)
})

test('league and invitation links carry only valid game and league selections', () => {
  const invitation = { kind: 'invite', gameType: 'pocha', code: '012345ABCD' } as const
  const archived = { kind: 'league', gameType: 'continental', id: 'league-1', seasonId: 'original' } as const
  assert.deepEqual(parseLeagueAccountTarget(leagueAccountHash(invitation)), invitation)
  assert.deepEqual(parseLeagueAccountTarget(leagueAccountHash(archived)), archived)
  for (const invalid of ['#game=football&invite=012345ABCD', '#game=pocha&invite=012345ABCD&league=league-1',
    '#game=pocha&invite=garbage', '#game=pocha&league=../admin', '#game=pocha&league=league-1&season=../current',
    '#game=pocha&league=league-1&game=continental']) assert.equal(parseLeagueAccountTarget(invalid), null)
})

test('an unresolved invitation survives a reload in its tab, expires, and clears when handled', () => {
  const entries = new Map<string, string>()
  const storage = { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value) }, removeItem: (key: string) => { entries.delete(key) } }
  const invite = { kind: 'invite', gameType: 'pocha', code: '012345ABCD' } as const
  const now = 4_000_000
  assert.equal(rememberLeagueInvite(storage, invite, now), true)
  assert.deepEqual(readLeagueInvite(storage, now + 1), invite)
  assert.equal(readLeagueInvite(storage, now + 30 * 60 * 1000), null)
  assert.equal(readLeagueInvite(storage, now - 1), null)
  forgetLeagueInvite(storage)
  assert.equal(readLeagueInvite(storage, now + 1), null)
  assert.equal(rememberLeagueInvite({ ...storage, setItem: () => { throw new Error('storage is restricted') } }, invite, now), false)
})

test('an archived season can omit a member who joined later while the current season must include the viewer', () => {
  const seasons = [
    { id: 'original', name: null, startedAt: 1_000, endedAt: 3_000, gameCount: 2 },
    { id: 'current-season', name: 'Primavera', startedAt: 3_000, endedAt: null, gameCount: 0 },
  ]
  const archived = { ...detail(), isOwner: false, seasonId: 'original', activeSeasonId: 'current-season', seasons,
    standings: detail().standings.map(row => ({ ...row, isMe: false })) }
  assert.equal(isLeagueDetail(archived), true)
  const current = { ...archived, seasonId: 'current-season', gameCount: 0, recentGames: [],
    standings: archived.standings.map(row => ({ ...row, played: 0, wins: 0, draws: 0, winRate: 0, rating: 0 })) }
  assert.equal(isLeagueDetail(current), false)
  current.standings[0].isMe = true
  assert.equal(isLeagueDetail(current), true)
  assert.equal(isLeagueDetail({ ...archived, seasons: [seasons[0], seasons[0]] }), false)
  assert.equal(isLeagueDetail({ ...archived, gameCount: 3 }), false)
})

test('league invitations and receipts are validated before displaying private information', () => {
  assert.equal(isLeagueInvitation({ id: 'league-1', name: 'Domingo', gameType: 'pocha', isMember: false, closedAt: null }), true)
  assert.equal(isLeagueInvitation({ id: 'league-1', name: 'Domingo', gameType: 'football', isMember: false, closedAt: null }), false)
  const base = { matchId: 'match-1', league: { id: 'league-1', name: 'Domingo', gameType: 'pocha' } }
  assert.equal(isLeagueResultReceipt({ ...base, status: 'counted', rating: { before: 14.2, after: 16.8, change: 2.6 } }), true)
  assert.equal(isLeagueResultReceipt({ ...base, status: 'counted', rating: { before: 16.8, after: 14.2, change: 2.6 } }), false)
  assert.equal(isLeagueResultReceipt({ ...base, status: 'not_counted', reason: 'participants_changed' }), true)
  assert.equal(isLeagueResultReceipt({ ...base, status: 'not_counted', reason: 'anything_else' }), false)
})
