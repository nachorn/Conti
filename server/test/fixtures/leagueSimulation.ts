import assert from 'node:assert/strict'
import { Room } from '../../src/room.js'
import type { RoomRecord } from '../../src/recovery.js'
import { finishedPersonalMatch, parseGameResults, type DurableGameResult } from '../../src/personalStats.js'
import { buildLeagueTable, parseLeagues, type StoredLeague } from '../../src/leagues.js'
import { createPochaLobby, applyPochaAction, nextPochaRound } from '../../src/game/pocha/pochaEngine.js'
import { roundSchedule } from '../../src/game/pocha/pochaRules.js'
import type { Card } from '../../src/types.js'

export const SIMULATION_NAMES = ['Alba', 'Bruno', 'Carla', 'Dani', 'Eva'] as const
const BASE = Date.UTC(2026, 10, 1, 12)
const DAY = 86_400_000
const accountId = (index: number) => `simulation-account-${index}`
const seatId = (index: number) => `simulation-seat-${index}`
const ALL = [0, 1, 2, 3, 4]

export function simulationLeague(gameType: 'continental' | 'pocha'): StoredLeague {
  return { id: `simulation-${gameType}`, name: `Ejemplo ${gameType === 'pocha' ? 'Pocha' : 'Conti'}`, gameType,
    ownerAccountId: accountId(0), inviteCode: gameType === 'pocha' ? 'A1B2C3D4E5' : 'F1A2B3C4D5', createdAt: BASE, closedAt: null, minGames: 3, ratingVersion: 1,
    members: SIMULATION_NAMES.map((name, i) => ({ id: `simulation-member-${i}`, accountId: accountId(i), name, joinedAt: BASE })) }
}

const rounds = [
  { participants: ALL, winners: [0, 1, 2, 3, 0, 1, 2], low: [4], ordinary: true },
  { participants: ALL, winners: [1, 2, 1, 2, 1, 2, 1], low: [0, 4], ordinary: false },
  { participants: [0, 1, 2, 3], winners: [0, 2, 3, 0, 2, 3, 0], low: [1], ordinary: false },
  { participants: ALL, winners: [0, 3, 4, 0, 3, 4, 0], low: [1, 2], ordinary: false },
  { participants: ALL, winners: [0, 1, 2, 4, 0, 1, 2], low: [3], ordinary: false },
]

/** Declared final hands, scored by Room.endRound; this is not a played-match simulation. */
function continentalResult(league: StoredLeague, index: number): DurableGameResult {
  const fixture = rounds[index], room = new Room({ roomId: `18${String(index).padStart(2, '0')}`, gameType: 'continental' })
  for (const i of fixture.participants) room.addPlayer(seatId(i), SIMULATION_NAMES[i])
  const startedAt = BASE + (index + 1) * DAY
  const record: RoomRecord = { room, sessions: [], updatedAt: startedAt, paused: null, leagueId: league.id,
    match: { id: `simulation-conti-result-${index}`, startedAt, eligible: true, leagueId: league.id,
      participants: fixture.participants.map(i => ({ playerId: seatId(i), accountId: accountId(i), name: SIMULATION_NAMES[i] })) } }
  for (let round = 1; round <= 7; round++) {
    room.phase = 'playing'; room.round = round
    const winner = fixture.winners[round - 1]
    for (const i of fixture.participants) {
      const rank = fixture.low.includes(i) ? 2 : fixture.ordinary ? 13 : 0
      room.players.find(p => p.id === seatId(i))!.hand = i === winner ? [] : [{ id: `declared-${index}-${round}-${i}`, rank, suit: rank === 0 ? 'joker' : 'hearts' } satisfies Card]
    }
    room.endRound(seatId(winner), false)
  }
  const result = finishedPersonalMatch(record, startedAt + 60_000)
  assert(result, 'The real completed-history validator must accept all seven scored rounds')
  return result
}

const pochaHands = [
  { participants: ALL, winners: [0, 1, 2, 3] },
  { participants: ALL, winners: [1, 2, 3] },
  { participants: [0, 1, 2, 3], winners: [0, 2, 3] },
  { participants: ALL, winners: [0, 3, 4] },
  { participants: ALL, winners: [0, 1, 2, 4] },
]

/** Controlled one-card deals; bidding, legal plays, trick winners and scores use the real Pocha engine. */
function pochaResult(league: StoredLeague, index: number): DurableGameResult {
  const fixture = pochaHands[index], state = createPochaLobby(`19${String(index).padStart(2, '0')}`, 40)
  state.settings = { mode: 'normal', maxCards: 1, oneCardRounds: fixture.winners.length, peakRounds: 1 }
  state.schedule = roundSchedule(state.settings, fixture.participants.length, 40)
  state.hostId = seatId(fixture.participants[0]); state.handNumber = 1; state.dealerIndex = fixture.participants.length - 1
  state.players = fixture.participants.map((i, seatIndex) => ({ id: seatId(i), name: SIMULATION_NAMES[i], seatIndex, connected: true, score: 0, hand: [], bid: null, tricksWon: 0 }))
  const startedAt = BASE + (index + 1) * DAY
  for (let hand = 0; hand < fixture.winners.length; hand++) {
    const winner = fixture.winners[hand]
    state.phase = 'bidding'; state.cardsPerHand = 1; state.bids = {}; state.currentTrick = []; state.trickReviewUntil = null; state.trump = 'oros'
    state.originalLeadPlayerIndex = (state.dealerIndex + 1) % state.players.length
    state.leadPlayerIndex = state.originalLeadPlayerIndex; state.currentPlayerIndex = state.originalLeadPlayerIndex
    for (const [localIndex, i] of fixture.participants.entries()) Object.assign(state.players[localIndex], {
      bid: null, tricksWon: 0, hand: [{ id: `declared-pocha-${index}-${hand}-${i}`, suit: i === winner ? 'oros' : 'bastos', rank: i === winner ? 1 : 2 + localIndex }],
    })
    const now = startedAt + hand * 10_000
    while (state.phase === 'bidding') assert.equal(applyPochaAction(state, state.players[state.currentPlayerIndex].id, { type: 'bid', value: 0 }, now).ok, true)
    while (state.phase === 'playing') {
      const player = state.players[state.currentPlayerIndex]
      assert.equal(applyPochaAction(state, player.id, { type: 'play', cardId: player.hand[0].id }, now).ok, true)
    }
    assert.equal(state.history.at(-1)!.players.reduce((sum, p) => sum + p.tricksWon, 0), 1)
    if (state.phase === 'hand_end') nextPochaRound(state)
  }
  assert.equal(state.phase, 'game_end')
  const players = state.players.map(player => ({ accountId: accountId(fixture.participants.find(i => seatId(i) === player.id)!), name: player.name,
    score: player.score, position: 1 + state.players.filter(other => other.score > player.score).length }))
  return { id: `simulation-pocha-result-${index}`, leagueId: league.id, gameType: 'pocha', startedAt, finishedAt: startedAt + 60_000,
    deckSize: 40, settings: state.settings, players }
}

export function createLeagueSimulations() {
  return (['continental', 'pocha'] as const).map(gameType => {
    const league = simulationLeague(gameType)
    const results = Array.from({ length: 5 }, (_, index) => gameType === 'pocha' ? pochaResult(league, index) : continentalResult(league, index))
    parseLeagues([league]); parseGameResults(results)
    const stages = Array.from({ length: results.length + 1 }, (_, completed) => ({ completed,
      standings: buildLeagueTable(league, results.slice(0, completed)).standings.map(({ name, rank, rating, played, wins, draws, losses, winRate, provisional }) =>
        ({ name, rank, rating, played, wins, draws, losses, winRate, provisional })) }))
    return { gameType, minGames: league.minGames, league, results, stages }
  })
}
