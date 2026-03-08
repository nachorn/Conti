import { useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
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
    })

    socket.on('error', (payload: { message: string }) => {
      setError(payload?.message ?? 'Error')
    })

    socket.on('connect_error', () => {
      setError('Cannot connect to server')
    })

    return () => {
      socket.off('connect').off('joined').off('state').off('error').off('connect_error')
      socket.disconnect()
      socketRef.current = null
      setSocketId(null)
    }
  }, [])

  const create = (name: string) => {
    setError(null)
    socketRef.current?.emit('create', { name })
  }

  const join = (id: string, name: string) => {
    setError(null)
    socketRef.current?.emit('join', { roomId: id.trim().toLowerCase(), name })
  }

  const start = () => {
    socketRef.current?.emit('start')
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

  const discard = (cardId: string) => {
    socketRef.current?.emit('discard', { cardId })
  }

  const nextRound = () => {
    socketRef.current?.emit('next_round')
  }

  return {
    state,
    roomId,
    error,
    create,
    join,
    start,
    draw,
    playMelds,
    addToMeld,
    discard,
    nextRound,
    socketId,
  }
}
