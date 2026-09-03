import type { Card, MeldType, RoundContract } from '../types.js'
import { CONTINENTAL_ROUNDS } from '../types.js'

function isJoker(card: Card): boolean {
  return card.suit === 'joker' || card.rank === 0
}

interface StraightLayout {
  start: number
  end: number
  naturalByRank: Map<number, Card>
  wildRanks: number[]
}

/** Enumerate legal rank assignments so a swap cannot reinterpret another Joker's gap. */
function straightLayouts(cards: Card[]): StraightLayout[] {
  if (cards.length < 4 || cards.length > 13) return []
  const nonWild = cards.filter(card => !isJoker(card))
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount || nonWild.length === 0) return []
  const suit = nonWild[0]!.suit
  if (nonWild.some(card => card.suit !== suit)) return []

  const variants: { card: Card; rank: number }[][] = [nonWild.map(card => ({ card, rank: card.rank }))]
  if (nonWild.some(card => card.rank === 14)) {
    variants.push(nonWild.map(card => ({ card, rank: card.rank === 14 ? 1 : card.rank })))
  }

  const layouts: StraightLayout[] = []
  for (const variant of variants) {
    const ranks = variant.map(item => item.rank)
    if (new Set(ranks).size !== ranks.length) continue
    for (let start = 1; start + cards.length - 1 <= 14; start++) {
      const end = start + cards.length - 1
      if (!ranks.every(rank => rank >= start && rank <= end)) continue
      const naturalByRank = new Map(variant.map(item => [item.rank, item.card]))
      const wildRanks: number[] = []
      for (let rank = start; rank <= end; rank++) {
        if (!naturalByRank.has(rank)) wildRanks.push(rank)
      }
      if (wildRanks.length !== wildCount) continue
      const hasAdjacentWilds = wildRanks.some((rank, index) => index > 0 && rank - wildRanks[index - 1]! === 1)
      if (!hasAdjacentWilds) layouts.push({ start, end, naturalByRank, wildRanks })
    }
  }
  return layouts
}

function layoutMatchesCardOrder(cards: Card[], layout: StraightLayout): boolean {
  return cards.every((card, index) => {
    const representedRank = layout.start + index
    if (isJoker(card)) return layout.wildRanks.includes(representedRank)
    return layout.naturalByRank.get(representedRank)?.id === card.id
  })
}

/**
 * Use an already-arranged meld when possible; otherwise use the same first
 * legal layout shown by the client. Joker order then permanently identifies
 * which missing rank each physical Joker represents.
 */
function canonicalStraightLayout(cards: Card[]): StraightLayout | null {
  const layouts = straightLayouts(cards)
  return layouts.find(layout => layoutMatchesCardOrder(cards, layout)) ?? layouts[0] ?? null
}

function representedRankForJoker(layout: StraightLayout, cards: Card[], jokerCardId: string): number | null {
  const jokerIndex = cards.filter(isJoker).findIndex(card => card.id === jokerCardId)
  return jokerIndex < 0 ? null : layout.wildRanks[jokerIndex] ?? null
}

/** Check if cards form a valid trio (same rank, 3+ cards, Jokers allowed). More natural cards than Jokers. */
export function isValidTrio(cards: Card[]): boolean {
  if (cards.length < 3) return false
  const nonWild = cards.filter(card => !isJoker(card))
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount || nonWild.length === 0) return false
  const rank = nonWild[0]!.rank
  return nonWild.every(card => card.rank === rank)
}

/** Check if cards form a valid straight: 4+ cards, one suit, consecutive (A-2-3-4 or A-K-Q-J ok; no wrap), more natural cards than Jokers, no two Jokers adjacent. */
export function isValidStraight(cards: Card[]): boolean {
  return straightLayouts(cards).length > 0
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
  return meld.type === 'straight' && !isJoker(card) && meld.cards.some(
    existing => isJoker(existing) && replaceJokerInStraight(meld.cards, existing.id, card) !== null,
  )
}

function replacementRanks(card: Card): number[] {
  return card.rank === 14 ? [14, 1] : [card.rank]
}

function arrangeReplacement(
  layout: StraightLayout,
  cards: Card[],
  jokerCardId: string,
  replacement: Card,
  replacementRank: number,
): Card[] {
  const otherJokers = cards.filter(card => isJoker(card) && card.id !== jokerCardId)
  const remainingWildRanks = layout.wildRanks.filter(rank => rank !== replacementRank)
  const jokerByRank = new Map(remainingWildRanks.map((rank, index) => [rank, otherJokers[index]!]))
  const arranged: Card[] = []
  for (let rank = layout.start; rank <= layout.end; rank++) {
    const card = rank === replacementRank
      ? replacement
      : layout.naturalByRank.get(rank) ?? jokerByRank.get(rank)
    if (!card) return []
    arranged.push(card)
  }
  return arranged
}

/**
 * Replace the selected Joker's represented rank with a natural card. Used for
 * a player who has not gone down; the returned Joker must enter their contract.
 */
export function replaceJokerInStraight(
  cards: Card[],
  jokerCardId: string,
  replacement: Card,
): { cards: Card[]; joker: Card } | null {
  if (isJoker(replacement)) return null
  const joker = cards.find(card => card.id === jokerCardId && isJoker(card))
  if (!joker) return null
  const naturalSuit = cards.find(card => !isJoker(card))?.suit
  if (!naturalSuit || replacement.suit !== naturalSuit) return null

  const layout = canonicalStraightLayout(cards)
  if (!layout) return null
  const representedRank = representedRankForJoker(layout, cards, jokerCardId)
  if (representedRank === null || !replacementRanks(replacement).includes(representedRank)) return null
  const arranged = arrangeReplacement(layout, cards, jokerCardId, replacement, representedRank)
  return isValidStraight(arranged) ? { cards: arranged, joker } : null
}

/**
 * Replace the selected Joker's gap and move that same Joker to a legal exposed
 * end of this straight. The Joker never leaves the meld.
 */
export function replaceAndMoveJokerToStraightEnd(
  cards: Card[],
  jokerCardId: string,
  replacement: Card,
): Card[] | null {
  if (isJoker(replacement)) return null
  const joker = cards.find(card => card.id === jokerCardId && isJoker(card))
  if (!joker) return null
  const naturalSuit = cards.find(card => !isJoker(card))?.suit
  if (!naturalSuit || replacement.suit !== naturalSuit) return null

  const layout = canonicalStraightLayout(cards)
  if (!layout) return null
  const replacementRank = representedRankForJoker(layout, cards, jokerCardId)
  if (replacementRank === null || !replacementRanks(replacement).includes(replacementRank)) return null
  const otherJokers = cards.filter(card => isJoker(card) && card.id !== jokerCardId)
  const remainingWildRanks = layout.wildRanks.filter(rank => rank !== replacementRank)

  // If both ends work, extending the high end is the deterministic choice.
  for (const exposedRank of [layout.end + 1, layout.start - 1]) {
    if (exposedRank < 1 || exposedRank > 14) continue
    const wildRanks = [...remainingWildRanks, exposedRank].sort((a, b) => a - b)
    const hasAdjacentWilds = wildRanks.some((rank, index) => index > 0 && rank - wildRanks[index - 1]! === 1)
    if (hasAdjacentWilds) continue

    const jokerByRank = new Map(remainingWildRanks.map((rank, index) => [rank, otherJokers[index]!]))
    jokerByRank.set(exposedRank, joker)
    const start = Math.min(layout.start, exposedRank)
    const end = Math.max(layout.end, exposedRank)
    const arranged: Card[] = []
    for (let rank = start; rank <= end; rank++) {
      const card = rank === replacementRank
        ? replacement
        : layout.naturalByRank.get(rank) ?? jokerByRank.get(rank)
      if (!card) return null
      arranged.push(card)
    }
    if (isValidStraight(arranged) && (arranged[0]?.id === joker.id || arranged.at(-1)?.id === joker.id)) {
      return arranged
    }
  }
  return null
}

const NATURAL_SUITS: Exclude<Card['suit'], 'joker'>[] = ['hearts', 'diamonds', 'clubs', 'spades']

interface CardPoolSelection {
  cards: Card[]
  count: number
}

/** Keep one structural choice plus include/exclude variants for an exact required card. */
function equivalentSelections(cards: Card[], count: number, requiredCardId?: string): Card[][] {
  if (count < 0 || count > cards.length) return []
  if (count === 0) return [[]]

  const variants: Card[][] = [cards.slice(0, count)]
  const required = requiredCardId ? cards.find(card => card.id === requiredCardId) : undefined
  if (required) {
    const withoutRequired = cards.filter(card => card.id !== required.id)
    if (count <= withoutRequired.length) variants.push(withoutRequired.slice(0, count))
    if (count >= 1 && count - 1 <= withoutRequired.length) {
      variants.push([required, ...withoutRequired.slice(0, count - 1)])
    }
  }

  const seen = new Set<string>()
  return variants.filter(variant => {
    const key = variant.map(card => card.id).sort().join(',')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function* combinePoolSelections(
  pools: CardPoolSelection[],
  requiredCardId: string | undefined,
  index = 0,
  selected: Card[] = [],
): Generator<Card[]> {
  if (index >= pools.length) {
    yield selected
    return
  }
  const pool = pools[index]!
  for (const choice of equivalentSelections(pool.cards, pool.count, requiredCardId)) {
    yield* combinePoolSelections(pools, requiredCardId, index + 1, [...selected, ...choice])
  }
}

function* trioCandidates(
  cards: Card[],
  minLength: number,
  maxLength: number,
  requiredCardId?: string,
): Generator<Card[]> {
  const jokers = cards.filter(isJoker)
  const naturalByRank = new Map<number, Card[]>()
  for (const card of cards) {
    if (isJoker(card)) continue
    const rankCards = naturalByRank.get(card.rank) ?? []
    rankCards.push(card)
    naturalByRank.set(card.rank, rankCards)
  }

  for (const rankCards of naturalByRank.values()) {
    const suitPools = NATURAL_SUITS.map(suit => rankCards.filter(card => card.suit === suit))

    function* chooseSuitCounts(
      suitIndex: number,
      counts: number[],
      naturalCount: number,
    ): Generator<Card[]> {
      if (suitIndex < suitPools.length) {
        const pool = suitPools[suitIndex]!
        const countLimit = Math.min(pool.length, maxLength - naturalCount)
        for (let count = 0; count <= countLimit; count++) {
          yield* chooseSuitCounts(suitIndex + 1, [...counts, count], naturalCount + count)
        }
        return
      }

      if (naturalCount === 0) return
      const maxJokers = Math.min(jokers.length, naturalCount - 1, maxLength - naturalCount)
      for (let jokerCount = 0; jokerCount <= maxJokers; jokerCount++) {
        if (naturalCount + jokerCount < minLength) continue
        const pools: CardPoolSelection[] = suitPools.map((pool, index) => ({
          cards: pool,
          count: counts[index] ?? 0,
        }))
        pools.push({ cards: jokers, count: jokerCount })
        yield* combinePoolSelections(pools, requiredCardId)
      }
    }

    yield* chooseSuitCounts(0, [], 0)
  }
}

function* straightCandidates(
  cards: Card[],
  minLength: number,
  maxLength: number,
  requiredCardId?: string,
): Generator<Card[]> {
  const jokers = cards.filter(isJoker)

  for (const suit of NATURAL_SUITS) {
    const cardsByRank = new Map<number, Card[]>()
    for (const card of cards) {
      if (isJoker(card) || card.suit !== suit) continue
      const rankCards = cardsByRank.get(card.rank) ?? []
      rankCards.push(card)
      cardsByRank.set(card.rank, rankCards)
    }

    for (let length = minLength; length <= Math.min(13, maxLength); length++) {
      for (let start = 1; start + length - 1 <= 14; start++) {
        const useNatural: boolean[] = []

        function* chooseRanks(
          offset: number,
          naturalCount: number,
          jokerCount: number,
          previousWasJoker: boolean,
        ): Generator<Card[]> {
          if (offset >= length) {
            if (naturalCount <= jokerCount) return
            const naturalPools: CardPoolSelection[] = []
            for (let index = 0; index < length; index++) {
              if (!useNatural[index]) continue
              const representedRank = start + index
              const actualRank = representedRank === 1 ? 14 : representedRank
              naturalPools.push({ cards: cardsByRank.get(actualRank) ?? [], count: 1 })
            }

            for (const naturals of combinePoolSelections(naturalPools, requiredCardId)) {
              for (const chosenJokers of equivalentSelections(jokers, jokerCount, requiredCardId)) {
                const candidate: Card[] = []
                let naturalIndex = 0
                let jokerIndex = 0
                for (const natural of useNatural) {
                  candidate.push(natural ? naturals[naturalIndex++]! : chosenJokers[jokerIndex++]!)
                }
                yield candidate
              }
            }
            return
          }

          const representedRank = start + offset
          const actualRank = representedRank === 1 ? 14 : representedRank
          if ((cardsByRank.get(actualRank)?.length ?? 0) > 0) {
            useNatural.push(true)
            yield* chooseRanks(offset + 1, naturalCount + 1, jokerCount, false)
            useNatural.pop()
          }
          if (!previousWasJoker && jokerCount < jokers.length) {
            useNatural.push(false)
            yield* chooseRanks(offset + 1, naturalCount, jokerCount + 1, true)
            useNatural.pop()
          }
        }

        yield* chooseRanks(0, 0, 0, false)
      }
    }
  }
}

function meldCandidates(
  cards: Card[],
  type: MeldType,
  minLength: number,
  maxLength: number,
  requiredCardId?: string,
): Generator<Card[]> {
  return type === 'trio'
    ? trioCandidates(cards, minLength, maxLength, requiredCardId)
    : straightCandidates(cards, minLength, maxLength, requiredCardId)
}

function inventorySignature(cards: Card[], requiredCardId?: string): string {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = isJoker(card) ? 'joker' : `${card.suit}:${card.rank}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const requiredPresent = requiredCardId ? cards.some(card => card.id === requiredCardId) : false
  return `${requiredPresent ? 1 : 0}|${[...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}:${count}`)
    .join(';')}`
}

function findContractMelds(
  hand: Card[],
  requirements: RoundContract['requirements'],
  minCards: number,
  cardsUsed: number,
  requiredCardId?: string,
  requiredCardUsed = false,
  failedStates = new Set<string>(),
): { type: MeldType; cards: Card[] }[] | null {
  if (requirements.length === 0) {
    return cardsUsed >= minCards && (!requiredCardId || requiredCardUsed) ? [] : null
  }

  if (requiredCardId && !requiredCardUsed && !hand.some(card => card.id === requiredCardId)) return null
  const stateKey = `${requirements.map(requirement => `${requirement.type}:${requirement.minLength}`).join(',')}|${cardsUsed}|${requiredCardUsed ? 1 : 0}|${inventorySignature(hand, requiredCardId)}`
  if (failedStates.has(stateKey)) return null

  const req = requirements[0]!
  const minLen = req.minLength
  const remainingMinimum = requirements.slice(1).reduce((sum, requirement) => sum + requirement.minLength, 0)
  const maxLength = hand.length - remainingMinimum
  if (maxLength < minLen) {
    failedStates.add(stateKey)
    return null
  }

  for (const candidate of meldCandidates(hand, req.type, minLen, maxLength, requiredCardId)) {
    const candidateIds = new Set(candidate.map(card => card.id))
    const rest = hand.filter(card => !candidateIds.has(card.id))
    const tail = findContractMelds(
      rest,
      requirements.slice(1),
      minCards,
      cardsUsed + candidate.length,
      requiredCardId,
      requiredCardUsed || candidateIds.has(requiredCardId ?? ''),
      failedStates,
    )
    if (tail) return [{ type: req.type, cards: candidate }, ...tail]
  }
  failedStates.add(stateKey)
  return null
}

/** Find one exact set of hand melds satisfying the contract. */
export function findContractMeldsInHand(
  hand: Card[],
  contract: RoundContract,
  requiredCardId?: string,
): { type: MeldType; cards: Card[] }[] | null {
  if (hand.length < contract.minCards) return null
  if (requiredCardId && !hand.some(card => card.id === requiredCardId)) return null
  return findContractMelds(hand, contract.requirements, contract.minCards, 0, requiredCardId)
}

/** Whether the hand can form its contract, optionally requiring one exact card. */
export function canSatisfyContractWithHand(hand: Card[], contract: RoundContract, requiredCardId?: string): boolean {
  return findContractMeldsInHand(hand, contract, requiredCardId) !== null
}
