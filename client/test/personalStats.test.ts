import assert from 'node:assert/strict'
import test from 'node:test'
import { isPersonalStats } from '../src/lib/personalStats.ts'

const zero = () => ({ played: 0, wins: 0, draws: 0, losses: 0, winRate: 0 })
const sample = () => ({ generatedAt: 2000, overall: { played: 3, wins: 1, draws: 1, losses: 1, winRate: 33.3 },
  byGame: { pocha: { played: 3, wins: 1, draws: 1, losses: 1, winRate: 33.3 }, continental: zero() },
  recentGames: [{ id: 'game-1', gameType: 'pocha', startedAt: 1000, finishedAt: 1500, playerCount: 2, score: -4, position: 1,
    outcome: 'draw', players: [{ name: 'Ana', score: -4, position: 1 }, { name: 'Luis', score: -4, position: 1 }] }] })

test('personal statistics accept empty history, negative Pocha scores and separately counted draws', () => {
  assert.equal(isPersonalStats({ generatedAt: 2000, overall: zero(), byGame: { pocha: zero(), continental: zero() }, recentGames: [] }), true)
  assert.equal(isPersonalStats(sample()), true)
})

test('malformed statistics never masquerade as a valid empty history', () => {
  for (const invalid of [null, {}, { ...sample(), recentGames: null }, { ...sample(), overall: { ...zero(), wins: 1 } },
    { ...sample(), overall: { ...sample().overall, winRate: NaN } }, { ...sample(), byGame: {} },
    { ...sample(), recentGames: [{ ...sample().recentGames[0], players: [] }] },
    { ...sample(), recentGames: [{ ...sample().recentGames[0], position: 3 }] },
    { ...sample(), recentGames: [{ ...sample().recentGames[0], finishedAt: Number.MAX_SAFE_INTEGER }] },
    { ...sample(), recentGames: Array(51).fill(sample().recentGames[0]) }]) assert.equal(isPersonalStats(invalid), false)
})
