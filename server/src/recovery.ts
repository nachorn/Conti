import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { Room, type RoomSnapshot } from './room.js'
import type { SnapshotStore } from './storage.js'
import { restoreChat, type ChatMessage } from './roomChat.js'
import { finishedPersonalMatch, parseGameResults, parsePersonalMatch, personalMatchStillEligible, personalStats, type DurableGameResult, type PersonalMatch, type PersonalStatsResponse } from './personalStats.js'
import { buildLeagueTable, joinedLeague, leagueDetail, LeagueError, leagueSelectionError, leagueStartError, leagueSummary, makeLeague, parseLeagues, roomLeagueSummary, validLeagueMatch, validateLeagueResult, type LeagueTable, type StoredLeague } from './leagues.js'
import type { LeagueDetail, LeagueGameType, LeagueSummary, RoomLeagueSummary } from '../../shared/leagues.js'
import type { MembershipAccount } from '../../shared/membership.js'

export interface ResumeCredential { roomId: string; playerId: string; token: string }
interface SavedSession { playerId: string; tokenHash: string; bot?: boolean }
interface PausedTimers { turnRemainingMs: number | null; discardRemainingMs: number | null }
export interface RoomRecord {
  room: Room
  sessions: SavedSession[]
  updatedAt: number
  paused: PausedTimers | null
  manualPaused?: boolean
  chat?: ChatMessage[]
  /** Private account bindings for the current run, fixed before the first deal. */
  match?: PersonalMatch
  leagueId?: string
}
interface SavedRecord extends Omit<RoomRecord, 'room'> { room: RoomSnapshot }
interface SavedGames { version: 1 | 2 | 3; savedAt: number; rooms: SavedRecord[]; results?: DurableGameResult[]; leagues?: StoredLeague[] }

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const duration = (deadline: number | null, now: number) => deadline === null ? null : Math.max(0, deadline - now)
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const validDuration = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 120_000)

export function issueCredential(roomId: string): { credential: ResumeCredential; session: SavedSession } {
  const credential = { roomId, playerId: randomUUID(), token: randomBytes(32).toString('base64url') }
  return { credential, session: { playerId: credential.playerId, tokenHash: hashToken(credential.token) } }
}

export function parseCredential(value: unknown): ResumeCredential | null {
  if (!isObject(value) || typeof value.roomId !== 'string' || !/^\d{4}$/.test(value.roomId) ||
      typeof value.playerId !== 'string' || value.playerId.length > 64 ||
      typeof value.token !== 'string' || !/^[\w-]{43}$/.test(value.token)) return null
  return { roomId: value.roomId, playerId: value.playerId, token: value.token }
}

export function authenticate(record: RoomRecord, credential: ResumeCredential): boolean {
  const session = record.sessions.find(s => s.playerId === credential.playerId)
  return record.room.roomId === credential.roomId && !!session && !session.bot &&
    timingSafeEqual(Buffer.from(session.tokenHash, 'hex'), Buffer.from(hashToken(credential.token), 'hex'))
}

export function pauseRoom(record: RoomRecord, now = Date.now()): void {
  if (!record.paused) record.paused = {
    turnRemainingMs: duration(record.room.turnDeadline, now),
    discardRemainingMs: duration(record.room.discardOptionAvailableAt, now),
  }
  record.room.turnDeadline = null
  record.room.discardOptionAvailableAt = null
}

export function resumeRoom(record: RoomRecord, now = Date.now()): void {
  if (!record.paused) return
  const { turnRemainingMs, discardRemainingMs } = record.paused
  record.room.discardOptionAvailableAt = discardRemainingMs === null ? null : now + discardRemainingMs
  record.room.turnDeadline = turnRemainingMs === null ? null : now + Math.max(10_000, turnRemainingMs, discardRemainingMs ?? 0)
  record.paused = null
}

export function cloneRecord(record: RoomRecord): RoomRecord {
  return {
    room: Room.fromSnapshot(record.room.toSnapshot(), { disconnectPlayers: false }),
    sessions: record.sessions.map(s => ({ ...s })), updatedAt: record.updatedAt,
    paused: record.paused && { ...record.paused },
    manualPaused: record.manualPaused === true,
    chat: record.chat?.map(message => ({ ...message })) ?? [],
    ...(record.match ? { match: structuredClone(record.match) } : {}),
    ...(record.leagueId ? { leagueId: record.leagueId } : {}),
  }
}

/** One process owns this repository; callers serialize mutations and publishing. */
export class GameRepository {
  records = new Map<string, RoomRecord>()
  private results = new Map<string, DurableGameResult>()
  private leagues = new Map<string, StoredLeague>()
  private leagueTables = new Map<string, { league: StoredLeague; resultCount: number; table: LeagueTable }>()
  failed = false
  constructor(readonly store: SnapshotStore, readonly retentionMs = 30 * 24 * 60 * 60 * 1000) {}

  async load(now = Date.now()): Promise<void> {
    const saved = await this.store.load()
    if (saved === null) return
    if (!isObject(saved) || ![1, 2, 3].includes(saved.version as number) || typeof saved.savedAt !== 'number' ||
      !Number.isFinite(saved.savedAt) || saved.savedAt < 0 || !Array.isArray(saved.rooms) || saved.rooms.length > 500) {
      throw new Error('Invalid game storage snapshot; refusing to overwrite saved games')
    }
    const results = parseGameResults(saved.results)
    const leagues = parseLeagues(saved.leagues)
    if (leagues.size && saved.version !== 3) throw new Error('League storage requires snapshot format v3')
    for (const result of results.values()) {
      if (result.leagueId && !validateLeagueResult(leagues.get(result.leagueId), result)) throw new Error('Invalid saved league result')
    }
    const records = new Map<string, RoomRecord>()
    const seenCodes = new Set<string>()
    for (const raw of saved.rooms) {
      if (!isObject(raw) || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt < 0 ||
        !Array.isArray(raw.sessions) || raw.sessions.length > 10 ||
        (raw.manualPaused !== undefined && typeof raw.manualPaused !== 'boolean') ||
        !(raw.paused === null || (isObject(raw.paused) && validDuration(raw.paused.turnRemainingMs) && validDuration(raw.paused.discardRemainingMs)))) {
        throw new Error('Invalid saved room metadata')
      }
      const room = Room.fromSnapshot(raw.room)
      if (!/^\d{4}$/.test(room.roomId) || seenCodes.has(room.roomId)) throw new Error('Invalid or duplicate saved room code')
      seenCodes.add(room.roomId)
      const sessions: SavedSession[] = []
      for (const session of raw.sessions) {
        if (!isObject(session) || typeof session.playerId !== 'string' || typeof session.tokenHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(session.tokenHash) || (session.bot !== undefined && typeof session.bot !== 'boolean') ||
          (session.bot === true && room.gameType !== 'pocha') || sessions.some(s => s.playerId === session.playerId) ||
          !room.players.some(p => p.id === session.playerId)) throw new Error('Invalid saved player session')
        sessions.push({ playerId: session.playerId, tokenHash: session.tokenHash, ...(session.bot === true ? { bot: true } : {}) })
      }
      if (sessions.length !== room.players.length) throw new Error('Saved room is missing player sessions')
      const record: RoomRecord = { room, sessions, updatedAt: raw.updatedAt, paused: raw.paused as PausedTimers | null, manualPaused: raw.manualPaused === true }
      if (raw.leagueId !== undefined) {
        if (typeof raw.leagueId !== 'string' || !leagues.has(raw.leagueId) || leagues.get(raw.leagueId)!.gameType !== room.gameType) throw new Error('Invalid saved room league')
        record.leagueId = raw.leagueId
      }
      record.chat = restoreChat(raw.chat)
      const match = parsePersonalMatch(raw.match)
      if (match) {
        record.match = match
        if (match.eligible && !personalMatchStillEligible(record)) throw new Error('Invalid saved match participants')
        if (match.leagueId && !validLeagueMatch(leagues.get(match.leagueId), room.gameType, match)) throw new Error('Invalid saved league match')
      }
      // Freeze remaining time at the last committed action, not at startup.
      pauseRoom(record, saved.savedAt)
      if (now - record.updatedAt < this.retentionMs && room.players.length) records.set(room.roomId, record)
    }
    this.records = records
    this.results = results
    this.leagues = leagues
    this.leagueTables.clear()
  }

  newRoomCode(): string {
    const activeCodes = new Set([...this.records.keys()].filter(id => this.get(id)))
    if (activeCodes.size >= 500) throw new Error('Server has too many saved rooms. Please try again later.')
    let id: string
    do { id = String(randomInt(1000, 10000)) } while (activeCodes.has(id))
    return id
  }

  get(roomId: string): RoomRecord | undefined {
    const record = this.records.get(roomId)
    if (record && !record.room.players.some(p => p.connected) && Date.now() - record.updatedAt >= this.retentionMs) return undefined
    return record
  }

  async commit(roomId: string, record: RoomRecord | null): Promise<void> {
    if (this.failed) throw new Error('Game storage unavailable')
    const next = new Map(this.records)
    const results = new Map(this.results)
    if (record) {
      record.updatedAt = Date.now()
      if (record.match?.eligible && !personalMatchStillEligible(record)) record.match = { ...record.match, eligible: false }
      const result = finishedPersonalMatch(record)
      if (result && !results.has(result.id)) {
        if (result.leagueId && !validateLeagueResult(this.leagues.get(result.leagueId), result)) throw new Error('Invalid league result')
        results.set(result.id, result)
      }
      next.set(roomId, record)
    } else next.delete(roomId)
    for (const [id, item] of next) {
      if (!item.room.players.some(p => p.connected) && Date.now() - item.updatedAt >= this.retentionMs) next.delete(id)
    }
    await this.persist(next, results)
  }

  /** Caller validates the full selection in the same serialized queue as game actions. */
  async commitRemovalBatch(roomIds: readonly string[]): Promise<void> {
    if (this.failed) throw new Error('Game storage unavailable')
    const next = new Map(this.records)
    for (const roomId of roomIds) next.delete(roomId)
    // Remove exactly the selected rooms; keep every other record and timestamp intact.
    await this.persist(next)
  }

  getPersonalStats(accountId: string, limit = 50): PersonalStatsResponse {
    return personalStats(this.results.values(), accountId, limit)
  }

  getLeagueSummary(id: string): RoomLeagueSummary | null {
    const league = this.leagues.get(id)
    return league ? roomLeagueSummary(league) : null
  }

  validateLeagueSelection(id: string, gameType: LeagueGameType, accountId: string | null): string | null {
    return leagueSelectionError(this.leagues.get(id), gameType, accountId)
  }

  validateLeagueStart(id: string, gameType: LeagueGameType, accounts: (string | null)[], hasBots = false): string | null {
    return leagueStartError(this.leagues.get(id), gameType, accounts, hasBots)
  }

  listLeagues(accountId: string): LeagueSummary[] {
    return [...this.leagues.values()].filter(league => league.members.some(m => m.accountId === accountId))
      .sort((a, b) => Number(a.closedAt !== null) - Number(b.closedAt !== null) || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .map(league => leagueSummary(league, accountId, [...this.results.values()].filter(r => r.leagueId === league.id).length))
  }

  getLeagueDetail(id: string, accountId: string): LeagueDetail | null {
    const league = this.leagues.get(id)
    if (!league || !league.members.some(m => m.accountId === accountId)) return null
    let cached = this.leagueTables.get(id)
    if (!cached || cached.league !== league || cached.resultCount !== this.results.size) {
      cached = { league, resultCount: this.results.size, table: buildLeagueTable(league, this.results.values()) }
      this.leagueTables.set(id, cached)
    }
    return leagueDetail(league, cached.table, accountId)
  }

  /** Call these mutations only from the same application queue as game actions. */
  async createLeague(account: Pick<MembershipAccount, 'id' | 'name'>, input: unknown): Promise<LeagueDetail> {
    if (this.failed) throw new Error('Game storage unavailable')
    const league = makeLeague(this.leagues, account, input)
    const next = new Map(this.leagues).set(league.id, league)
    await this.persist(this.records, this.results, next)
    return this.getLeagueDetail(league.id, account.id)!
  }

  async joinLeague(account: Pick<MembershipAccount, 'id' | 'name'>, code: unknown): Promise<LeagueDetail> {
    if (this.failed) throw new Error('Game storage unavailable')
    const league = joinedLeague(this.leagues, account, code)
    if (league !== this.leagues.get(league.id)) await this.persist(this.records, this.results, new Map(this.leagues).set(league.id, league))
    return this.getLeagueDetail(league.id, account.id)!
  }

  async closeLeague(id: string, accountId: string): Promise<LeagueDetail> {
    if (this.failed) throw new Error('Game storage unavailable')
    const league = this.leagues.get(id)
    if (!league || !league.members.some(m => m.accountId === accountId)) throw new LeagueError('league_not_found', 404)
    if (league.ownerAccountId !== accountId) throw new LeagueError('league_owner_required', 403)
    if (league.closedAt === null) await this.persist(this.records, this.results, new Map(this.leagues).set(id, { ...league, closedAt: Date.now() }))
    return this.getLeagueDetail(id, accountId)!
  }

  /** Graceful shutdown must preserve permanent results as well as frozen rooms. */
  async saveShutdown(records: readonly RoomRecord[]): Promise<void> {
    if (this.failed) throw new Error('Game storage unavailable')
    await this.persist(new Map(records.map(record => [record.room.roomId, record])))
  }

  private async persist(next: Map<string, RoomRecord>, results = this.results, leagues = this.leagues): Promise<void> {
    // An older server accepts only v1. Once account bindings or permanent results
    // exist, v2 makes a rollback refuse startup instead of erasing those fields.
    const version = leagues.size ? 3 : results.size || [...next.values()].some(record => record.match) ? 2 : 1
    const saved: SavedGames = { version, savedAt: Date.now(), rooms: [...next.values()].map(r => ({
      ...r, room: r.room.toSnapshot(),
    })), ...(results.size ? { results: [...results.values()] } : {}), ...(leagues.size ? { leagues: [...leagues.values()] } : {}) }
    try { await this.store.save(saved) }
    catch (error) {
      // A lost database acknowledgement may have committed. Never continue from uncertain state.
      this.failed = true
      throw error
    }
    this.records = next
    this.results = results
    this.leagues = leagues
  }
}
