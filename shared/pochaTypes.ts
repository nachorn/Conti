/**
 * Pocha game types. Spanish 40-card deck; separate from Continental.
 * Suits: oros (coins), copas (cups), espadas (swords), bastos (clubs).
 * Ranks: 1=As, 2-7, 10=Sota, 11=Caballo, 12=Rey (no 8 or 9).
 */

export type SpanishSuit = 'oros' | 'copas' | 'espadas' | 'bastos'

export interface PochaCard {
  id: string
  suit: SpanishSuit
  /** 1-7, 10, 11, 12 (no 8 or 9) */
  rank: number
}

/** All valid ranks in a 40-card Spanish deck. */
export const SPANISH_RANKS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const
/** Trick order in Pocha: 1 (As) high, then 3, 12, 11, 10, 7, 6, 5, 4, 2 low. */
export const POCHA_TRICK_ORDER: Record<number, number> = {
  1: 10, 3: 9, 12: 8, 11: 7, 10: 6, 7: 5, 6: 4, 5: 3, 4: 2, 2: 1,
}

export interface PochaPlayer {
  id: string
  name: string
  score: number
  hand: PochaCard[]
  connected: boolean
  seatIndex: number
  /** Current hand bid (number of tricks); null until bid. */
  bid: number | null
  /** Tricks won so far in current hand. */
  tricksWon: number
}

export type PochaPhase = 'lobby' | 'bidding' | 'playing' | 'hand_end' | 'game_end'

/** One card played by a player in the current trick. */
export interface TrickCard {
  playerId: string
  card: PochaCard
}

export interface PochaGameState {
  roomId: string
  phase: PochaPhase
  /** Current hand number (1-based). */
  handNumber: number
  /** Number of cards dealt this hand (1, 2, ... up then down). */
  cardsPerHand: number
  /** Trump suit for this hand; null before trump is set. */
  trump: SpanishSuit | null
  /** Card that sets trump (e.g. turned up); null if trump chosen by rule. */
  trumpCard: PochaCard | null
  players: PochaPlayer[]
  /** Index of dealer (player to dealer's right leads). */
  dealerIndex: number
  /** Index of player who leads the current trick. */
  leadPlayerIndex: number
  /** Cards played in the current trick, in play order. */
  currentTrick: TrickCard[]
  /** Bids for current hand, by player id. */
  bids: Record<string, number>
  /** Who has to bid next (during bidding) or play next (during playing). */
  currentPlayerIndex: number
}
