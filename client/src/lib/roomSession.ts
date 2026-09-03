/** Private, per-tab seat credentials. Never include these in game state or logs. */
export interface RoomSession {
  roomId: string
  playerId: string
  token: string
}

export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const SESSION_KEY = 'conti-room-session-v1'

export function isRoomSession(value: unknown): value is RoomSession {
  if (typeof value !== 'object' || value === null) return false
  const session = value as Partial<RoomSession>
  return typeof session.roomId === 'string' && /^\d{4}$/.test(session.roomId) &&
    typeof session.playerId === 'string' && session.playerId.length > 0 && session.playerId.length <= 128 &&
    typeof session.token === 'string' && session.token.length >= 32 && session.token.length <= 256
}

export function readRoomSession(storage: SessionStorage | null): RoomSession | null {
  try {
    const raw = storage?.getItem(SESSION_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return isRoomSession(value) ? { roomId: value.roomId, playerId: value.playerId, token: value.token } : null
  } catch {
    return null
  }
}

export function writeRoomSession(storage: SessionStorage | null, session: RoomSession | null): boolean {
  if (!storage) return false
  try {
    if (session) storage.setItem(SESSION_KEY, JSON.stringify(session))
    else storage.removeItem(SESSION_KEY)
    return true
  } catch {
    return false
  }
}

/** Socket.IO normally buffers offline emits. Never replay a stale game action. */
export function emitWhenReady(
  socket: { connected: boolean; emit: (event: string, ...args: unknown[]) => unknown } | null,
  ready: boolean,
  event: string,
  ...args: unknown[]
): boolean {
  if (!socket?.connected || !ready) return false
  socket.emit(event, ...args)
  return true
}
