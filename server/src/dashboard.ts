import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { AdminAuth, registerAdminSessions } from './adminAuth.js'
import type { GameRepository } from './recovery.js'
import type { DashboardRoom, DashboardSnapshot } from '../../shared/dashboard.js'

export interface RoomCleanupSelection {
  roomId: string
  expectedUpdatedAt: number
  expectedPhase: DashboardRoom['phase']
}
export type RoomCleanupResult = { ok: true; deletedRoomIds: string[] } |
  { ok: false; error: 'rooms_changed' | 'server_unavailable'; status: 409 | 503 }

const cleanupPath = '/api/admin/rooms/cleanup'
const roomPhases = new Set(['lobby', 'playing', 'round_end', 'game_end', 'auction', 'choosing_trump', 'bidding', 'hand_end'])
function parseCleanupSelection(value: unknown): RoomCleanupSelection[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('rooms' in value)) return null
  const rooms = value.rooms
  if (!Array.isArray(rooms) || rooms.length < 1 || rooms.length > 500) return null
  const seen = new Set<string>()
  for (const item of rooms) {
    if (!item || typeof item !== 'object' || Array.isArray(item) ||
      Object.keys(item).length !== 3 || typeof item.roomId !== 'string' || !/^\d{4}$/.test(item.roomId) ||
      !Number.isSafeInteger(item.expectedUpdatedAt) || item.expectedUpdatedAt < 0 ||
      typeof item.expectedPhase !== 'string' || !roomPhases.has(item.expectedPhase) || seen.has(item.roomId)) return null
    seen.add(item.roomId)
  }
  return rooms as RoomCleanupSelection[]
}

/** A separate, read-only view; never serialize a Room, snapshot, or session here. */
export function dashboardSnapshot(repository: GameRepository, isOnline: (playerId: string) => boolean): DashboardSnapshot {
  const rooms: DashboardRoom[] = []
  for (const roomId of repository.records.keys()) {
    const record = repository.get(roomId)
    if (!record || !record.room.players.length) continue
    const { room } = record
    const phase = room.pocha?.phase ?? room.phase
    const players = room.players.map(player => ({
      id: player.id, name: player.name, online: isOnline(player.id), host: player.id === room.players[0]?.id,
    }))
    const onlinePlayers = players.filter(player => player.online).length
    const hasTurn = onlinePlayers > 0 && !['lobby', 'round_end', 'hand_end', 'game_end'].includes(phase)
    const currentPlayerId = room.pocha
      ? (phase === 'choosing_trump' ? room.pocha.auctionWinnerId : room.pocha.players[room.pocha.currentPlayerIndex]?.id)
      : room.players[room.discardOptionPlayerIndex ?? room.currentPlayerIndex]?.id
    rooms.push({
      roomId, gameType: room.gameType, phase,
      round: phase === 'lobby' ? null : room.pocha?.handNumber ?? room.round,
      totalRounds: room.pocha?.schedule.length ?? 7,
      onlinePlayers, currentPlayerId: hasTurn ? currentPlayerId ?? null : null,
      updatedAt: record.updatedAt, players,
    })
  }
  rooms.sort((a, b) => Number(b.onlinePlayers > 0) - Number(a.onlinePlayers > 0) || b.updatedAt - a.updatedAt || a.roomId.localeCompare(b.roomId))
  return {
    generatedAt: Date.now(),
    summary: {
      onlinePlayers: rooms.reduce((sum, room) => sum + room.onlinePlayers, 0),
      activeRooms: rooms.filter(room => room.onlinePlayers > 0 && room.phase !== 'lobby' && room.phase !== 'game_end').length,
      waitingRooms: rooms.filter(room => room.onlinePlayers > 0 && room.phase === 'lobby').length,
      offlineRooms: rooms.filter(room => room.onlinePlayers === 0).length,
    },
    rooms,
  }
}

export function registerDashboard(app: Express, options: {
  key?: string
  origins?: string[]
  repository: GameRepository
  isHealthy: () => boolean
  isOnline: (playerId: string) => boolean
  cleanupRooms: (selection: RoomCleanupSelection[]) => Promise<RoomCleanupResult>
}) {
  // An unconfigured or weak key must never turn this into a public room listing.
  const auth = new AdminAuth(options.key, options.origins)
  registerAdminSessions(app, auth, options.isHealthy)
  app.get('/api/admin/dashboard', (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.set('X-Robots-Tag', 'noindex, nofollow')
    if (!auth.configured) { res.status(503).json({ error: 'dashboard_not_configured' }); return }
    if (!auth.authenticate(req)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    if (!options.isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    res.json(dashboardSnapshot(options.repository, options.isOnline))
  })
  app.post(cleanupPath, (req, res, next) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow')
    if (!auth.configured) { res.status(503).json({ error: 'dashboard_not_configured' }); return }
    if (!auth.authenticate(req)) { res.status(401).json({ error: 'unauthorized' }); return }
    if (!auth.allowWrite(req)) { res.status(403).json({ error: 'invalid_request' }); return }
    if (!options.isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    next()
  }, express.json({ limit: '64kb' }), async (req, res) => {
    const selection = req.is('application/json') ? parseCleanupSelection(req.body) : null
    if (!selection) { res.status(400).json({ error: 'invalid_request' }); return }
    try {
      const result = await options.cleanupRooms(selection)
      if (result.ok) res.json(result)
      else res.status(result.status).json({ ok: false, error: result.error })
    } catch {
      res.status(503).json({ ok: false, error: 'server_unavailable' })
    }
  })
  app.use(cleanupPath, (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) { next(error); return }
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large'
    res.set('Cache-Control', 'no-store').status(tooLarge ? 413 : 400).json({ error: 'invalid_request' })
  })
}
