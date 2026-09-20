import { isRoomSession, type RoomSession, type SessionStorage } from './roomSession.ts'
import type { GameState } from '../types'

export interface SavedGame extends RoomSession {
  gameType: 'continental' | 'pocha'
  playerName: string
  players: string[]
  round: number
  paused: boolean
  updatedAt: number
}
export const SAVED_GAMES_KEY = 'conti-saved-games-v1'
type DeviceStorage = SessionStorage & Pick<Storage, 'length' | 'key'>
const key = (session: RoomSession) => `${SAVED_GAMES_KEY}:${session.roomId}:${session.playerId}`

export function readSavedGames(storage: DeviceStorage | null): SavedGame[] {
  try {
    if (!storage) return []
    const values: unknown[] = []
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i)
      if (!name?.startsWith(`${SAVED_GAMES_KEY}:`)) continue
      try { values.push(JSON.parse(storage.getItem(name) ?? 'null')) } catch { /* Ignore a damaged entry without losing other games. */ }
    }
    return values.filter((v): v is SavedGame => isRoomSession(v) &&
      (v as SavedGame).gameType !== undefined && ['continental', 'pocha'].includes((v as SavedGame).gameType) &&
      typeof (v as SavedGame).playerName === 'string' && Array.isArray((v as SavedGame).players) &&
      (v as SavedGame).players.every(p => typeof p === 'string') &&
      Number.isInteger((v as SavedGame).round) && Number.isFinite((v as SavedGame).updatedAt) &&
      typeof (v as SavedGame).paused === 'boolean')
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch { return [] }
}

/** Store only the private seat key and menu metadata, never hands or game state. */
export function rememberGame(storage: DeviceStorage | null, session: RoomSession, state: GameState): boolean {
  if (!storage || state.roomId !== session.roomId) return false
  const player = state.players.find(p => p.id === session.playerId)
  if (!player) return false
  const entry: SavedGame = {
    ...session, gameType: state.gameType ?? 'continental', playerName: player.name,
    players: state.players.map(p => p.name), round: state.pocha?.handNumber ?? state.round,
    paused: state.savedGame?.paused ?? false, updatedAt: state.savedGame?.updatedAt ?? Date.now(),
  }
  try {
    storage.setItem(key(session), JSON.stringify(entry))
    return true
  } catch { return false }
}

export function forgetGame(storage: DeviceStorage | null, session: RoomSession): boolean {
  if (!storage) return false
  try {
    storage.removeItem(key(session))
    return true
  } catch { return false }
}
