import { createHash, timingSafeEqual } from 'node:crypto'
import type { Express } from 'express'
import type { GameRepository } from './recovery.js'
import type { DashboardRoom, DashboardSnapshot } from '../../shared/dashboard.js'

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
  repository: GameRepository
  isHealthy: () => boolean
  isOnline: (playerId: string) => boolean
}) {
  // An unconfigured or weak key must never turn this into a public room listing.
  const key = options.key?.trim()
  const hash = (value: string) => createHash('sha256').update(value).digest()
  const expected = key && key.length >= 32 && key.length <= 256 ? hash(key) : null
  app.get('/api/admin/dashboard', (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.set('X-Robots-Tag', 'noindex, nofollow')
    if (!expected) { res.status(503).json({ error: 'dashboard_not_configured' }); return }
    const authorization = req.get('authorization') ?? ''
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
    if (!supplied || supplied.length > 256 || !timingSafeEqual(hash(supplied), expected)) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    if (!options.isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    res.json(dashboardSnapshot(options.repository, options.isOnline))
  })
}
