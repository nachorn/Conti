/** Public ad-break state. Never include membership credentials or account details here. */
export type AdProvider = 'disabled' | 'google-h5'
export type AdOutcome = 'viewed' | 'dismissed' | 'unavailable' | 'error'
export type AdPlayerStatus = 'pending' | 'viewing' | 'ready'

export interface AdGateState {
  roomId: string
  cycle: string
  enabled: boolean
  exempt: boolean
  provider: AdProvider
  publisherId: string | null
  phase: 'lobby' | 'playing' | 'round_end' | 'game_end'
  required: boolean
  canStart: boolean
  players: { playerId: string; status: AdPlayerStatus; connected: boolean }[]
}

export interface AdBeginResult {
  ok: boolean
  attemptId?: string
  error?: string
  code?: string
}

export interface AdCompletePayload {
  attemptId: string
  outcome: AdOutcome
}
