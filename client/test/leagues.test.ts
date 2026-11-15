import assert from 'node:assert/strict'
import test from 'node:test'
import { isLeagueDetail, isLeagueList, isLeagueSummary } from '../src/lib/leagues.ts'

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
