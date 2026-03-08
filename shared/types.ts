/** Card: suit (s) or Joker. Rank 2-14 (2..10,J=11,Q=12,K=13,A=14). Joker has rank 0. */
export type Suit = 'hearts' | 'diamonds' | 'clubs' | 'spades' | 'joker'

export interface Card {
  id: string
  suit: Suit
  rank: number // 2-14, 0 for joker
  isWild?: boolean // deuce or joker
}

/** Melds: trio = same rank; straight = same suit, consecutive (ace high or low, no wrap). */
export type MeldType = 'trio' | 'straight'

export interface Meld {
  id: string
  type: MeldType
  cards: Card[]
  ownerId: string
}

/** Round contract: what melds are required to "go down" and end the round. */
export interface RoundContract {
  round: number
  minCards: number
  requirements: { type: MeldType; minLength: number }[]
}

/** Standard 7-round Continental contracts. */
export const CONTINENTAL_ROUNDS: RoundContract[] = [
  { round: 1, minCards: 6, requirements: [{ type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }] },
  { round: 2, minCards: 7, requirements: [{ type: 'trio', minLength: 3 }, { type: 'straight', minLength: 4 }] },
  { round: 3, minCards: 8, requirements: [{ type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }] },
  { round: 4, minCards: 9, requirements: [{ type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }] },
  { round: 5, minCards: 10, requirements: [{ type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }, { type: 'straight', minLength: 4 }] },
  { round: 6, minCards: 11, requirements: [{ type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }, { type: 'trio', minLength: 3 }] },
  { round: 7, minCards: 12, requirements: [{ type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }] },
]

/** Penalty values (for round-end scoring; lowest total wins the round). */
export const CARD_PENALTIES: Record<number, number> = {
  0: 50,   // Joker
  14: 20,  // Ace
  13: 10,  // K
  12: 10,  // Q
  11: 10,  // J
  10: 10,  // 10
  9: 5, 8: 5, 7: 5, 6: 5, 5: 5, 4: 5, 3: 5, 2: 5,
}

export interface Player {
  id: string
  name: string
  score: number
  hand: Card[]
  connected: boolean
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
  discardPile: Card[]
  topDiscard: Card | null
  dealerIndex: number
  roundScores: Record<string, number>
}
