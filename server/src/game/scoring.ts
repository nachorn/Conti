import type { Card } from '../types.js'
import { CARD_PENALTIES } from '../types.js'

export function penaltyForCard(card: Card): number {
  return CARD_PENALTIES[card.rank] ?? 5
}

export function handPenalty(hand: Card[]): number {
  return hand.reduce((sum, c) => sum + penaltyForCard(c), 0)
}
