import type { Card, MeldType, RoundContract } from '../types.js'
import { CONTINENTAL_ROUNDS } from '../types.js'

/** Check if cards form a valid trio (same rank, 3+ cards, wilds allowed). */
export function isValidTrio(cards: Card[]): boolean {
  if (cards.length < 3) return false
  const nonWild = cards.filter(c => !c.isWild)
  const wildCount = cards.length - nonWild.length
  if (nonWild.length === 0) return wildCount >= 3
  const rank = nonWild[0]!.rank
  if (nonWild.some(c => c.rank !== rank)) return false
  return nonWild.length + wildCount >= 3
}

/** Check if cards form a valid straight (same suit, consecutive; ace high or low; no wrap). */
export function isValidStraight(cards: Card[]): boolean {
  if (cards.length < 3) return false
  const nonWild = cards.filter(c => !c.isWild).sort((a, b) => a.rank - b.rank)
  const wildCount = cards.length - nonWild.length
  if (nonWild.length === 0) return cards.length >= 3
  const suit = nonWild[0]!.suit
  if (suit === 'joker' || nonWild.some(c => c.suit !== suit)) return false
  const ranks = nonWild.map(c => c.rank)
  const min = Math.min(...ranks)
  const max = Math.max(...ranks)
  if (max - min > 12) return false
  const span = max - min + 1
  if (span > cards.length) return false
  const holes = span - nonWild.length
  return holes <= wildCount
}

export function isValidMeld(type: MeldType, cards: Card[]): boolean {
  return type === 'trio' ? isValidTrio(cards) : isValidStraight(cards)
}

/** Check if a set of melds satisfies the round contract. */
export function satisfiesContract(melds: { type: MeldType; cards: Card[] }[], contract: RoundContract): boolean {
  const byType = { trio: melds.filter(m => m.type === 'trio'), straight: melds.filter(m => m.type === 'straight') }
  let totalCards = 0
  for (const req of contract.requirements) {
    const list = byType[req.type]
    const match = list.find(m => m.cards.length >= req.minLength)
    if (!match) return false
    totalCards += match.cards.length
  }
  return totalCards >= contract.minCards
}

export function getContract(round: number): RoundContract {
  const c = CONTINENTAL_ROUNDS[round - 1]
  if (!c) throw new Error(`Invalid round: ${round}`)
  return c
}
