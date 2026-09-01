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

/** Check if cards form a valid straight: 4+ cards, one suit, consecutive (A-2-3-4 or A-K-Q-J ok; no wrap), more cards than jokers, no two jokers adjacent. */
export function isValidStraight(cards: Card[]): boolean {
  if (cards.length < 4) return false
  const nonWild = cards.filter(c => !c.isWild && c.suit !== 'joker')
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount) return false
  if (nonWild.length === 0) return false
  const suit = nonWild[0]!.suit
  if (nonWild.some(c => c.suit !== suit)) return false
  const ranks = nonWild.map(c => c.rank)
  if (new Set(ranks).size !== ranks.length) return false

  const rankVariants = ranks.includes(14)
    ? [ranks, ranks.map(rank => rank === 14 ? 1 : rank)]
    : [ranks]

  return rankVariants.some(variant => {
    for (let start = 1; start + cards.length - 1 <= 14; start++) {
      const end = start + cards.length - 1
      if (!variant.every(rank => rank >= start && rank <= end)) continue
      const naturalRanks = new Set(variant)
      const wildPositions: number[] = []
      for (let rank = start; rank <= end; rank++) {
        if (!naturalRanks.has(rank)) wildPositions.push(rank)
      }
      if (wildPositions.length !== wildCount) continue
      const hasAdjacentWilds = wildPositions.some((rank, index) => index > 0 && rank - wildPositions[index - 1]! === 1)
      if (!hasAdjacentWilds) return true
    }
    return false
  })
}

export function isValidMeld(type: MeldType, cards: Card[]): boolean {
  return type === 'trio' ? isValidTrio(cards) : isValidStraight(cards)
}

/** Check if a set of melds satisfies the round contract. */
export function satisfiesContract(melds: { type: MeldType; cards: Card[] }[], contract: RoundContract): boolean {
  function matchRequirement(requirementIndex: number, used: Set<number>, totalCards: number): boolean {
    if (requirementIndex >= contract.requirements.length) return totalCards >= contract.minCards
    const requirement = contract.requirements[requirementIndex]!

    for (let meldIndex = 0; meldIndex < melds.length; meldIndex++) {
      if (used.has(meldIndex)) continue
      const meld = melds[meldIndex]!
      if (meld.type !== requirement.type || meld.cards.length < requirement.minLength) continue

      const nextUsed = new Set(used)
      nextUsed.add(meldIndex)
      if (matchRequirement(requirementIndex + 1, nextUsed, totalCards + meld.cards.length)) return true
    }
    return false
  }

  return matchRequirement(0, new Set<number>(), 0)
}

export function getContract(round: number): RoundContract {
  const c = CONTINENTAL_ROUNDS[round - 1]
  if (!c) throw new Error(`Invalid round: ${round}`)
  return c
}

/** Check if a card from hand can replace a joker in this meld (for swap). */
export function canReplaceJokerInMeld(meld: { type: MeldType; cards: Card[] }, card: Card): boolean {
  if (card.suit === 'joker' || card.isWild) return false
  for (let index = 0; index < meld.cards.length; index++) {
    const existing = meld.cards[index]!
    if (existing.suit !== 'joker') continue
    const replaced = [...meld.cards]
    replaced[index] = card
    if (isValidMeld(meld.type, replaced)) return true
  }
  return false
}

function* subsetsOfSize<T>(arr: T[], size: number, start = 0): Generator<T[]> {
  if (size === 0) {
    yield []
    return
  }
  for (let i = start; i <= arr.length - size; i++) {
    const first = arr[i]!
    for (const rest of subsetsOfSize(arr, size - 1, i + 1)) {
      yield [first, ...rest]
    }
  }
}

function trySatisfyContract(hand: Card[], requirements: RoundContract['requirements']): boolean {
  if (requirements.length === 0) return true
  const req = requirements[0]!
  const minLen = req.minLength
  for (let size = minLen; size <= hand.length; size++) {
    for (const subset of subsetsOfSize(hand, size)) {
      if (!isValidMeld(req.type, subset)) continue
      const rest = hand.filter(c => !subset.includes(c))
      if (trySatisfyContract(rest, requirements.slice(1))) return true
    }
  }
  return false
}

/** Whether the given hand can form melds that satisfy the contract (for joker-swap guarantee). */
export function canSatisfyContractWithHand(hand: Card[], contract: RoundContract): boolean {
  if (hand.length < contract.minCards) return false
  return trySatisfyContract(hand, contract.requirements)
}
