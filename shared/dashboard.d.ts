/** Allowlisted dashboard response. Never include cards or recovery credentials. */
export interface DashboardPlayer {
  id: string
  name: string
  online: boolean
  host: boolean
}

export interface DashboardRoom {
  roomId: string
  gameType: 'continental' | 'pocha'
  phase: 'lobby' | 'playing' | 'round_end' | 'game_end' | 'auction' | 'choosing_trump' | 'bidding' | 'hand_end'
  round: number | null
  totalRounds: number
  onlinePlayers: number
  currentPlayerId: string | null
  updatedAt: number
  players: DashboardPlayer[]
}

export interface DashboardSnapshot {
  generatedAt: number
  summary: { onlinePlayers: number; activeRooms: number; waitingRooms: number; offlineRooms: number }
  rooms: DashboardRoom[]
}
