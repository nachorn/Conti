import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import { Room } from './room.js'

const app = express()
app.use(cors({ origin: true }))
app.use(express.json())

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: true },
  transports: ['websocket', 'polling'],
})

const rooms = new Map<string, Room>()
const playerToRoom = new Map<string, string>()

function generateRoomId(): string {
  let id: string
  do {
    id = String(1000 + Math.floor(Math.random() * 9000))
  } while (rooms.has(id))
  return id
}

async function broadcastState(roomId: string): Promise<void> {
  const room = rooms.get(roomId)
  if (!room) return
  const sockets = await io.in(roomId).fetchSockets()
  for (const sock of sockets) {
    sock.emit('state', room.getState(sock.id))
  }
}

io.on('connection', (socket) => {
  const playerId = socket.id
  let roomId: string | null = null

  socket.on('create', (payload: { name: string; deckCount?: 2 | 3; discardOptionDelaySeconds?: number; secondsPerTurn?: number }) => {
    const deckCount = payload?.deckCount === 3 ? 3 : 2
    const newRoomId = generateRoomId()
    const room = new Room({
      roomId: newRoomId,
      maxPlayers: 10,
      deckCount,
      discardOptionDelaySeconds: payload?.discardOptionDelaySeconds,
      secondsPerTurn: payload?.secondsPerTurn,
    })
    room.addPlayer(playerId, payload?.name ?? 'Player')
    rooms.set(room.roomId, room)
    playerToRoom.set(playerId, room.roomId)
    roomId = room.roomId
    socket.join(room.roomId)
    socket.emit('joined', { roomId: room.roomId, state: room.getState(playerId) })
    broadcastState(room.roomId)
  })

  socket.on('set_seat', (payload: { seatIndex: number }) => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const seatIndex = typeof payload?.seatIndex === 'number' ? Math.floor(payload.seatIndex) : -1
    if (room.setSeat(playerId, seatIndex)) {
      broadcastState(roomId)
    } else {
      socket.emit('error', { message: 'Seat unavailable or invalid' })
    }
  })

  socket.on('join', (payload: { roomId: string; name: string }) => {
    const id = (payload?.roomId ?? '').trim()
    if (!id) {
      socket.emit('error', { message: 'Room code required' })
      return
    }
    const room = rooms.get(id)
    if (!room) {
      socket.emit('error', { message: 'Room not found' })
      return
    }
    if (!room.addPlayer(playerId, payload?.name ?? 'Player')) {
      socket.emit('error', { message: 'Room full or game started' })
      return
    }
    playerToRoom.set(playerId, room.roomId)
    roomId = room.roomId
    socket.join(room.roomId)
    room.setConnected(playerId, true)
    socket.emit('joined', { roomId: room.roomId, state: room.getState(playerId) })
    broadcastState(room.roomId)
  })

  socket.on('start', (payload?: { deckCount?: 2 | 3; discardOptionDelaySeconds?: number; secondsPerTurn?: number }) => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room || room.players[0]?.id !== playerId) {
      socket.emit('error', { message: 'Only host can start' })
      return
    }
    if (payload?.deckCount === 3 || payload?.deckCount === 2) room.setDeckCount(payload.deckCount)
    if (typeof payload?.discardOptionDelaySeconds === 'number') room.setDiscardOptionDelaySeconds(payload.discardOptionDelaySeconds)
    if (typeof payload?.secondsPerTurn === 'number') room.setSecondsPerTurn(payload.secondsPerTurn)
    if (room.startGame()) {
      broadcastState(roomId)
      io.to(roomId).emit('game_started', {})
    } else {
      socket.emit('error', { message: 'Need at least 2 players' })
    }
  })

  socket.on('draw', (payload: { fromDiscard?: boolean }) => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const result = room.draw(playerId, payload?.fromDiscard ?? false)
    if (result.ok) {
      broadcastState(roomId)
    } else {
      socket.emit('error', { message: result.error })
    }
  })

  socket.on('play_melds', (payload: { melds: { type: string; cards: { id: string; suit: string; rank: number }[] }[] }) => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const result = room.playMelds(playerId, payload.melds as { type: 'trio' | 'straight'; cards: import('./types.js').Card[] }[])
    if (result.ok) {
      broadcastState(roomId)
    } else {
      socket.emit('error', { message: result.error })
    }
  })

  socket.on('add_to_meld', (payload: { meldId: string; cards: { id: string; suit: string; rank: number }[] }) => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const result = room.addToMeld(playerId, payload.meldId, payload.cards as import('./types.js').Card[])
    if (result.ok) {
      broadcastState(roomId)
    } else {
      socket.emit('error', { message: result.error })
    }
  })

  socket.on('discard', (payload: { cardId: string }) => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const result = room.discard(playerId, payload?.cardId ?? '')
    if (result.ok) {
      broadcastState(roomId)
      if (room.phase === 'round_end') {
        io.to(roomId).emit('round_end', { roundScores: room.roundScores, roundEnderId: room.roundEnderId })
      }
    } else {
      socket.emit('error', { message: result.error })
    }
  })

  socket.on('take_discard', () => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const result = room.takeDiscard(playerId)
    if (result.ok) broadcastState(roomId)
    else socket.emit('error', { message: result.error })
  })

  socket.on('pass_discard', () => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const result = room.passDiscard(playerId)
    if (result.ok) broadcastState(roomId)
    else socket.emit('error', { message: result.error })
  })

  socket.on('swap_joker', (payload: { meldId: string; cardId: string }) => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const result = room.swapJoker(playerId, payload?.meldId ?? '', payload?.cardId ?? '')
    if (result.ok) broadcastState(roomId)
    else socket.emit('error', { message: result.error })
  })

  socket.on('debug_skip_round', () => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    if (room.debugSkipRound()) {
      broadcastState(roomId)
      io.to(roomId).emit('round_end', { roundScores: room.roundScores, roundEnderId: room.roundEnderId })
    }
  })

  socket.on('next_round', () => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (!room) return
    const hostId = room.players[0]?.id
    if (hostId !== playerId) {
      socket.emit('error', { message: 'Only host can advance' })
      return
    }
    if (room.nextRound()) {
      broadcastState(roomId)
    } else {
      broadcastState(roomId)
      if (room.phase === 'game_end') {
        io.to(roomId).emit('game_end', {})
      }
    }
  })

  socket.on('leave', () => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (room) {
      room.removePlayer(playerId)
      playerToRoom.delete(playerId)
      socket.leave(roomId)
      broadcastState(roomId)
      if (room.players.length === 0) rooms.delete(roomId)
    }
    roomId = null
    socket.emit('left')
  })

  socket.on('disconnect', () => {
    if (!roomId) return
    const room = rooms.get(roomId)
    if (room) {
      room.setConnected(playerId, false)
      room.removePlayer(playerId)
      playerToRoom.delete(playerId)
      broadcastState(roomId)
      if (room.players.length === 0) rooms.delete(roomId)
    }
  })
})

const PORT = Number(process.env.PORT) || 3001
httpServer.listen(PORT, () => {
  console.log(`Continental Rummy server on http://localhost:${PORT}`)
})
