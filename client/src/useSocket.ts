import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { pushLog } from './lib/reportBug'
import type { GameState, Card } from './types'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? 'http://localhost:3001' : '')

export function useSocket() {
  const [state, setState] = useState<GameState | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [socketId, setSocketId] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] })
    socketRef.current = socket
    setSocketId(socket.id ?? null)

    socket.on('connect', () => setSocketId(socket.id ?? null))
    socket.on('joined', (payload: { roomId: string; state: GameState }) => {
      setRoomId(payload.roomId)
      setState(payload.state)
      setError(null)
    })

    socket.on('state', (newState: GameState) => {
      setState(newState)
      setError(null)
    })

    socket.on('left', () => {
      setRoomId(null)
      setState(null)
    })

    socket.on('error', (payload: { message: string }) => {
      const msg = payload?.message ?? 'Error'
      setError(msg)
      pushLog('error', 'Socket error', msg)
    })

    socket.on('connect_error', (err) => {
      setError('Cannot connect to server')
      pushLog('error', 'Socket connect_error', err?.message ?? err)
    })

    return () => {
      socket.off('connect').off('joined').off('state').off('left').off('error').off('connect_error')
      socket.disconnect()
      socketRef.current = null
      setSocketId(null)
    }
  }, [])

  const create = (name: string, gameType: 'continental' | 'pocha' = 'continental', deckCount?: 2 | 3) => {
    setError(null)
    socketRef.current?.emit('create', { name, gameType, deckCount: deckCount ?? 2 })
  }

  const join = (id: string, name: string) => {
    setError(null)
    socketRef.current?.emit('join', { roomId: id.trim(), name })
  }

  const setSeat = (seatIndex: number) => {
    socketRef.current?.emit('set_seat', { seatIndex })
  }

  const start = (opts?: { deckCount?: 2 | 3; discardOptionDelaySeconds?: number; secondsPerTurn?: number }) => {
    socketRef.current?.emit('start', opts)
  }

  const draw = (fromDiscard: boolean) => {
    socketRef.current?.emit('draw', { fromDiscard })
  }

  const playMelds = (melds: { type: 'trio' | 'straight'; cards: Card[] }[]) => {
    socketRef.current?.emit('play_melds', { melds })
  }

  const addToMeld = (meldId: string, cards: Card[]) => {
    socketRef.current?.emit('add_to_meld', { meldId, cards })
  }

  const swapJoker = (meldId: string, cardId: string) => {
    socketRef.current?.emit('swap_joker', { meldId, cardId })
  }

  const discard = (cardId: string) => {
    socketRef.current?.emit('discard', { cardId })
  }

  const takeDiscard = () => {
    socketRef.current?.emit('take_discard')
  }

  const passDiscard = () => {
    socketRef.current?.emit('pass_discard')
  }

  const leave = () => {
    socketRef.current?.emit('leave')
  }

  const nextRound = () => {
    socketRef.current?.emit('next_round')
  }

  const debugSkipRound = () => {
    socketRef.current?.emit('debug_skip_round')
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
  }
}
