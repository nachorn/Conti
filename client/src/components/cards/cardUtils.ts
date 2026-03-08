/** Map game suit to display label and color. */
import type { Suit } from '@shared/types'

export const SUIT_COLOR: Record<Suit, string> = {
  hearts: '#c41e3a',
  diamonds: '#c41e3a',
  clubs: '#1a1a1a',
  spades: '#1a1a1a',
  joker: '#5c2d91',
}

export const SUIT_SYMBOL: Record<Suit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
  joker: '🃏',
}

/** Rank 2–14 (2..10,J,Q,K,A), 0 = joker. */
export function rankLabel(rank: number): string {
  if (rank === 0) return 'Joker'
  if (rank >= 2 && rank <= 10) return String(rank)
  const face: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }
  return face[rank] ?? '?'
}
