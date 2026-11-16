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
  operations?: DashboardOperations
}

/** Owner-only aggregate measurements; no account identifiers or stored contents. */
export interface DashboardOperations {
  healthy: boolean
  storage: {
    games: { bytes: number; limitBytes: number; usedPercent: number; reservedBytes: number; warning: boolean;
      availableRoomSlots: number; rooms: number; results: number; leagues: number }
    accounts: { bytes: number; limitBytes: number; usedPercent: number; warning: boolean; growthAllowed: boolean } | null
  }
  email: { pending: number; failures: number } | null
  process: { uptimeSeconds: number; rssBytes: number; heapUsedBytes: number }
}
