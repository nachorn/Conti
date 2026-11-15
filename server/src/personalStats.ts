import { randomUUID } from 'node:crypto'
import type { Express } from 'express'
import type { PersonalGameResult, PersonalStats, PersonalStatsTotals } from '../../shared/personalStats.js'
import { isPochaDeckSize, type PochaDeckSize, type PochaSettings } from './game/pocha/pochaTypes.js'
import { roundSchedule } from './game/pocha/pochaRules.js'
import type { GameRepository, RoomRecord } from './recovery.js'

export interface MatchParticipant { playerId: string; accountId: string | null; name: string }
export interface PersonalMatch {
  id: string
  startedAt: number
  participants: MatchParticipant[]
  eligible: boolean
  /** Selected league is pinned before the deal, never inferred from later joins. */
  leagueId?: string
}
export interface DurableGameResult {
  id: string
  gameType: 'pocha' | 'continental'
  startedAt: number
  finishedAt: number
  players: { accountId: string | null; name: string; score: number; position: number }[]
  deckSize?: PochaDeckSize
  deckCount?: 2 | 3
  settings?: PochaSettings
  leagueId?: string
}

// The client contract stays independent of runtime rule sources. The server
// retains its optional metadata without duplicating the rules' exact types.
type PersonalGameWithMetadata = PersonalGameResult & Pick<DurableGameResult, 'deckSize' | 'deckCount' | 'settings'>
export type PersonalStatsResponse = Omit<PersonalStats, 'recentGames'> & { recentGames: PersonalGameWithMetadata[] }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v)
const validName = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 24
const validTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const fail = (): never => { throw new Error('Invalid personal statistics storage') }
const accountId = (v: unknown): string | null => v === null ? null : validId(v) ? v : fail()
const uniqueAccounts = (players: { accountId: string | null }[]) => {
  const accounts = players.flatMap(p => p.accountId === null ? [] : [p.accountId])
  return accounts.length > 0 && new Set(accounts).size === accounts.length
}
const positions = (scores: number[], gameType: DurableGameResult['gameType']) => scores.map(score => 1 + scores.filter(other => gameType === 'pocha' ? other > score : other < score).length)

/** Pin only authenticated account IDs at game start; guests remain guests for this game. */
export function beginPersonalMatch(record: RoomRecord, accounts: Record<string, string | null>, now = Date.now()): void {
  const participants = record.room.players.map(player => ({
    playerId: player.id, accountId: validId(accounts[player.id]) ? accounts[player.id] : null, name: player.name,
  }))
  record.match = {
    id: randomUUID(), startedAt: now, participants,
    eligible: participants.length >= 2 && record.room.players.every(p => p.connected) && !record.sessions.some(s => s.bot) && uniqueAccounts(participants),
    ...(record.leagueId ? { leagueId: record.leagueId } : {}),
  }
}

export function parsePersonalMatch(value: unknown): PersonalMatch | undefined {
  if (value === undefined) return undefined
  if (!object(value) || !validId(value.id) || !validTime(value.startedAt) || typeof value.eligible !== 'boolean' ||
      (value.leagueId !== undefined && !validId(value.leagueId)) ||
      !Array.isArray(value.participants) || value.participants.length < 2 || value.participants.length > 10) return fail()
  const participants = value.participants.map(raw => {
    if (!object(raw) || !validId(raw.playerId) || !validName(raw.name)) return fail()
    return { playerId: raw.playerId, accountId: accountId(raw.accountId), name: raw.name }
  })
  if (new Set(participants.map(p => p.playerId)).size !== participants.length || (value.eligible && !uniqueAccounts(participants))) return fail()
  return { id: value.id, startedAt: value.startedAt, eligible: value.eligible, participants,
    ...(value.leagueId === undefined ? {} : { leagueId: value.leagueId as string }) }
}

function cleanSettings(value: unknown, players: number, deckSize: PochaDeckSize = 48): PochaSettings {
  if (!object(value)) return fail()
  const settings: PochaSettings = {
    mode: value.mode as PochaSettings['mode'], maxCards: value.maxCards as number,
    oneCardRounds: value.oneCardRounds as number, peakRounds: value.peakRounds as number,
  }
  for (const key of ['oneCardRoundsEnd', 'exactBidPoints', 'trickPoints', 'missPenalty', 'auctionWithRemainder'] as const) {
    if (value[key] !== undefined) Object.assign(settings, { [key]: value[key] })
  }
  // Older results can omit deck metadata; 48 retains their broadest valid limit.
  roundSchedule(settings, players, deckSize)
  return settings
}

export function parseGameResults(value: unknown): Map<string, DurableGameResult> {
  if (value === undefined) return new Map()
  if (!Array.isArray(value) || value.length > 100_000) return fail()
  const results = new Map<string, DurableGameResult>()
  for (const raw of value) {
    if (!object(raw) || !validId(raw.id) || results.has(raw.id) || !validTime(raw.startedAt) || !validTime(raw.finishedAt) ||
        raw.finishedAt < raw.startedAt || (raw.gameType !== 'pocha' && raw.gameType !== 'continental') ||
        !Array.isArray(raw.players) || raw.players.length < 2 || raw.players.length > 10) return fail()
    const rawPlayers = raw.players
    const players = rawPlayers.map(player => {
      if (!object(player) || !validName(player.name) || !Number.isSafeInteger(player.score) ||
          !Number.isSafeInteger(player.position) || (player.position as number) < 1 || (player.position as number) > rawPlayers.length) return fail()
      return { accountId: accountId(player.accountId), name: player.name, score: player.score as number, position: player.position as number }
    })
    if (!uniqueAccounts(players)) return fail()
    const expected = positions(players.map(p => p.score), raw.gameType)
    if (players.some((p, i) => p.position !== expected[i])) return fail()
    const result: DurableGameResult = { id: raw.id, gameType: raw.gameType, startedAt: raw.startedAt, finishedAt: raw.finishedAt, players }
    if (raw.leagueId !== undefined) {
      if (!validId(raw.leagueId)) return fail()
      result.leagueId = raw.leagueId
    }
    if (raw.deckSize !== undefined) {
      if (raw.gameType !== 'pocha' || !isPochaDeckSize(raw.deckSize)) return fail()
      result.deckSize = raw.deckSize
    }
    if (raw.deckCount !== undefined) {
      if (raw.gameType !== 'continental' || (raw.deckCount !== 2 && raw.deckCount !== 3)) return fail()
      result.deckCount = raw.deckCount
    }
    if (raw.settings !== undefined) {
      if (raw.gameType !== 'pocha') return fail()
      result.settings = cleanSettings(raw.settings, players.length, result.deckSize)
    }
    results.set(result.id, result)
  }
  return results
}

/** A departure or a test bot makes the entire run ineligible, even if play continues. */
export function personalMatchStillEligible(record: RoomRecord): boolean {
  const match = record.match
  if (!match?.eligible || record.sessions.some(s => s.bot) || record.room.players.length !== match.participants.length) return false
  const ids = new Set(record.room.players.map(p => p.id))
  return match.participants.every(p => ids.has(p.playerId)) && uniqueAccounts(match.participants)
}

/** Results are derived from completed server history, never from a client payload. */
export function finishedPersonalMatch(record: RoomRecord, now = Date.now()): DurableGameResult | null {
  const room = record.room, match = record.match
  if (!match || !personalMatchStillEligible(record) || room.phase !== 'game_end' || now < match.startedAt) return null
  const sameIds = (ids: string[]) => ids.length === match.participants.length && new Set(ids).size === ids.length && match.participants.every(p => ids.includes(p.playerId))
  const finalScores = new Map(room.players.map(p => [p.id, p.score]))
  if (room.pocha) {
    const s = room.pocha
    if (s.phase !== 'game_end' || s.history.length !== s.schedule.length || s.handNumber !== s.schedule.length || !s.schedule.length) return null
    const running = new Map(match.participants.map(p => [p.playerId, 0]))
    for (let i = 0; i < s.history.length; i++) {
      const round = s.history[i]
      if (round.handNumber !== i + 1 || round.cardsPerHand !== s.schedule[i] || !sameIds(round.players.map(p => p.id))) return null
      for (const player of round.players) {
        const total = running.get(player.id)! + player.points
        if (!Number.isSafeInteger(total) || total !== player.total) return null
        running.set(player.id, total)
      }
    }
    if (!sameIds(s.players.map(p => p.id)) || s.players.some(p => p.hand.length !== 0 || p.score !== finalScores.get(p.id) || p.score !== running.get(p.id))) return null
  } else {
    if (room.round !== 7 || room.roundHistory.length !== 7) return null
    const running = new Map(match.participants.map(p => [p.playerId, 0]))
    for (let i = 0; i < room.roundHistory.length; i++) {
      const round = room.roundHistory[i]
      if (round.round !== i + 1 || !sameIds(Object.keys(round.scores)) || !sameIds(Object.keys(round.totals))) return null
      for (const participant of match.participants) {
        const total = running.get(participant.playerId)! + round.scores[participant.playerId]
        if (!Number.isSafeInteger(total) || total !== round.totals[participant.playerId]) return null
        running.set(participant.playerId, total)
      }
    }
    if (room.players.some(p => p.score !== running.get(p.id))) return null
  }
  const ranks = positions(match.participants.map(p => finalScores.get(p.playerId)!), room.gameType)
  return {
    id: match.id, gameType: room.gameType, startedAt: match.startedAt, finishedAt: now,
    players: match.participants.map((p, i) => ({ accountId: p.accountId, name: p.name, score: finalScores.get(p.playerId)!, position: ranks[i] })),
    ...(match.leagueId ? { leagueId: match.leagueId } : {}),
    ...(room.pocha ? { deckSize: room.pocha.deckSize, settings: cleanSettings(room.pocha.settings, match.participants.length, room.pocha.deckSize) } : { deckCount: room.deckCount }),
  }
}

export function personalStats(results: Iterable<DurableGameResult>, account: string, limit = 50, now = Date.now()): PersonalStatsResponse {
  const empty = (): PersonalStatsTotals => ({ played: 0, wins: 0, draws: 0, losses: 0, winRate: 0 })
  const overall = empty(), byGame = { pocha: empty(), continental: empty() }
  const recentGames: PersonalGameWithMetadata[] = []
  const all = [...results].filter(result => result.players.some(p => p.accountId === account)).sort((a, b) => b.finishedAt - a.finishedAt || a.id.localeCompare(b.id))
  const recentLimit = Number.isSafeInteger(limit) ? Math.max(0, Math.min(50, limit)) : 50
  for (const result of all) {
    const me = result.players.find(p => p.accountId === account)!
    const outcome = me.position !== 1 ? 'loss' : result.players.filter(p => p.position === 1).length > 1 ? 'draw' : 'win'
    for (const totals of [overall, byGame[result.gameType]]) {
      totals.played++
      if (outcome === 'win') totals.wins++
      else if (outcome === 'draw') totals.draws++
      else totals.losses++
    }
    if (recentGames.length < recentLimit) recentGames.push({
      id: result.id, gameType: result.gameType, startedAt: result.startedAt, finishedAt: result.finishedAt,
      playerCount: result.players.length, score: me.score, position: me.position, outcome,
      players: result.players.map(({ name, score, position }) => ({ name, score, position })),
      ...(result.deckSize ? { deckSize: result.deckSize } : {}),
      ...(result.deckCount ? { deckCount: result.deckCount } : {}),
      ...(result.settings ? { settings: structuredClone(result.settings) } : {}),
    })
  }
  for (const totals of [overall, byGame.pocha, byGame.continental]) totals.winRate = totals.played ? Math.round(totals.wins / totals.played * 1000) / 10 : 0
  return { generatedAt: now, overall, byGame, recentGames }
}

export function registerPersonalStats(app: Express, options: {
  repository: GameRepository
  authenticate: (token: string) => string | null
  isHealthy: () => boolean
}): void {
  app.get('/api/membership/stats', (req, res) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow')
    if (!options.isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    const authorization = req.get('authorization') ?? ''
    const account = authorization.startsWith('Bearer ') ? options.authenticate(authorization.slice(7)) : null
    if (!account) { res.status(401).json({ error: 'unauthorized' }); return }
    res.json(options.repository.getPersonalStats(account))
  })
}
