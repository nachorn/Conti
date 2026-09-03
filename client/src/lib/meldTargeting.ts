import type { Card, Meld } from '../types'
import {
  isValidMeld,
  replaceAndMoveJokerToStraightEnd,
  replaceJokerInStraight,
} from './meld.ts'

export type MeldFitReason =
  | 'fits'
  | 'no-cards'
  | 'wrong-rank'
  | 'wrong-suit'
  | 'duplicate-rank'
  | 'not-consecutive'
  | 'too-many-jokers'
  | 'invalid'

export interface MeldTargetAssessment {
  canAdd: boolean
  reason: MeldFitReason
  replaceableJokerIds: string[]
}

export type JokerSwapMode = 'reclaim' | 'relocate'

export interface MeldTargetOptions {
  /** A player cannot add to exposed melds until their contract is down. */
  allowAdd?: boolean
  /**
   * Before going down, a valid replacement reclaims the Joker for the player's
   * contract. Afterwards the Joker stays in this straight and moves to an end.
   * False disables swaps while a reclaimed Joker is still owed.
   */
  jokerSwapMode?: JokerSwapMode | false
  /**
   * Optional contract-aware gate for a Joker reclaimed before going down.
   * Structural callers may omit it; when supplied, eligibility fails closed
   * unless the exact reclaimed Joker can be used in the player's contract.
   */
  canReclaimJoker?: (joker: Card) => boolean
}

function isJoker(card: Card): boolean {
  return card.suit === 'joker' || card.rank === 0
}

/** Arrange a valid straight in its readable rank order without changing game state. */
export function orderMeldCardsForDisplay(meld: Meld): Card[] {
  if (meld.type !== 'straight' || !isValidMeld(meld.type, meld.cards)) return meld.cards
  const naturalCards = meld.cards.filter((card) => !isJoker(card))
  const jokers = meld.cards.filter(isJoker)

  // Swap helpers return an intentional, ascending layout so the exact Joker a
  // player moved remains visibly at its chosen end. Preserve that layout when
  // it is already legal instead of reassigning physical Jokers to another
  // equally valid rank window.
  const hasAdjacentJokerCards = meld.cards.some(
    (card, index) => index > 0 && isJoker(card) && isJoker(meld.cards[index - 1]!)
  )
  if (!hasAdjacentJokerCards) {
    const aceModes = naturalCards.some((card) => card.rank === 14) ? [false, true] : [false]
    for (const aceLow of aceModes) {
      for (let start = 1; start + meld.cards.length - 1 <= 14; start++) {
        const alreadyOrdered = meld.cards.every((card, index) => {
          if (isJoker(card)) return true
          const rank = aceLow && card.rank === 14 ? 1 : card.rank
          return rank === start + index
        })
        if (alreadyOrdered) return meld.cards
      }
    }
  }
  const variants = naturalCards.some((card) => card.rank === 14)
    ? [
        naturalCards.map((card) => ({ card, rank: card.rank })),
        naturalCards.map((card) => ({ card, rank: card.rank === 14 ? 1 : card.rank })),
      ]
    : [naturalCards.map((card) => ({ card, rank: card.rank }))]

  for (const variant of variants) {
    for (let start = 1; start + meld.cards.length - 1 <= 14; start++) {
      const end = start + meld.cards.length - 1
      if (!variant.every((entry) => entry.rank >= start && entry.rank <= end)) continue
      const byRank = new Map(variant.map((entry) => [entry.rank, entry.card]))
      const missingRanks: number[] = []
      for (let rank = start; rank <= end; rank++) {
        if (!byRank.has(rank)) missingRanks.push(rank)
      }
      if (missingRanks.length !== jokers.length) continue
      const hasAdjacentJokers = missingRanks.some(
        (rank, index) => index > 0 && rank - missingRanks[index - 1]! === 1
      )
      if (hasAdjacentJokers) continue
      const jokerByRank = new Map(missingRanks.map((rank, index) => [rank, jokers[index]!]))
      return Array.from(
        { length: meld.cards.length },
        (_, index) => byRank.get(start + index) ?? jokerByRank.get(start + index)!
      )
    }
  }
  return meld.cards
}

function invalidReason(meld: Meld, combined: Card[]): MeldFitReason {
  const naturalCards = combined.filter((card) => !isJoker(card))
  const jokerCount = combined.length - naturalCards.length

  if (naturalCards.length === 0 || naturalCards.length <= jokerCount) {
    return 'too-many-jokers'
  }

  if (meld.type === 'trio') {
    if (combined.length < 3) return 'invalid'
    const rank = naturalCards[0]?.rank
    return naturalCards.some((card) => card.rank !== rank) ? 'wrong-rank' : 'invalid'
  }

  if (meld.type === 'straight') {
    if (combined.length < 4) return 'invalid'
    const suit = naturalCards[0]?.suit
    if (naturalCards.some((card) => card.suit !== suit)) return 'wrong-suit'
    const ranks = naturalCards.map((card) => card.rank)
    if (new Set(ranks).size !== ranks.length) return 'duplicate-rank'
    return 'not-consecutive'
  }

  return 'invalid'
}

/**
 * Describe whether selected hand cards can be added to a table meld and, for a
 * sole selected natural card, which specific Jokers it can replace.
 */
export function assessMeldTarget(
  meld: Meld,
  selectedCards: Card[],
  options: MeldTargetOptions = {}
): MeldTargetAssessment {
  if (selectedCards.length === 0) {
    return { canAdd: false, reason: 'no-cards', replaceableJokerIds: [] }
  }

  const combined = [...meld.cards, ...selectedCards]
  const canAdd = options.allowAdd !== false && isValidMeld(meld.type, combined)
  const selectedCard = selectedCards.length === 1 ? selectedCards[0] : undefined
  const swapMode = options.jokerSwapMode === undefined ? 'reclaim' : options.jokerSwapMode
  const replaceableJokerIds = selectedCard &&
    !isJoker(selectedCard) &&
    swapMode !== false &&
    meld.type === 'straight'
    ? meld.cards.flatMap((card) => {
        if (!isJoker(card)) return []
        if (swapMode === 'relocate') {
          return replaceAndMoveJokerToStraightEnd(
            meld.cards,
            card.id,
            selectedCard
          ) ? [card.id] : []
        }

        const replacement = replaceJokerInStraight(meld.cards, card.id, selectedCard)
        if (!replacement) return []
        if (
          options.canReclaimJoker &&
          !options.canReclaimJoker(replacement.joker)
        ) return []
        return [card.id]
      })
    : []

  return {
    canAdd,
    reason: canAdd ? 'fits' : invalidReason(meld, combined),
    replaceableJokerIds,
  }
}
