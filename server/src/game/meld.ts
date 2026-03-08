import type { Card, MeldType, RoundContract } from '../types.js'
import { CONTINENTAL_ROUNDS } from '../types.js'

/** Check if cards form a valid trio (same rank, 3+ cards, wilds allowed). More natural cards than jokers. */
export function isValidTrio(cards: Card[]): boolean {
  if (cards.length < 3) return false
  const nonWild = cards.filter(c => !c.isWild && c.suit !== 'joker')
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount) return false
  if (nonWild.length === 0) return false
  const rank = nonWild[0]!.rank
  if (nonWild.some(c => c.rank !== rank)) return false
  return nonWild.length + wildCount >= 3
}

/** Missing ranks in [min, max] not present in ranks. */
function missingRanks(ranks: number[], min: number, max: number): number[] {
  const set = new Set(ranks)
  const out: number[] = []
  for (let r = min; r <= max; r++) {
    if (!set.has(r)) out.push(r)
  }
  return out
}

/** Check if cards form a valid straight: 4+ cards, same suit, consecutive, no two jokers adjacent, more natural than jokers. */
export function isValidStraight(cards: Card[]): boolean {
  if (cards.length < 4) return false
  const nonWild = cards.filter(c => !c.isWild && c.suit !== 'joker').sort((a, b) => a.rank - b.rank)
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount) return false
  if (nonWild.length === 0) return false
  const suit = nonWild[0]!.suit
  if (nonWild.some(c => c.suit !== suit)) return false
  const ranks = nonWild.map(c => c.rank)
  const min = Math.min(...ranks)
  const max = Math.max(...ranks)
  if (max - min > 12) return false
  const span = max - min + 1
  if (span > cards.length) return false
  const holes = span - nonWild.length
  if (holes > wildCount) return false
  const missing = missingRanks(ranks, min, max)
  for (let i = 0; i < missing.length - 1; i++) {
    if (missing[i + 1]! - missing[i]! === 1) return false
  }
  return true
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

/** Check if a card from hand can replace a joker in this meld (for swap). */
export function canReplaceJokerInMeld(meld: { type: MeldType; cards: Card[] }, card: Card): boolean {
  if (card.suit === 'joker' || card.isWild) return false
  const jokerCount = meld.cards.filter(c => c.isWild || c.suit === 'joker').length
  if (jokerCount === 0) return false
  const nonWild = meld.cards.filter(c => !c.isWild && c.suit !== 'joker')
  if (meld.type === 'trio') {
    if (nonWild.length === 0) return false
    const rank = nonWild[0]!.rank
    return card.rank === rank
  }
  if (meld.type === 'straight') {
    if (nonWild.length === 0) return false
    const suit = nonWild[0]!.suit
    if (card.suit !== suit) return false
    const ranks = nonWild.map(c => c.rank)
    const min = Math.min(...ranks)
    const max = Math.max(...ranks)
    const missing = missingRanks(ranks, min, max)
    return missing.includes(card.rank)
  }
  return false
}
