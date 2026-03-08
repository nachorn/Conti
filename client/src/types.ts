export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker'

export interface Card {
  id: string
  suit: Suit
  rank: number
  isWild?: boolean
}

export type MeldType = 'trio' | 'straight'

export interface Meld {
  id: string
  type: MeldType
  cards: Card[]
  ownerId: string
}

export interface RoundContract {
  round: number
  minCards: number
  requirements: { type: MeldType; minLength: number }[]
}

export interface Player {
  id: string
  name: string
  score: number
  hand: Card[]
  connected: boolean
  seatIndex: number
}

export type GamePhase = 'lobby' | 'playing' | 'round_end' | 'game_end'

export interface GameState {
  roomId: string
  phase: GamePhase
  round: number
  contract: RoundContract
  players: Player[]
  currentPlayerIndex: number
  melds: Meld[]
  stockCount: number
  discardPile: unknown[]
  topDiscard: Card | null
  dealerIndex: number
  roundScores: Record<string, number>
  discardOptionPlayerIndex?: number | null
  discarderIndex?: number | null
  discardOptionAvailableAt?: number | null
  deckCount?: 2 | 3
  discardOptionDelaySeconds?: number
  secondsPerTurn?: number
}
