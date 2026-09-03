import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { Room } from './room.js'
import type { Card, Meld } from './types.js'
import type { SnapshotStore } from './storage.js'
import { GameRepository, authenticate, cloneRecord, issueCredential, parseCredential, pauseRoom, resumeRoom, type ResumeCredential, type RoomRecord } from './recovery.js'

type Result = { ok: boolean; error?: string }
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const seconds = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback

export async function createGameServer(store: SnapshotStore, options: { origins?: string[]; retentionMs?: number; debug?: boolean } = {}) {
  const repository = new GameRepository(store, options.retentionMs)
  await repository.load()
  const app = express()
  const isHealthy = () => !repository.failed && store.isHealthy?.() !== false
  const corsOrigin = options.origins?.length ? options.origins : true
  app.use(cors({ origin: corsOrigin }))
  app.get('/health', (_req, res) => res.status(isHealthy() ? 200 : 503).json({ ok: isHealthy() }))
  const httpServer = createServer(app)
  const io = new Server(httpServer, { cors: { origin: corsOrigin }, transports: ['websocket', 'polling'], maxHttpBufferSize: 64 * 1024 })
  const activeSockets = new Map<string, string>()
  const timers = new Map<string, NodeJS.Timeout>()
  let queue = Promise.resolve()
  let closing = false
  let pending = 0
  const pendingBySocket = new Map<string, number>()

  function enqueue(task: () => Promise<void>, socket?: Socket) {
    // Cleanup and clock work cannot be dropped: that would leave ghost online players.
    if (socket && (pending >= 200 || (pendingBySocket.get(socket.id) ?? 0) >= 20)) {
      socket?.emit('error', { message: 'Too many pending actions. Please wait before trying again.' })
      return false
    }
    pending++
    if (socket) pendingBySocket.set(socket.id, (pendingBySocket.get(socket.id) ?? 0) + 1)
    queue = queue.then(async () => {
      if (closing) return
      if (store.isHealthy?.() === false) repository.failed = true
      if (repository.failed) throw new Error('Storage unavailable')
      await task()
    }).catch(() => {
      socket?.emit('error', { message: 'The server could not save your game. Actions are paused; please reconnect after the server recovers.' })
      if (repository.failed) {
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        io.emit('server_paused', { message: 'Game saving is temporarily unavailable. Play is paused to protect your saved game.' })
      }
    }).finally(() => {
      pending--
      if (socket) {
        const count = (pendingBySocket.get(socket.id) ?? 1) - 1
        if (count) pendingBySocket.set(socket.id, count)
        else pendingBySocket.delete(socket.id)
      }
    })
    return true
  }

  function broadcast(roomId: string) {
    const room = repository.get(roomId)?.room
    if (!room) return
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.roomId === roomId && activeSockets.get(socket.data.playerId) === socket.id) {
        socket.emit('state', room.getState(socket.data.playerId))
      }
    }
    schedule(roomId)
  }

  function schedule(roomId: string) {
    const old = timers.get(roomId)
    if (old) clearTimeout(old)
    timers.delete(roomId)
    const record = repository.get(roomId)
    if (!record || record.paused || record.room.phase !== 'playing' || record.room.turnDeadline === null || repository.failed || closing) return
    const scheduledDeadline = record.room.turnDeadline
    timers.set(roomId, setTimeout(() => {
      const queued = enqueue(async () => {
        const current = repository.get(roomId)
        if (!current || current.paused || current.room.turnDeadline !== scheduledDeadline) return
        const next = cloneRecord(current)
        if (!next.room.handleTurnTimeout()) next.room.resetTurnDeadline()
        await repository.commit(roomId, next)
        broadcast(roomId)
      })
      if (!queued) schedule(roomId)
    }, Math.max(1, scheduledDeadline - Date.now())))
  }

  async function attach(socket: Socket, credential: ResumeCredential, next: RoomRecord, newSeat = false) {
    const oldSocketId = activeSockets.get(credential.playerId)
    next.room.setConnected(credential.playerId, true)
    resumeRoom(next)
    await repository.commit(credential.roomId, next)
    // If a first join never reached a live connection, avoid an inaccessible seat.
    if (newSeat && !socket.connected) {
      const abandoned = cloneRecord(next)
      abandoned.room.removePlayer(credential.playerId)
      abandoned.sessions = abandoned.sessions.filter(s => s.playerId !== credential.playerId)
      if (!abandoned.room.players.some(p => p.connected)) pauseRoom(abandoned)
      await repository.commit(credential.roomId, abandoned.room.players.length ? abandoned : null)
      broadcast(credential.roomId)
      return
    }
    socket.data.roomId = credential.roomId
    socket.data.playerId = credential.playerId
    activeSockets.set(credential.playerId, socket.id)
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId)
      oldSocket?.emit('session_replaced', { message: 'This seat was opened in another connection.' })
      oldSocket?.disconnect(true)
    }
    await socket.join(credential.roomId)
    if (socket.connected) socket.emit('joined', {
      roomId: credential.roomId, playerId: credential.playerId, resumeToken: credential.token,
      state: next.room.getState(credential.playerId),
    })
    broadcast(credential.roomId)
  }

  io.on('connection', socket => {
    // Register events immediately; the queue ensures handshake recovery finishes first.
    if (socket.handshake.auth?.resume !== undefined) enqueue(async () => {
      const credential = parseCredential(socket.handshake.auth.resume)
      const record = credential && repository.get(credential.roomId)
      if (!credential || !record || !authenticate(record, credential)) {
        socket.emit('resume_failed', { message: 'This saved seat is invalid or expired. Create or join a room to play again.' })
        return
      }
      if (socket.connected) await attach(socket, credential, cloneRecord(record))
    }, socket)

    const on = (event: string, task: (payload: any) => Promise<void>) => socket.on(event, payload => enqueue(async () => {
      if (socket.connected) await task(payload)
    }, socket))
    const reject = (message: string) => socket.emit('error', { message })
    const action = (event: string, apply: (room: Room, playerId: string, payload: any) => Result, hostOnly = false) => on(event, async payload => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) { reject('Join or resume your room first'); return }
      const current = repository.get(roomId)
      if (!current) { reject('Room not found'); return }
      if (hostOnly && current.room.players[0]?.id !== playerId) { reject('Only the host can do that'); return }
      const next = cloneRecord(current)
      const result = apply(next.room, playerId, payload)
      if (!result.ok) { reject(result.error ?? 'Action unavailable'); return }
      await repository.commit(roomId, next)
      broadcast(roomId)
    })

    on('create', async payload => {
      if (socket.data.roomId) { reject('Leave the current room before creating another'); return }
      if (payload?.gameType === 'pocha') { reject('Pocha multiplayer not available yet'); return }
      let roomId: string
      try { roomId = repository.newRoomCode() }
      catch { reject('Server has too many saved rooms. Try again later.'); return }
      const room = new Room({ roomId, maxPlayers: 10, deckCount: payload?.deckCount === 3 ? 3 : 2,
        discardOptionDelaySeconds: seconds(payload?.discardOptionDelaySeconds, 10, 30),
        secondsPerTurn: seconds(payload?.secondsPerTurn, 0, 120) })
      const { credential, session } = issueCredential(roomId)
      room.addPlayer(credential.playerId, text(payload?.name, 'Player'))
      await attach(socket, credential, { room, sessions: [session], updatedAt: Date.now(), paused: null }, true)
    })
    on('join', async payload => {
      if (socket.data.roomId) { reject('Leave the current room before joining another'); return }
      const roomId = text(payload?.roomId).trim()
      const record = repository.get(roomId)
      if (!record) { reject('Room not found'); return }
      const next = cloneRecord(record)
      const { credential, session } = issueCredential(roomId)
      if (!next.room.addPlayer(credential.playerId, text(payload?.name, 'Player'))) { reject('Room full or game started'); return }
      next.sessions.push(session)
      await attach(socket, credential, next, true)
    })

    action('set_seat', (room, id, p) => ({ ok: Number.isInteger(p?.seatIndex) && room.setSeat(id, p.seatIndex), error: 'Seat unavailable or invalid' }))
    action('start', (room, _id, p) => {
      if (room.phase !== 'lobby' || room.players.length < 2) return { ok: false, error: 'Need at least 2 players in the lobby' }
      if (p?.deckCount === 2 || p?.deckCount === 3) room.setDeckCount(p.deckCount)
      room.setDiscardOptionDelaySeconds(seconds(p?.discardOptionDelaySeconds, room.discardOptionDelaySeconds, 30))
      room.setSecondsPerTurn(seconds(p?.secondsPerTurn, room.secondsPerTurn, 120))
      return { ok: room.startGame() }
    }, true)
    action('draw', (room, id, p) => room.draw(id, p?.fromDiscard === true))
    action('play_melds', (room, id, p) => {
      if (!Array.isArray(p?.melds) || p.melds.some((m: any) => !m || !Array.isArray(m.cards))) return { ok: false, error: 'Invalid meld payload' }
      return room.playMelds(id, p.melds as { type: Meld['type']; cards: Card[] }[])
    })
    action('add_to_meld', (room, id, p) => Array.isArray(p?.cards) ? room.addToMeld(id, text(p?.meldId), p.cards) : { ok: false, error: 'Invalid cards' })
    action('discard', (room, id, p) => room.discard(id, text(p?.cardId)))
    action('take_discard', (room, id) => room.takeDiscard(id))
    action('pass_discard', (room, id) => room.passDiscard(id))
    action('swap_joker', (room, id, p) => room.swapJoker(id, text(p?.meldId), text(p?.cardId)))
    action('next_round', room => {
      if (room.phase !== 'round_end') return { ok: false, error: 'The round has not ended' }
      room.nextRound()
      return { ok: true }
    }, true)
    action('debug_skip_round', room => options.debug ? { ok: room.debugSkipRound() } : { ok: false, error: 'Debug actions are disabled' }, true)

    on('leave', async () => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) return
      const record = repository.get(roomId)
      if (record) {
        const next = cloneRecord(record)
        next.room.removePlayer(playerId)
        next.sessions = next.sessions.filter(s => s.playerId !== playerId)
        if (!next.room.players.some(p => p.connected)) pauseRoom(next)
        await repository.commit(roomId, next.room.players.length ? next : null)
      }
      activeSockets.delete(playerId)
      delete socket.data.roomId
      delete socket.data.playerId
      await socket.leave(roomId)
      socket.emit('left')
      broadcast(roomId)
      schedule(roomId)
    })
    socket.on('disconnect', () => enqueue(async () => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) return
      const record = repository.get(roomId)
      if (!record) return
      const next = cloneRecord(record)
      next.room.setConnected(playerId, false)
      if (!next.room.players.some(p => p.connected)) pauseRoom(next)
      await repository.commit(roomId, next)
      activeSockets.delete(playerId)
      broadcast(roomId)
    }))
  })

  return {
    app, io, httpServer, repository, isHealthy,
    async listen(port = 3001, host = '0.0.0.0') {
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(port, host, () => { httpServer.off('error', reject); resolve() })
      })
      return (httpServer.address() as { port: number }).port
    },
    async close() {
      closing = true
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      await queue
      try {
        if (!repository.failed) {
          const records = [...repository.records.values()].map(record => {
            const next = cloneRecord(record)
            for (const player of next.room.players) player.connected = false
            pauseRoom(next)
            return next
          })
          await store.save({ version: 1, savedAt: Date.now(), rooms: records.map(r => ({ ...r, room: r.room.toSnapshot() })) })
        }
      } finally {
        await new Promise<void>(resolve => io.close(() => resolve()))
        await store.close()
      }
    },
    idle: () => queue,
  }
}
