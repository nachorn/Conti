import type { Express } from 'express'
import type { RoomInviteInfo } from '../../shared/roomInvite.js'
import type { GameRepository } from './recovery.js'

export function registerRoomInvites(app: Express, repository: GameRepository, isHealthy: () => boolean) {
  app.get('/api/rooms/:roomId/invite', (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    const roomId = req.params.roomId
    const room = /^\d{4}$/.test(roomId) ? repository.get(roomId)?.room : undefined
    const host = room?.players[0]
    if (!room || !host) { res.status(404).json({ error: 'room_not_found' }); return }
    // Construct a small public response; never serialize a room, seat IDs or credentials.
    const invite: RoomInviteInfo = {
      roomId: room.roomId, gameType: room.gameType, hostName: host.name,
      playerCount: room.players.length, maxPlayers: room.maxPlayers,
      status: room.phase !== 'lobby' ? 'started' : room.players.length >= room.maxPlayers ? 'full' : 'open',
    }
    res.json(invite)
  })
}
