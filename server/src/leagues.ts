import express, { type Express, type Request, type Response } from 'express'
import { randomBytes, randomUUID } from 'node:crypto'
import type { LeagueDetail, LeagueGame, LeagueGameType, LeagueStanding, LeagueSummary, RoomLeagueSummary } from '../../shared/leagues.js'
import type { MembershipAccount } from '../../shared/membership.js'
import type { DurableGameResult, PersonalMatch } from './personalStats.js'
import type { GameRepository } from './recovery.js'
import { initialLeagueRating, updateLeagueRatings, leagueRatingPoints } from './leagueRating.js'
import { RateLimiter, requestLimit } from './security.js'

export interface LeagueMember { id: string; accountId: string; name: string; joinedAt: number }
export interface StoredLeague {
  id: string
  name: string
  gameType: LeagueGameType
  ownerAccountId: string
  inviteCode: string
  createdAt: number
  closedAt: number | null
  minGames: number
  ratingVersion: 1
  members: LeagueMember[]
}
type Identity = Pick<MembershipAccount, 'id' | 'name'>
export class LeagueError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
const time = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const name = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
const game = (value: unknown): value is LeagueGameType => value === 'pocha' || value === 'continental'
const fail = (): never => { throw new Error('Invalid league storage; refusing to overwrite leagues') }

export function parseLeagues(value: unknown): Map<string, StoredLeague> {
  if (value === undefined) return new Map()
  if (!Array.isArray(value) || value.length > 2_000) return fail()
  const leagues = new Map<string, StoredLeague>(), codes = new Set<string>()
  const accountCounts = new Map<string, number>(), ownerCounts = new Map<string, number>()
  for (const raw of value) {
    if (!object(raw) || !id(raw.id) || leagues.has(raw.id) || !name(raw.name, 60) || !game(raw.gameType) || !id(raw.ownerAccountId) ||
        typeof raw.inviteCode !== 'string' || !/^[A-F0-9]{10}$/.test(raw.inviteCode) || codes.has(raw.inviteCode) || !time(raw.createdAt) ||
        !(raw.closedAt === null || (time(raw.closedAt) && raw.closedAt >= raw.createdAt)) || !Number.isSafeInteger(raw.minGames) ||
        Number(raw.minGames) < 1 || Number(raw.minGames) > 50 || raw.ratingVersion !== 1 || !Array.isArray(raw.members) || raw.members.length < 1 || raw.members.length > 200) return fail()
    const members = raw.members.map(member => {
      if (!object(member) || !id(member.id) || !id(member.accountId) || !name(member.name, 24) || !time(member.joinedAt) ||
          member.joinedAt < Number(raw.createdAt) || (raw.closedAt !== null && member.joinedAt > Number(raw.closedAt))) return fail()
      accountCounts.set(member.accountId, (accountCounts.get(member.accountId) ?? 0) + 1)
      if (accountCounts.get(member.accountId)! > 100) return fail()
      return { id: member.id, accountId: member.accountId, name: member.name, joinedAt: member.joinedAt }
    })
    if (new Set(members.map(m => m.id)).size !== members.length || new Set(members.map(m => m.accountId)).size !== members.length ||
        members.some(m => members.some(other => other.accountId === m.id)) ||
        !members.some(m => m.accountId === raw.ownerAccountId)) return fail()
    ownerCounts.set(raw.ownerAccountId, (ownerCounts.get(raw.ownerAccountId) ?? 0) + 1)
    if (ownerCounts.get(raw.ownerAccountId)! > 20) return fail()
    const league: StoredLeague = { id: raw.id, name: raw.name, gameType: raw.gameType, ownerAccountId: raw.ownerAccountId, inviteCode: raw.inviteCode,
      createdAt: raw.createdAt, closedAt: raw.closedAt as number | null, minGames: Number(raw.minGames), ratingVersion: 1, members }
    leagues.set(league.id, league); codes.add(league.inviteCode)
  }
  return leagues
}

export function makeLeague(leagues: Map<string, StoredLeague>, account: Identity, input: unknown, now = Date.now()): StoredLeague {
  if (!object(input)) throw new LeagueError('invalid_request')
  const leagueName = typeof input.name === 'string' ? input.name.trim() : null
  if (!name(leagueName, 60)) throw new LeagueError('invalid_league_name')
  if (!game(input.gameType)) throw new LeagueError('invalid_game_type')
  const minGames = input.minGames === undefined ? 5 : input.minGames
  if (!Number.isSafeInteger(minGames) || Number(minGames) < 1 || Number(minGames) > 50) throw new LeagueError('invalid_min_games')
  const all = [...leagues.values()]
  if (all.length >= 2_000 || all.filter(l => l.ownerAccountId === account.id).length >= 20 || all.filter(l => l.members.some(m => m.accountId === account.id)).length >= 100) throw new LeagueError('league_limit', 429)
  let inviteCode: string
  do { inviteCode = randomBytes(5).toString('hex').toUpperCase() } while (all.some(l => l.inviteCode === inviteCode))
  return { id: randomUUID(), name: leagueName, gameType: input.gameType, ownerAccountId: account.id, inviteCode, createdAt: now, closedAt: null,
    minGames: Number(minGames), ratingVersion: 1, members: [{ id: randomUUID(), accountId: account.id, name: name(account.name, 24) ? account.name : 'Jugador', joinedAt: now }] }
}

export function joinedLeague(leagues: Map<string, StoredLeague>, account: Identity, code: unknown, now = Date.now(), expectedGameType?: unknown): StoredLeague {
  if (expectedGameType !== undefined && !game(expectedGameType)) throw new LeagueError('invalid_game_type')
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : ''
  if (!/^[A-F0-9]{10}$/.test(normalized)) throw new LeagueError('invalid_invite_code')
  const league = [...leagues.values()].find(l => l.inviteCode === normalized)
  if (!league) throw new LeagueError('league_not_found', 404)
  if (expectedGameType !== undefined && league.gameType !== expectedGameType) throw new LeagueError('league_wrong_game', 409)
  if (league.members.some(m => m.accountId === account.id)) return league
  if (league.closedAt !== null) throw new LeagueError('league_closed', 409)
  if (league.members.length >= 200) throw new LeagueError('league_full', 409)
  if ([...leagues.values()].filter(l => l.members.some(m => m.accountId === account.id)).length >= 100) throw new LeagueError('league_limit', 429)
  return { ...league, members: [...league.members, { id: randomUUID(), accountId: account.id, name: name(account.name, 24) ? account.name : 'Jugador', joinedAt: now }] }
}

export function leagueSummary(league: StoredLeague, account: string, gameCount: number): LeagueSummary {
  return { id: league.id, name: league.name, gameType: league.gameType, createdAt: league.createdAt, closedAt: league.closedAt,
    minGames: league.minGames, memberCount: league.members.length, gameCount, isOwner: league.ownerAccountId === account }
}
export function roomLeagueSummary(league: StoredLeague): RoomLeagueSummary {
  return { id: league.id, name: league.name, gameType: league.gameType, closedAt: league.closedAt }
}
export function leagueSelectionError(league: StoredLeague | undefined, gameType: LeagueGameType, accountId: string | null): string | null {
  if (!league) return 'league_not_found'
  if (league.closedAt !== null) return 'league_closed'
  if (league.gameType !== gameType) return 'league_wrong_game'
  if (!accountId || !league.members.some(m => m.accountId === accountId)) return 'league_members_only'
  return null
}
export function leagueStartError(league: StoredLeague | undefined, gameType: LeagueGameType, accounts: (string | null)[], hasBots = false): string | null {
  const selectionError = leagueSelectionError(league, gameType, accounts[0] ?? null)
  if (selectionError) return selectionError
  if (hasBots || accounts.length < 2 || accounts.length > 10 || accounts.some(a => !a || !league!.members.some(m => m.accountId === a))) return 'league_members_only'
  if (new Set(accounts).size !== accounts.length) return 'league_duplicate_account'
  return null
}

export function validLeagueMatch(league: StoredLeague | undefined, gameType: LeagueGameType, match: Pick<PersonalMatch, 'startedAt' | 'participants'>): boolean {
  return !!league && league.gameType === gameType && match.startedAt >= league.createdAt &&
    (league.closedAt === null || match.startedAt <= league.closedAt) && match.participants.length >= 2 &&
    new Set(match.participants.map(p => p.accountId)).size === match.participants.length &&
    match.participants.every(p => p.accountId && league.members.some(m => m.accountId === p.accountId && m.joinedAt <= match.startedAt))
}
export function validateLeagueResult(league: StoredLeague | undefined, result: DurableGameResult): boolean {
  return validLeagueMatch(league, result.gameType, { startedAt: result.startedAt, participants: result.players.map((p, i) => ({ playerId: String(i), accountId: p.accountId, name: p.name })) })
}

type TableStanding = Omit<LeagueStanding, 'isMe'> & { accountId: string }
export interface LeagueTable { standings: TableStanding[]; recentGames: LeagueGame[]; gameCount: number }
/** Replay only the server's immutable, chronological result ledger. */
export function buildLeagueTable(league: StoredLeague, results: Iterable<DurableGameResult>): LeagueTable {
  const games = [...results].filter(r => r.leagueId === league.id).sort((a, b) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id))
  const ratings = new Map(league.members.map(m => [m.accountId, initialLeagueRating()]))
  const rows = new Map(league.members.map(m => [m.accountId, { accountId: m.accountId, memberId: m.id, name: m.name, rank: null as number | null,
    rating: 0, played: 0, wins: 0, draws: 0, losses: 0, winRate: 0, provisional: true }]))
  for (const result of games) {
    if (!validateLeagueResult(league, result)) throw new Error('Invalid league result participants')
    const updated = updateLeagueRatings(result.players.map(p => ({ id: p.accountId!, ...ratings.get(p.accountId!)!, position: p.position })))
    const winners = result.players.filter(p => p.position === 1).length
    for (const player of result.players) {
      ratings.set(player.accountId!, updated.get(player.accountId!)!)
      const row = rows.get(player.accountId!)!
      row.played++
      if (player.position !== 1) row.losses++
      else if (winners === 1) row.wins++
      else row.draws++
    }
  }
  for (const row of rows.values()) {
    row.rating = leagueRatingPoints(ratings.get(row.accountId)!)
    row.provisional = row.played < league.minGames
    row.winRate = row.played ? Math.round(row.wins / row.played * 1000) / 10 : 0
  }
  const standings = [...rows.values()].sort((a, b) => Number(a.provisional) - Number(b.provisional) || b.rating - a.rating || b.wins - a.wins || b.winRate - a.winRate || a.memberId.localeCompare(b.memberId))
  let rank = 0
  for (let i = 0; i < standings.length; i++) {
    const row = standings[i], previous = standings[i - 1]
    if (row.provisional) continue
    if (!previous || previous.rating !== row.rating || previous.wins !== row.wins || previous.winRate !== row.winRate) rank = i + 1
    row.rank = rank
  }
  const recentGames = games.slice(-50).reverse().map(result => ({ id: result.id, finishedAt: result.finishedAt, playerCount: result.players.length,
    players: result.players.map(p => ({ memberId: league.members.find(m => m.accountId === p.accountId)!.id, name: p.name, position: p.position, score: p.score })).sort((a, b) => a.position - b.position || a.memberId.localeCompare(b.memberId)) }))
  return { standings, recentGames, gameCount: games.length }
}
export function leagueDetail(league: StoredLeague, table: LeagueTable, account: string): LeagueDetail {
  return { ...leagueSummary(league, account, table.gameCount), inviteCode: league.inviteCode, ratingSystem: 'trueskill', ratingVersion: 1,
    standings: table.standings.map(({ accountId, ...row }) => ({ ...row, isMe: accountId === account })), recentGames: structuredClone(table.recentGames) }
}

export function registerLeagues(app: Express, options: {
  repository: GameRepository
  authenticate: (token: string) => MembershipAccount | null
  isHealthy: () => boolean
  runMutation: <T>(work: () => Promise<T>) => Promise<T>
}): void {
  const requests = requestLimit(new RateLimiter(120, 60_000))
  const creates = new RateLimiter(5, 60 * 60_000), joins = new RateLimiter(30, 60 * 60_000), writes = new RateLimiter(60, 60 * 60_000)
  app.use('/api/leagues', (req, res, next) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow')
    if (!options.isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    const auth = req.get('authorization') ?? ''
    const account = auth.startsWith('Bearer ') ? options.authenticate(auth.slice(7)) : null
    if (!account) { res.status(401).json({ error: 'unauthorized' }); return }
    res.locals.leagueAccount = account
    requests(req, res, next)
  })
  const run = (handler: (req: Request, res: Response, account: MembershipAccount) => unknown | Promise<unknown>) => (req: Request, res: Response) => {
    Promise.resolve().then(() => handler(req, res, res.locals.leagueAccount)).catch(error => {
      if (!res.headersSent) res.status(error instanceof LeagueError ? error.status : 503).json({ error: error instanceof LeagueError ? error.code : 'server_unavailable' })
    })
  }
  const budget = (limiter: RateLimiter, account: MembershipAccount, res: Response) => {
    const retry = limiter.take(account.id)
    if (retry) { res.set('Retry-After', String(retry)); throw new LeagueError('rate_limited', 429) }
  }
  const json = express.json({ limit: '2kb', inflate: false })
  app.get('/api/leagues', run((_req, res, account) => res.json({ leagues: options.repository.listLeagues(account.id) })))
  app.post('/api/leagues', json, run(async (req, res, account) => {
    budget(creates, account, res); budget(writes, account, res)
    const value = await options.runMutation(() => options.repository.createLeague(account, req.body))
    res.status(201).json(value)
  }))
  app.post('/api/leagues/join', json, run(async (req, res, account) => {
    budget(joins, account, res); budget(writes, account, res)
    res.json(await options.runMutation(() => options.repository.joinLeague(account, req.body?.code, req.body?.expectedGameType)))
  }))
  app.get('/api/leagues/:id', run((req, res, account) => {
    const value = options.repository.getLeagueDetail(req.params.id, account.id)
    if (!value) throw new LeagueError('league_not_found', 404)
    res.json(value)
  }))
  app.post('/api/leagues/:id/close', json, run(async (req, res, account) => {
    budget(writes, account, res)
    res.json(await options.runMutation(() => options.repository.closeLeague(req.params.id, account.id)))
  }))
  app.use('/api/leagues', (error: unknown, _req: Request, res: Response, _next: unknown) => {
    if (!res.headersSent) res.status(object(error) && error.type === 'entity.too.large' ? 413 : object(error) && error.type === 'encoding.unsupported' ? 415 : 400).json({ error: 'invalid_request' })
  })
}
