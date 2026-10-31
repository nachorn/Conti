import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import { Room } from './room.js'
import type { Card, Meld } from './types.js'
import type { SnapshotStore } from './storage.js'
import { registerDashboard, type RoomCleanupResult } from './dashboard.js'
import { registerRoomInvites } from './roomInvite.js'
import { GameRepository, authenticate, cloneRecord, issueCredential, parseCredential, pauseRoom, resumeRoom, type ResumeCredential, type RoomRecord } from './recovery.js'
import { AdGate, type AdConfig } from './adGate.js'
import type { MembershipService } from './membership.js'
import { appendChat } from './roomChat.js'
import { isPochaDeckSize } from './game/pocha/pochaTypes.js'
import { RateLimiter, allowedSocketOrigin, requestLimit, securityHeaders, SECURITY_HEADERS } from './security.js'
import { AdminAuth } from './adminAuth.js'
import { registerSecurityConfig, type RoomEntryVerifier } from './turnstile.js'
import { pochaBotAction } from './testBot.js'

type Result = { ok: boolean; error?: string; code?: string; attemptId?: string; account?: unknown }
type ActionAck = (result: Result) => void
const ACTION_QUEUE_FULL = 'Too many pending actions. Please wait before trying again.'
const ACTION_SAVE_FAILED = 'The server could not save your game. Actions are paused; please reconnect after the server recovers.'
const text = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback
const seconds = (value: unknown, fallback: number, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : fallback

export async function createGameServer(store: SnapshotStore, options: { origins?: string[]; retentionMs?: number; debug?: boolean; dashboardKey?: string; membership?: MembershipService; adConfig?: AdConfig; turnstile?: RoomEntryVerifier } = {}) {
  const repository = new GameRepository(store, options.retentionMs)
  await repository.load()
  const app = express()
  app.disable('x-powered-by')
  app.use(securityHeaders)
  const isHealthy = () => !repository.failed && store.isHealthy?.() !== false
  const corsOrigin = options.origins?.length ? options.origins : true
  app.use(cors({ origin: corsOrigin }))
  registerSecurityConfig(app, options.turnstile)
  const adminAuth = new AdminAuth(options.dashboardKey, options.origins)
  const adminRequests = requestLimit(new RateLimiter(120, 60_000))
  app.use('/api/admin', (req, res, next) => {
    // Abuse must not lock out an already authenticated owner or prevent logout.
    if (adminAuth.authenticate(req) || (req.method === 'DELETE' && req.path === '/session')) { next(); return }
    adminRequests(req, res, next)
  })
  registerRoomInvites(app, repository, isHealthy)
  options.membership?.registerRoutes(app, options.origins)
  if (!options.membership) app.get('/api/membership/config', (_req, res) => res.set('Cache-Control', 'no-store').json({
    enabled: false, loginEnabled: false, checkoutEnabled: false, price: null,
    ads: options.adConfig ?? { provider: 'disabled', publisherId: null },
  }))
  // Render uses liveness here. An idle database may close its connection; do not
  // repeatedly wake it through health-check restarts before anyone needs to play.
  // The first failed work item still fails closed and triggers the supervisor.
  app.get('/health', (_req, res) => res.status(repository.failed ? 503 : 200).json({
    ok: !repository.failed, storageReady: isHealthy(),
  }))
  // Passive readiness diagnostic only: do not use as Render's health-check path.
  app.get('/ready', (_req, res) => res.status(isHealthy() ? 200 : 503).json({ ok: isHealthy() }))
  const httpServer = createServer(app)
  const connectionAttempts = new RateLimiter(120, 60_000)
  const roomAttempts = new RateLimiter(60, 60_000)
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin }, transports: ['websocket', 'polling'], maxHttpBufferSize: 64 * 1024,
    allowRequest: (req, accept) => {
      if (!allowedSocketOrigin(req.headers.origin, options.origins ?? [])) { accept(null, false); return }
      accept(null, connectionAttempts.take(req.socket.remoteAddress ?? 'unknown') === 0)
    },
  })
  io.engine.on('headers', headers => Object.assign(headers, SECURITY_HEADERS))
  const activeSockets = new Map<string, string>()
  const botRooms = new Map([...repository.records.values()].flatMap(record => record.sessions
    .filter(session => session.bot).map(session => [session.playerId, record.room.roomId] as const)))
  const adGate = new AdGate(options.adConfig)
  const isPlayerOnline = (playerId: string) => {
    const botRoom = botRooms.get(playerId)
    if (botRoom) return repository.get(botRoom)?.room.players.some(player => player.id === playerId && player.connected) === true
    const socketId = activeSockets.get(playerId)
    return !!socketId && io.sockets.sockets.get(socketId)?.connected === true
  }
  registerDashboard(app, {
    key: options.dashboardKey, origins: options.origins, repository, isHealthy,
    isOnline: isPlayerOnline,
    cleanupRooms: selection => new Promise<RoomCleanupResult>(resolve => {
      const unavailable = () => resolve({ ok: false, error: 'server_unavailable', status: 503 })
      if (closing || pending >= 200) { unavailable(); return }
      enqueue(async () => {
        // Recheck inside the game queue: a player might have returned since the preview.
        const conflict = selection.some(item => {
          const record = repository.records.get(item.roomId)
          return !record || record.updatedAt !== item.expectedUpdatedAt ||
            (record.room.pocha?.phase ?? record.room.phase) !== item.expectedPhase ||
            record.room.players.some(player => player.connected || isPlayerOnline(player.id))
        })
        if (conflict) { resolve({ ok: false, error: 'rooms_changed', status: 409 }); return }
        const roomIds = selection.map(item => item.roomId)
        await repository.commitRemovalBatch(roomIds)
        for (const roomId of roomIds) {
          const timer = timers.get(roomId)
          if (timer) clearTimeout(timer)
          timers.delete(roomId)
          const botTimer = botTimers.get(roomId)
          if (botTimer) clearTimeout(botTimer)
          botTimers.delete(roomId)
          for (const [id, code] of botRooms) if (code === roomId) botRooms.delete(id)
          adGate.forget(roomId)
        }
        resolve({ ok: true, deletedRoomIds: roomIds })
      }, undefined, unavailable)
    }),
  })
  const timers = new Map<string, NodeJS.Timeout>()
  const botTimers = new Map<string, NodeJS.Timeout>()
  let queue = Promise.resolve()
  let closing = false
  let pending = 0
  const testBotLimit = requestLimit(new RateLimiter(10, 60_000))
  const testBotPath = '/api/admin/rooms/:roomId/test-bot'
  app.all(testBotPath, (req, res, next) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow')
    if (!adminAuth.configured) { res.status(503).json({ error: 'dashboard_not_configured' }); return }
    if (!adminAuth.authenticate(req)) { res.status(401).json({ error: 'unauthorized' }); return }
    if (!adminAuth.allowWrite(req)) { res.status(403).json({ error: 'invalid_request' }); return }
    if (!isHealthy() || closing || pending >= 200) { res.status(503).json({ error: 'server_unavailable' }); return }
    testBotLimit(req, res, next)
  })
  for (const method of ['post', 'delete'] as const) app[method](testBotPath, async (req, res) => {
    const roomId = req.params.roomId
    if (!/^\d{4}$/.test(roomId)) { res.status(400).json({ error: 'invalid_room' }); return }
    await new Promise<void>(resolve => {
      const unavailable = () => { if (!res.headersSent) res.status(503).json({ error: 'server_unavailable' }); resolve() }
      enqueue(async () => {
        const record = repository.get(roomId)
        if (!record) { res.status(404).json({ error: 'room_not_found' }); resolve(); return }
        const allowedPhase = method === 'post' ? record.room.phase === 'lobby' : ['lobby', 'game_end'].includes(record.room.phase)
        if (record.room.gameType !== 'pocha' || !allowedPhase || record.manualPaused) {
          res.status(409).json({ error: 'test_bot_requires_pocha_lobby' }); resolve(); return
        }
        const next = cloneRecord(record)
        const existing = next.sessions.find(session => session.bot)
        if (method === 'post') {
          if (!isPlayerOnline(next.room.players[0]?.id ?? '')) { res.status(409).json({ error: 'host_offline' }); resolve(); return }
          if (existing) { res.json({ ok: true, playerId: existing.playerId, name: 'Bot de prueba' }); resolve(); return }
          const count = [...repository.records.values()].reduce((sum, item) => sum + item.sessions.filter(session => session.bot).length, 0)
          if (count >= 4) { res.status(409).json({ error: 'test_bot_capacity' }); resolve(); return }
          const { credential, session } = issueCredential(roomId)
          if (!next.room.addPlayer(credential.playerId, 'Bot de prueba')) { res.status(409).json({ error: 'room_full' }); resolve(); return }
          next.sessions.push({ ...session, bot: true })
        } else removeTestBots(next)
        syncTestBots(next)
        await repository.commit(roomId, next.room.players.length ? next : null)
        broadcast(roomId)
        const bot = next.sessions.find(session => session.bot)
        res.json({ ok: true, ...(bot ? { playerId: bot.playerId, name: 'Bot de prueba' } : {}) })
        resolve()
      }, undefined, unavailable)
    })
  })
  const pendingBySocket = new Map<string, number>()
  const removeMembershipListener = options.membership?.onChange(() => {
    enqueue(async () => {
      for (const roomId of repository.records.keys()) broadcastGate(roomId)
      for (const socket of io.sockets.sockets.values()) socket.emit('membership_state', { account: membershipAccount(socket) })
    })
  })

  function membershipAccount(socket: Socket) {
    if (!options.membership?.isHealthy() || typeof socket.data.membershipToken !== 'string') return null
    const account = options.membership.authenticate(socket.data.membershipToken)
    if (!account) return null
    // These fields are private to this socket; never put the account in room state.
    return { id: account.id, email: account.email, adFree: account.adFree, source: account.source, expiresAt: account.expiresAt }
  }

  function roomExempt(room: Room) {
    return room.players.some(player => {
      const socketId = activeSockets.get(player.id)
      const socket = socketId && io.sockets.sockets.get(socketId)
      return !!socket && socket.connected && socket.data.roomId === room.roomId && membershipAccount(socket)?.adFree === true
    })
  }

  function gateRoom(room: Room) {
    return {
      roomId: room.roomId, phase: room.phase,
      players: room.players.filter(player => !repository.get(room.roomId)?.sessions.some(session => session.playerId === player.id && session.bot)).map(player => {
        const socketId = activeSockets.get(player.id)
        return { id: player.id, connected: player.connected && !!socketId && io.sockets.sockets.get(socketId)?.connected === true }
      }),
    }
  }

  function broadcastGate(roomId: string) {
    const room = repository.get(roomId)?.room
    if (!room) { adGate.forget(roomId); return }
    const state = adGate.snapshot(gateRoom(room), roomExempt(room))
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.roomId === roomId && activeSockets.get(socket.data.playerId) === socket.id) socket.emit('ad_gate', state)
    }
  }

  function enqueue(task: () => Promise<void>, socket?: Socket, onError?: () => void) {
    // Cleanup and clock work cannot be dropped: that would leave ghost online players.
    if (socket && (pending >= 200 || (pendingBySocket.get(socket.id) ?? 0) >= 20)) {
      socket?.emit('error', { message: ACTION_QUEUE_FULL })
      return false
    }
    pending++
    if (socket) pendingBySocket.set(socket.id, (pendingBySocket.get(socket.id) ?? 0) + 1)
    queue = queue.then(async () => {
      if (closing) { onError?.(); return }
      if (store.isHealthy?.() === false) repository.failed = true
      if (repository.failed) throw new Error('Storage unavailable')
      await task()
    }).catch(() => {
      onError?.()
      socket?.emit('error', { message: ACTION_SAVE_FAILED })
      if (repository.failed) {
        for (const timer of timers.values()) clearTimeout(timer)
        timers.clear()
        for (const timer of botTimers.values()) clearTimeout(timer)
        botTimers.clear()
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

  function playerState(record: RoomRecord, playerId: string) {
    return { ...record.room.getState(playerId), savedGame: {
      paused: record.manualPaused === true, updatedAt: record.updatedAt,
      expiresAt: record.updatedAt + repository.retentionMs,
    } }
  }

  function broadcast(roomId: string) {
    const room = repository.get(roomId)?.room
    for (const [id, code] of botRooms) if (code === roomId) botRooms.delete(id)
    for (const session of repository.get(roomId)?.sessions ?? []) if (session.bot) botRooms.set(session.playerId, roomId)
    adGate.prune(repository.records.keys())
    if (!room) {
      adGate.forget(roomId)
      const botTimer = botTimers.get(roomId)
      if (botTimer) clearTimeout(botTimer)
      botTimers.delete(roomId)
      return
    }
    for (const socket of io.sockets.sockets.values()) {
      if (socket.data.roomId === roomId && activeSockets.get(socket.data.playerId) === socket.id) {
        socket.emit('state', playerState(repository.get(roomId)!, socket.data.playerId))
      }
    }
    broadcastGate(roomId)
    schedule(roomId)
    scheduleTestBot(roomId)
  }

  function removeTestBots(record: RoomRecord) {
    for (const session of record.sessions.filter(session => session.bot)) record.room.removePlayer(session.playerId)
    record.sessions = record.sessions.filter(session => !session.bot)
  }

  function syncTestBots(record: RoomRecord) {
    const humanIds = new Set(record.sessions.filter(session => !session.bot).map(session => session.playerId))
    if (!record.room.players.some(player => humanIds.has(player.id))) { removeTestBots(record); return }
    const online = record.room.players.some(player => humanIds.has(player.id) && player.connected)
    for (const session of record.sessions.filter(session => session.bot)) record.room.setConnected(session.playerId, online)
  }

  function scheduleTestBot(roomId: string) {
    const old = botTimers.get(roomId)
    if (old) clearTimeout(old)
    botTimers.delete(roomId)
    const record = repository.get(roomId)
    if (!record || record.paused || record.manualPaused || repository.failed || closing || record.room.phase !== 'playing') return
    const bot = record.sessions.find(session => session.bot)
    if (!bot || !record.room.players.some(player => player.id === bot.playerId && player.connected)) return
    const state = record.room.getState(bot.playerId).pocha
    if (!state || !pochaBotAction(state, bot.playerId)) return
    const delay = Math.max(800, (state.trickReviewUntil ?? 0) - Date.now() + 50)
    botTimers.set(roomId, setTimeout(() => {
      botTimers.delete(roomId)
      enqueue(async () => {
        const current = repository.get(roomId)
        if (!current || current.paused || current.manualPaused || !current.sessions.some(session => session.bot && session.playerId === bot.playerId)) return
        const next = cloneRecord(current)
        const view = next.room.getState(bot.playerId).pocha
        const action = view && pochaBotAction(view, bot.playerId)
        if (!action || !next.room.pochaAction(bot.playerId, action).ok) return
        await repository.commit(roomId, next)
        broadcast(roomId)
      })
    }, delay))
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
    syncTestBots(next)
    if (!next.manualPaused) resumeRoom(next)
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
    adGate.interrupt(credential.roomId, credential.playerId)
    activeSockets.set(credential.playerId, socket.id)
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId)
      oldSocket?.emit('session_replaced', { message: 'This seat was opened in another connection.' })
      oldSocket?.disconnect(true)
    }
    await socket.join(credential.roomId)
    if (socket.connected) socket.emit('joined', {
      roomId: credential.roomId, playerId: credential.playerId, resumeToken: credential.token,
      state: playerState(next, credential.playerId),
      chat: next.chat ?? [],
    })
    broadcast(credential.roomId)
  }

  io.on('connection', socket => {
    const actions = new RateLimiter(120, 10_000)
    const entryAttempts = new RateLimiter(10, 60_000)
    let verifyingEntry = false
    socket.data.membershipToken = typeof socket.handshake.auth?.membershipToken === 'string' && socket.handshake.auth.membershipToken.length <= 2048 ? socket.handshake.auth.membershipToken : null
    socket.emit('membership_state', { account: membershipAccount(socket) })
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

    const on = (event: string, task: (payload: any, ack?: ActionAck) => Promise<void>) => socket.on(event, (payload, maybeAck) => {
      const ack = typeof maybeAck === 'function' ? maybeAck as ActionAck : undefined
      const entry = event === 'create' || event === 'join'
      const retryAfter = actions.take('actions') || (entry && (
        entryAttempts.take('rooms') || roomAttempts.take(socket.request.socket.remoteAddress ?? 'unknown')
      ))
      if (retryAfter) {
        const error = 'Too many attempts. Please wait before trying again.'
        socket.emit('error', { message: error, code: 'rate_limited', retryAfter })
        ack?.({ ok: false, error, code: 'rate_limited' })
        return
      }
      const queueAction = () => {
        if (!socket.connected) return
        const queued = enqueue(async () => {
          if (socket.connected) await task(payload, ack)
        }, socket)
        if (!queued) ack?.({ ok: false, error: ACTION_QUEUE_FULL })
      }
      if (entry && options.turnstile) {
        if (verifyingEntry) {
          reject('Security verification is already in progress.', ack, 'verification_pending')
          return
        }
        verifyingEntry = true
        // An unavailable verification provider must never stall another table.
        void options.turnstile.verify(payload?.turnstileToken).then(valid => {
          if (!socket.connected) return
          if (!valid) { reject('No se pudo verificar el acceso. Inténtalo de nuevo. / Verification failed. Please try again.', ack, 'verification_failed'); return }
          queueAction()
        }).catch(() => {
          if (socket.connected) reject('Verification is unavailable. Please try again.', ack, 'verification_failed')
        }).finally(() => { verifyingEntry = false })
        return
      }
      queueAction()
    })
    const reject = (message: string, ack?: ActionAck, code?: string) => {
      socket.emit('error', { message, ...(code ? { code } : {}) })
      ack?.({ ok: false, error: message, ...(code ? { code } : {}) })
    }
    on('membership_auth', async (payload, ack) => {
      socket.data.membershipToken = typeof payload?.token === 'string' && payload.token.length <= 2048 ? payload.token : null
      const account = membershipAccount(socket)
      socket.emit('membership_state', { account })
      if (socket.data.roomId) broadcastGate(socket.data.roomId)
      ack?.({ ok: payload?.token == null || account !== null, account })
    })

    for (const event of ['ad_begin', 'ad_complete'] as const) on(event, async (payload, ack) => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) { reject('Join or resume your room first', ack); return }
      const room = repository.get(roomId)?.room
      if (!room) { reject('Room not found', ack); return }
      const result = event === 'ad_begin'
        ? adGate.begin(gateRoom(room), playerId, roomExempt(room))
        : adGate.complete(gateRoom(room), playerId, payload, roomExempt(room))
      broadcastGate(roomId)
      ack?.(result)
    })
    const action = (event: string, apply: (room: Room, playerId: string, payload: any) => Result, hostOnly = false) => on(event, async (payload, ack) => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) { reject('Join or resume your room first', ack); return }
      const current = repository.get(roomId)
      if (!current) { reject('Room not found', ack); return }
      if (current.manualPaused) { reject('La partida está guardada. El anfitrión debe continuarla cuando estéis todos.', ack); return }
      if (hostOnly && current.room.players[0]?.id !== playerId) { reject('Only the host can do that', ack); return }
      if ((event === 'start' || event === 'rematch') && !adGate.snapshot(gateRoom(current.room), roomExempt(current.room)).canStart) {
        broadcastGate(roomId)
        io.to(roomId).emit('ad_gate_prompt', { roomId })
        reject('Everyone must complete the short ad break before the game can start.', ack, 'ad_pending')
        return
      }
      const next = cloneRecord(current)
      const common = ['set_seat', 'start', 'next_round', 'rematch']
      const pochaOnly = ['pocha_action', 'pocha_configure']
      if (next.room.gameType === 'pocha' ? !common.includes(event) && !pochaOnly.includes(event) : pochaOnly.includes(event)) {
        reject('Esta acción no pertenece a este juego', ack); return
      }
      const result = apply(next.room, playerId, payload)
      if (!result.ok) { reject(result.error ?? 'Action unavailable', ack); return }
      try {
        await repository.commit(roomId, next)
      } catch (error) {
        ack?.({ ok: false, error: ACTION_SAVE_FAILED })
        throw error
      }
      // Pocha's rematch opens its setup lobby; keep the completed break until the
      // following start actually deals, so the same new game never asks twice.
      if ((event === 'start' || event === 'rematch') && next.room.phase === 'playing') adGate.consume(roomId)
      broadcast(roomId)
      ack?.({ ok: true })
    })

    on('create', async payload => {
      if (socket.data.roomId) { reject('Leave the current room before creating another'); return }
      let roomId: string
      try { roomId = repository.newRoomCode() }
      catch { reject('Server has too many saved rooms. Try again later.'); return }
      const room = new Room({ roomId, gameType: payload?.gameType === 'pocha' ? 'pocha' : 'continental', pochaDeckSize: isPochaDeckSize(payload?.pochaDeckSize) ? payload.pochaDeckSize : 40, maxPlayers: 10, deckCount: payload?.deckCount === 3 ? 3 : 2,
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
      if (room.pocha) return room.startPochaGame(p?.pochaSettings)
      if (room.phase !== 'lobby' || room.players.length < 2) return { ok: false, error: 'Need at least 2 players in the lobby' }
      if (p?.deckCount === 2 || p?.deckCount === 3) room.setDeckCount(p.deckCount)
      room.setDiscardOptionDelaySeconds(seconds(p?.discardOptionDelaySeconds, room.discardOptionDelaySeconds, 30))
      room.setSecondsPerTurn(seconds(p?.secondsPerTurn, room.secondsPerTurn, 120))
      return { ok: room.startGame() }
    }, true)
    action('pocha_action', (room, id, p) => room.pochaAction(id, p))
    action('pocha_configure', (room, _id, p) => room.configurePocha(p), true)
    action('draw', (room, id, p) => room.draw(id, p?.fromDiscard === true))
    action('play_melds', (room, id, p) => {
      if (!Array.isArray(p?.melds) || p.melds.some((m: any) => !m || !Array.isArray(m.cards))) return { ok: false, error: 'Invalid meld payload' }
      return room.playMelds(id, p.melds as { type: Meld['type']; cards: Card[] }[])
    })
    action('add_to_meld', (room, id, p) => Array.isArray(p?.cards) ? room.addToMeld(id, text(p?.meldId), p.cards) : { ok: false, error: 'Invalid cards' })
    action('discard', (room, id, p) => room.discard(id, text(p?.cardId)))
    action('take_discard', (room, id) => room.takeDiscard(id))
    action('pass_discard', (room, id) => room.passDiscard(id))
    action('swap_joker', (room, id, p) => room.swapJoker(id, text(p?.meldId), text(p?.cardId), text(p?.jokerCardId)))
    action('rematch', room => room.rematch() ? { ok: true } : { ok: false, error: 'Finish the game with at least two players before starting again.' }, true)
    action('next_round', room => {
      if (room.phase !== 'round_end') return { ok: false, error: 'The round has not ended' }
      const advanced = room.nextRound()
      return advanced || !room.pocha ? { ok: true } : { ok: false, error: 'Espera a que termine el resultado de la baza' }
    }, true)
    action('debug_skip_round', room => options.debug ? { ok: room.debugSkipRound() } : { ok: false, error: 'Debug actions are disabled' }, true)

    on('chat_send', async (payload, ack) => {
      const { roomId, playerId } = socket.data
      const record = roomId && activeSockets.get(playerId) === socket.id ? repository.get(roomId) : undefined
      const player = record?.room.players.find(p => p.id === playerId)
      if (!record || !player) { ack?.({ ok: false, error: 'not_in_room' }); return }
      const result = appendChat(record.chat ?? [], player, payload)
      if (!result.ok) { ack?.(result); return }
      if (!result.duplicate) {
        const next = cloneRecord(record)
        next.chat = result.messages
        try { await repository.commit(roomId, next) }
        catch (error) { ack?.({ ok: false, error: 'save_failed' }); throw error }
        for (const member of io.sockets.sockets.values()) {
          if (member.data.roomId === roomId && activeSockets.get(member.data.playerId) === member.id) {
            member.emit('room_chat', { roomId, messages: next.chat })
          }
        }
      }
      ack?.({ ok: true })
    })

    on('continue_saved', async (_payload, ack) => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) { reject('Join or resume your room first', ack); return }
      const record = repository.get(roomId)
      if (!record || record.room.players[0]?.id !== playerId) { reject('Solo el anfitrión puede continuar la partida.', ack); return }
      if (!record.manualPaused) { ack?.({ ok: true }); return }
      if (record.room.players.some(p => !p.connected)) { reject('Faltan jugadores por volver a la sala.', ack); return }
      const next = cloneRecord(record)
      next.manualPaused = false
      resumeRoom(next)
      try { await repository.commit(roomId, next) }
      catch (error) { ack?.({ ok: false, error: ACTION_SAVE_FAILED }); throw error }
      broadcast(roomId)
      ack?.({ ok: true })
    })

    on('save_and_exit', async (_payload, ack) => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) { reject('Join or resume your room first', ack); return }
      const record = repository.get(roomId)
      if (!record) { reject('Room not found', ack); return }
      const next = cloneRecord(record)
      if (next.room.players[0]?.id === playerId) next.manualPaused = true
      next.room.setConnected(playerId, false)
      syncTestBots(next)
      if (next.manualPaused || !next.room.players.some(p => p.connected)) pauseRoom(next)
      try { await repository.commit(roomId, next) }
      catch (error) { ack?.({ ok: false, error: ACTION_SAVE_FAILED }); throw error }
      adGate.interrupt(roomId, playerId)
      activeSockets.delete(playerId)
      delete socket.data.roomId
      delete socket.data.playerId
      await socket.leave(roomId)
      socket.emit('saved_exit', playerState(next, playerId))
      broadcast(roomId)
      ack?.({ ok: true })
    })

    on('leave', async () => {
      const { roomId, playerId } = socket.data
      if (!roomId || activeSockets.get(playerId) !== socket.id) return
      adGate.interrupt(roomId, playerId)
      const record = repository.get(roomId)
      if (record) {
        const next = cloneRecord(record)
        if (next.room.players[0]?.id === playerId) removeTestBots(next)
        next.room.removePlayer(playerId)
        next.sessions = next.sessions.filter(s => s.playerId !== playerId)
        syncTestBots(next)
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
      adGate.interrupt(roomId, playerId)
      const record = repository.get(roomId)
      if (!record) return
      const next = cloneRecord(record)
      next.room.setConnected(playerId, false)
      syncTestBots(next)
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
      removeMembershipListener?.()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      for (const timer of botTimers.values()) clearTimeout(timer)
      botTimers.clear()
      await queue
      try {
        if (!repository.failed) {
          const records = [...repository.records.values()].map(record => {
            const next = cloneRecord(record)
            for (const player of next.room.players) next.room.setConnected(player.id, false)
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
