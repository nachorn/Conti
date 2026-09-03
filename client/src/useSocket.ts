import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { pushLog } from './lib/reportBug'
import { emitWhenReady, isRoomSession, readRoomSession, writeRoomSession, type RoomSession } from './lib/roomSession'
import type { GameState, Card, ActionResult } from './types'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : '')

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'resuming' | 'replaced' | 'paused'

function tabStorage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function useSocket() {
  const [initialSession] = useState(() => readRoomSession(tabStorage()))
  const sessionRef = useRef<RoomSession | null>(initialSession)
  const [state, setState] = useState<GameState | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // This is a stable player ID, not a transport ID; keep the prop name for existing boards.
  const [socketId, setSocketId] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const statusRef = useRef<ConnectionStatus>('connecting')
  const [recoveryRoomId, setRecoveryRoomId] = useState(initialSession?.roomId ?? null)
  const [sessionStorageAvailable, setSessionStorageAvailable] = useState(true)
  const socketRef = useRef<Socket | null>(null)

  const updateStatus = (status: ConnectionStatus) => {
    statusRef.current = status
    setConnectionStatus(status)
  }

  const rememberSession = (session: RoomSession | null) => {
    sessionRef.current = session
    setRecoveryRoomId(session?.roomId ?? null)
    setSessionStorageAvailable(writeRoomSession(tabStorage(), session))
  }

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      // Read at each handshake, not just mount: joined can issue fresh credentials.
      auth: (callback) => callback(sessionRef.current ? { resume: sessionRef.current } : {}),
      reconnectionDelayMax: 5000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      updateStatus(sessionRef.current ? 'resuming' : 'connected')
      setError(null)
    })
    socket.on('joined', (payload: { roomId: string; state: GameState; playerId: string; resumeToken: string }) => {
      const session = { roomId: payload.roomId, playerId: payload.playerId, token: payload.resumeToken }
      if (!isRoomSession(session)) {
        setError('The server could not provide a recoverable seat. Please try reconnecting.')
        updateStatus('reconnecting')
        socket.disconnect()
        return
      }
      rememberSession(session)
      setRoomId(payload.roomId)
      setSocketId(payload.playerId)
      setState(payload.state)
      setError(null)
      updateStatus('connected')
    })

    socket.on('state', (newState: GameState) => {
      // Until joined authenticates the saved seat, do not accept a room broadcast.
      if (statusRef.current !== 'connected' || !sessionRef.current) return
      setState(newState)
      setError(null)
    })

    socket.on('left', () => {
      rememberSession(null)
      setRoomId(null)
      setState(null)
      setSocketId(null)
      setError(null)
    })

    socket.on('resume_failed', (payload: { message?: string }) => {
      // An authoritative rejection differs from a temporary connection failure.
      rememberSession(null)
      setRoomId(null)
      setState(null)
      setSocketId(null)
      setError(payload?.message || 'Your saved game is no longer available. You can create or join a room.')
      updateStatus(socket.connected ? 'connected' : 'reconnecting')
    })

    socket.on('session_replaced', () => {
      updateStatus('replaced')
      setError(null)
      socket.disconnect()
    })

    socket.on('server_paused', (payload: { message?: string }) => {
      // A live transport does not mean the server can safely save a new move.
      updateStatus('paused')
      setError(typeof payload?.message === 'string' ? payload.message : 'Saving is temporarily unavailable. Please try reconnecting.')
    })

    socket.on('disconnect', () => {
      if (statusRef.current !== 'replaced') updateStatus('reconnecting')
      // Keep the last board and credentials while the network or server recovers.
    })

    socket.on('error', (payload: { message: string }) => {
      const msg = typeof payload?.message === 'string' ? payload.message : 'The action could not be completed.'
      setError(msg)
      pushLog('error', 'Socket action failed', msg)
    })

    socket.on('connect_error', () => {
      updateStatus('reconnecting')
      // Never log the connection object: its auth payload contains a private token.
      pushLog('warn', 'Connection unavailable; retrying automatically')
    })

    socket.connect()
    return () => {
      socket.removeAllListeners()
      socket.disconnect()
      socketRef.current = null
      // StrictMode cleanup and page reload must not erase recovery credentials.
    }
  }, [])

  const send = (event: string, ...args: unknown[]) => {
    const sent = emitWhenReady(socketRef.current, statusRef.current === 'connected', event, ...args)
    if (sent) setError(null)
    return sent
  }

  const sendWithAck = (event: string, payload: unknown): Promise<ActionResult> => {
    const socket = socketRef.current
    if (!socket || statusRef.current !== 'connected' || !socket.connected) {
      const message = 'Reconnect before sending this move.'
      setError(message)
      return Promise.resolve({ ok: false, error: message })
    }

    setError(null)
    return new Promise((resolve) => {
      socket.timeout(10_000).emit(
        event,
        payload,
        (timeoutError: Error | null, response?: ActionResult) => {
          if (timeoutError) {
            const message = 'The server did not confirm this move. Its outcome is unknown; reconnect to verify the table.'
            setError(message)
            pushLog('warn', 'Socket action acknowledgement timed out', event)
            resolve({ ok: false, error: message })
            return
          }

          const result: ActionResult = response?.ok
            ? { ok: true }
            : { ok: false, error: response?.error || 'The action could not be completed.' }
          if (!result.ok) {
            const message = result.error ?? 'The action could not be completed.'
            setError(message)
            pushLog('error', 'Socket action rejected', message)
          }
          resolve(result)
        }
      )
    })
  }

  const reconnect = () => {
    const socket = socketRef.current
    if (!socket) return
    if (socket.connected && statusRef.current === 'connected') return
    updateStatus('reconnecting')
    setError(null)
    // A stalled resume needs a fresh handshake; otherwise connect is idempotent.
    if (socket.connected) socket.disconnect()
    socket.connect()
  }

  const create = (name: string, gameType: 'continental' | 'pocha' = 'continental', deckCount?: 2 | 3) => {
    send('create', { name, gameType, deckCount: deckCount ?? 2 })
  }

  const join = (id: string, name: string) => {
    send('join', { roomId: id.trim(), name })
  }

  const setSeat = (seatIndex: number) => {
    send('set_seat', { seatIndex })
  }

  const start = (opts?: { deckCount?: 2 | 3; discardOptionDelaySeconds?: number; secondsPerTurn?: number }) => {
    send('start', opts)
  }

  const draw = (fromDiscard: boolean) => {
    send('draw', { fromDiscard })
  }

  const playMelds = (melds: { type: 'trio' | 'straight'; cards: Card[] }[]) => {
    send('play_melds', { melds })
  }

  const addToMeld = (meldId: string, cards: Card[]) =>
    sendWithAck('add_to_meld', { meldId, cards })

  const swapJoker = (meldId: string, cardId: string, jokerCardId: string) =>
    sendWithAck('swap_joker', { meldId, cardId, jokerCardId })

  const discard = (cardId: string) => {
    send('discard', { cardId })
  }

  const takeDiscard = () => {
    send('take_discard')
  }

  const passDiscard = () => {
    send('pass_discard')
  }

  const leave = () => {
    send('leave')
  }

  const nextRound = () => {
    send('next_round')
  }

  const debugSkipRound = () => {
    send('debug_skip_round')
  }

  return {
    state,
    roomId,
    error,
    create,
    join,
    setSeat,
    start,
    draw,
    playMelds,
    addToMeld,
    swapJoker,
    discard,
    takeDiscard,
    passDiscard,
    leave,
    nextRound,
    debugSkipRound,
    socketId,
    connectionStatus,
    isConnected: connectionStatus === 'connected',
    recoveryRoomId,
    sessionStorageAvailable,
    reconnect,
  }
}
