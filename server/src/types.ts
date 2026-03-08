/** Card: suit (s) or Joker. Rank 2-14 (2..10,J=11,Q=12,K=13,A=14). Joker has rank 0. */
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

export const CONTINENTAL_ROUNDS: RoundContract[] = [
  { round: 1, minCards: 6, requirements: [{ type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }] },
  { round: 2, minCards: 7, requirements: [{ type: 'trio', minLength: 3 }, { type: 'straight', minLength: 4 }] },
  { round: 3, minCards: 8, requirements: [{ type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }] },
  { round: 4, minCards: 9, requirements: [{ type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }] },
  { round: 5, minCards: 10, requirements: [{ type: 'trio', minLength: 3 }, { type: 'trio', minLength: 3 }, { type: 'straight', minLength: 4 }] },
  { round: 6, minCards: 11, requirements: [{ type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }, { type: 'trio', minLength: 3 }] },
  { round: 7, minCards: 12, requirements: [{ type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }, { type: 'straight', minLength: 4 }] },
]

/** A=20, Joker=50, K/Q/J=10, rest = face value */
export const CARD_PENALTIES: Record<number, number> = {
  0: 50, 14: 20, 13: 10, 12: 10, 11: 10,
  10: 10, 9: 9, 8: 8, 7: 7, 6: 6, 5: 5, 4: 4, 3: 3, 2: 2,
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
  /** When set, this player can take the top discard or pass (only when >2 players). */
  discardOptionPlayerIndex: number | null
  /** Who discarded (index); first to take/pass after is (discarderIndex+1)%n and has priority. */
  discarderIndex: number | null
  /** Timestamp (ms) when take/pass becomes available; before that, countdown is shown. */
  discardOptionAvailableAt: number | null
  /** 2 or 3 decks (lobby option). */
  deckCount: 2 | 3
  /** Seconds to wait before first take/pass option (0 = no delay). */
  discardOptionDelaySeconds: number
  /** Max seconds per turn (0 = no limit). */
  secondsPerTurn: number
}
