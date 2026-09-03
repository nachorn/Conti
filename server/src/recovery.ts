import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { Room, type RoomSnapshot } from './room.js'
import type { SnapshotStore } from './storage.js'

export interface ResumeCredential { roomId: string; playerId: string; token: string }
interface SavedSession { playerId: string; tokenHash: string }
interface PausedTimers { turnRemainingMs: number | null; discardRemainingMs: number | null }
export interface RoomRecord {
  room: Room
  sessions: SavedSession[]
  updatedAt: number
  paused: PausedTimers | null
}
interface SavedRecord extends Omit<RoomRecord, 'room'> { room: RoomSnapshot }
interface SavedGames { version: 1; savedAt: number; rooms: SavedRecord[] }

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
  return record.room.roomId === credential.roomId && !!session &&
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
  }
}

/** One process owns this repository; callers serialize mutations and publishing. */
export class GameRepository {
  records = new Map<string, RoomRecord>()
  failed = false
  constructor(readonly store: SnapshotStore, readonly retentionMs = 72 * 60 * 60 * 1000) {}

  async load(now = Date.now()): Promise<void> {
    const saved = await this.store.load()
    if (saved === null) return
    if (!isObject(saved) || saved.version !== 1 || typeof saved.savedAt !== 'number' ||
      !Number.isFinite(saved.savedAt) || saved.savedAt < 0 || !Array.isArray(saved.rooms) || saved.rooms.length > 500) {
      throw new Error('Invalid game storage snapshot; refusing to overwrite saved games')
    }
    const records = new Map<string, RoomRecord>()
    const seenCodes = new Set<string>()
    for (const raw of saved.rooms) {
      if (!isObject(raw) || typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt) || raw.updatedAt < 0 ||
        !Array.isArray(raw.sessions) || raw.sessions.length > 10 ||
        !(raw.paused === null || (isObject(raw.paused) && validDuration(raw.paused.turnRemainingMs) && validDuration(raw.paused.discardRemainingMs)))) {
        throw new Error('Invalid saved room metadata')
      }
      const room = Room.fromSnapshot(raw.room)
      if (!/^\d{4}$/.test(room.roomId) || seenCodes.has(room.roomId)) throw new Error('Invalid or duplicate saved room code')
      seenCodes.add(room.roomId)
      const sessions: SavedSession[] = []
      for (const session of raw.sessions) {
        if (!isObject(session) || typeof session.playerId !== 'string' || typeof session.tokenHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(session.tokenHash) || sessions.some(s => s.playerId === session.playerId) ||
          !room.players.some(p => p.id === session.playerId)) throw new Error('Invalid saved player session')
        sessions.push({ playerId: session.playerId, tokenHash: session.tokenHash })
      }
      if (sessions.length !== room.players.length) throw new Error('Saved room is missing player sessions')
      const record: RoomRecord = { room, sessions, updatedAt: raw.updatedAt, paused: raw.paused as PausedTimers | null }
      // Freeze remaining time at the last committed action, not at startup.
      pauseRoom(record, saved.savedAt)
      if (now - record.updatedAt < this.retentionMs && room.players.length) records.set(room.roomId, record)
    }
    this.records = records
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
    if (record) { record.updatedAt = Date.now(); next.set(roomId, record) } else next.delete(roomId)
    for (const [id, item] of next) {
      if (!item.room.players.some(p => p.connected) && Date.now() - item.updatedAt >= this.retentionMs) next.delete(id)
    }
    const saved: SavedGames = { version: 1, savedAt: Date.now(), rooms: [...next.values()].map(r => ({
      ...r, room: r.room.toSnapshot(),
    })) }
    try { await this.store.save(saved) }
    catch (error) {
      // A lost database acknowledgement may have committed. Never continue from uncertain state.
      this.failed = true
      throw error
    }
    this.records = next
  }
}
