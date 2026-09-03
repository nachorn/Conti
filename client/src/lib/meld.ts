import type { Card, MeldType, RoundContract } from '../types'

function isWild(c: Card): boolean {
  return c.suit === 'joker' || c.rank === 0
}

interface StraightLayout {
  start: number
  end: number
  naturalByRank: Map<number, Card>
  wildRanks: number[]
}

function straightLayouts(cards: Card[]): StraightLayout[] {
  if (cards.length < 4 || cards.length > 13) return []
  const naturalCards = cards.filter((card) => !isWild(card))
  const jokerCount = cards.length - naturalCards.length
  if (naturalCards.length === 0 || naturalCards.length <= jokerCount) return []
  const suit = naturalCards[0]!.suit
  if (naturalCards.some((card) => card.suit !== suit)) return []

  const variants: { card: Card; rank: number }[][] = [
    naturalCards.map((card) => ({ card, rank: card.rank })),
  ]
  if (naturalCards.some((card) => card.rank === 14)) {
    variants.push(naturalCards.map((card) => ({
      card,
      rank: card.rank === 14 ? 1 : card.rank,
    })))
  }

  const layouts: StraightLayout[] = []
  for (const variant of variants) {
    const ranks = variant.map((entry) => entry.rank)
    if (new Set(ranks).size !== ranks.length) continue
    for (let start = 1; start + cards.length - 1 <= 14; start++) {
      const end = start + cards.length - 1
      if (!ranks.every((rank) => rank >= start && rank <= end)) continue
      const naturalByRank = new Map(variant.map((entry) => [entry.rank, entry.card]))
      const wildRanks: number[] = []
      for (let rank = start; rank <= end; rank++) {
        if (!naturalByRank.has(rank)) wildRanks.push(rank)
      }
      if (wildRanks.length !== jokerCount) continue
      const hasAdjacentJokers = wildRanks.some(
        (rank, index) => index > 0 && rank - wildRanks[index - 1]! === 1
      )
      if (!hasAdjacentJokers) layouts.push({ start, end, naturalByRank, wildRanks })
    }
  }
  return layouts
}

function layoutMatchesCardOrder(cards: Card[], layout: StraightLayout): boolean {
  return cards.every((card, index) => {
    const representedRank = layout.start + index
    if (isWild(card)) return layout.wildRanks.includes(representedRank)
    return layout.naturalByRank.get(representedRank)?.id === card.id
  })
}

/** Preserve an intentional ordered layout; otherwise use the first legal one. */
function canonicalStraightLayout(cards: Card[]): StraightLayout | null {
  const layouts = straightLayouts(cards)
  return layouts.find((layout) => layoutMatchesCardOrder(cards, layout)) ?? layouts[0] ?? null
}

function representedRankForJoker(
  layout: StraightLayout,
  cards: Card[],
  jokerCardId: string
): number | null {
  const jokerIndex = cards.filter(isWild).findIndex((card) => card.id === jokerCardId)
  return jokerIndex < 0 ? null : layout.wildRanks[jokerIndex] ?? null
}

export function isValidTrio(cards: Card[]): boolean {
  if (cards.length < 3) return false
  const nonWild = cards.filter((c) => !isWild(c))
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount) return false
  if (nonWild.length === 0) return false
  const rank = nonWild[0]!.rank
  if (nonWild.some((c) => c.rank !== rank)) return false
  return true
}

export function isValidStraight(cards: Card[]): boolean {
  return straightLayouts(cards).length > 0
}

export function isValidMeld(type: MeldType, cards: Card[]): boolean {
  return type === 'trio' ? isValidTrio(cards) : isValidStraight(cards)
}

function replacementRanks(card: Card): number[] {
  return card.rank === 14 ? [14, 1] : [card.rank]
}

function arrangeReplacement(
  layout: StraightLayout,
  cards: Card[],
  jokerCardId: string,
  replacement: Card,
  replacementRank: number
): Card[] {
  const otherJokers = cards.filter((card) => isWild(card) && card.id !== jokerCardId)
  const remainingWildRanks = layout.wildRanks.filter((rank) => rank !== replacementRank)
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

/** Replace one exact straight Joker and return that same card for reclaiming. */
export function replaceJokerInStraight(
  cards: Card[],
  jokerCardId: string,
  replacement: Card
): { cards: Card[]; joker: Card } | null {
  if (isWild(replacement)) return null
  const joker = cards.find((card) => card.id === jokerCardId && isWild(card))
  if (!joker) return null
  const naturalSuit = cards.find((card) => !isWild(card))?.suit
  if (!naturalSuit || replacement.suit !== naturalSuit) return null

  const layout = canonicalStraightLayout(cards)
  if (!layout) return null
  const representedRank = representedRankForJoker(layout, cards, jokerCardId)
  if (representedRank === null || !replacementRanks(replacement).includes(representedRank)) return null
  const arranged = arrangeReplacement(layout, cards, jokerCardId, replacement, representedRank)
  return isValidStraight(arranged) ? { cards: arranged, joker } : null
}

/** Replace one exact straight Joker and move that same Joker to an exposed end. */
export function replaceAndMoveJokerToStraightEnd(
  cards: Card[],
  jokerCardId: string,
  replacement: Card
): Card[] | null {
  if (isWild(replacement)) return null
  const joker = cards.find((card) => card.id === jokerCardId && isWild(card))
  if (!joker) return null
  const naturalSuit = cards.find((card) => !isWild(card))?.suit
  if (!naturalSuit || replacement.suit !== naturalSuit) return null

  const layout = canonicalStraightLayout(cards)
  if (!layout) return null
  const replacementRank = representedRankForJoker(layout, cards, jokerCardId)
  if (replacementRank === null || !replacementRanks(replacement).includes(replacementRank)) return null
  const otherJokers = cards.filter((card) => isWild(card) && card.id !== jokerCardId)
  const remainingWildRanks = layout.wildRanks.filter((rank) => rank !== replacementRank)

  for (const exposedRank of [layout.end + 1, layout.start - 1]) {
    if (exposedRank < 1 || exposedRank > 14) continue
    const wildRanks = [...remainingWildRanks, exposedRank].sort((a, b) => a - b)
    const hasAdjacentJokers = wildRanks.some(
      (rank, index) => index > 0 && rank - wildRanks[index - 1]! === 1
    )
    if (hasAdjacentJokers) continue

    const jokerByRank = new Map(
      remainingWildRanks.map((rank, index) => [rank, otherJokers[index]!])
    )
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
    const lastCard = arranged[arranged.length - 1]
    if (
      isValidStraight(arranged) &&
      (arranged[0]?.id === joker.id || lastCard?.id === joker.id)
    ) {
      return arranged
    }
  }
  return null
}

const NATURAL_SUITS: Exclude<Card['suit'], 'joker'>[] = [
  'hearts',
  'diamonds',
  'clubs',
  'spades',
]

interface CardPoolSelection {
  cards: Card[]
  count: number
}

/**
 * Cards with the same suit/rank are interchangeable for validation, except
 * for the one exact card a caller may require. Keep just the canonical choice
 * plus include/exclude variants for that required identity.
 */
function equivalentSelections(
  cards: Card[],
  count: number,
  requiredCardId?: string
): Card[][] {
  if (count < 0 || count > cards.length) return []
  if (count === 0) return [[]]

  const variants: Card[][] = [cards.slice(0, count)]
  const required = requiredCardId
    ? cards.find((card) => card.id === requiredCardId)
    : undefined
  if (required) {
    const withoutRequired = cards.filter((card) => card.id !== required.id)
    if (count <= withoutRequired.length) variants.push(withoutRequired.slice(0, count))
    if (count >= 1 && count - 1 <= withoutRequired.length) {
      variants.push([required, ...withoutRequired.slice(0, count - 1)])
    }
  }

  const seen = new Set<string>()
  return variants.filter((variant) => {
    const key = variant.map((card) => card.id).sort().join(',')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function* combinePoolSelections(
  pools: CardPoolSelection[],
  requiredCardId: string | undefined,
  index = 0,
  selected: Card[] = []
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
  requiredCardId?: string
): Generator<Card[]> {
  const jokers = cards.filter(isWild)
  const naturalByRank = new Map<number, Card[]>()
  for (const card of cards) {
    if (isWild(card)) continue
    const rankCards = naturalByRank.get(card.rank) ?? []
    rankCards.push(card)
    naturalByRank.set(card.rank, rankCards)
  }

  for (const rankCards of naturalByRank.values()) {
    const suitPools = NATURAL_SUITS.map((suit) =>
      rankCards.filter((card) => card.suit === suit)
    )

    function* chooseSuitCounts(
      suitIndex: number,
      counts: number[],
      naturalCount: number
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
  requiredCardId?: string
): Generator<Card[]> {
  const jokers = cards.filter(isWild)

  for (const suit of NATURAL_SUITS) {
    const cardsByRank = new Map<number, Card[]>()
    for (const card of cards) {
      if (isWild(card) || card.suit !== suit) continue
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
          previousWasJoker: boolean
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
                  candidate.push(natural
                    ? naturals[naturalIndex++]!
                    : chosenJokers[jokerIndex++]!)
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
  requiredCardId?: string
): Generator<Card[]> {
  return type === 'trio'
    ? trioCandidates(cards, minLength, maxLength, requiredCardId)
    : straightCandidates(cards, minLength, maxLength, requiredCardId)
}

function inventorySignature(cards: Card[], requiredCardId?: string): string {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = isWild(card) ? 'joker' : `${card.suit}:${card.rank}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const requiredPresent = requiredCardId
    ? cards.some((card) => card.id === requiredCardId)
    : false
  return `${requiredPresent ? 1 : 0}|${[...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, count]) => `${key}:${count}`)
    .join(';')}`
}

function findContractMelds(
  cards: Card[],
  requirements: RoundContract['requirements'],
  minCards: number,
  cardsUsed: number,
  requiredCardId?: string,
  requiredCardUsed = false,
  requireAllCards = false,
  failedStates = new Set<string>()
): { type: MeldType; cards: Card[] }[] | null {
  if (requirements.length === 0) {
    return cardsUsed >= minCards &&
      (!requiredCardId || requiredCardUsed) &&
      (!requireAllCards || cards.length === 0)
      ? []
      : null
  }

  if (requiredCardId && !requiredCardUsed && !cards.some((card) => card.id === requiredCardId)) {
    return null
  }
  const stateKey = `${requirements.map((requirement) => `${requirement.type}:${requirement.minLength}`).join(',')}|${cardsUsed}|${requiredCardUsed ? 1 : 0}|${inventorySignature(cards, requiredCardId)}`
  if (failedStates.has(stateKey)) return null

  const req = requirements[0]!
  const minLength = req.minLength
  const remainingMinimum = requirements
    .slice(1)
    .reduce((sum, requirement) => sum + requirement.minLength, 0)
  const maxLength = cards.length - remainingMinimum
  if (maxLength < minLength) {
    failedStates.add(stateKey)
    return null
  }

  for (const candidate of meldCandidates(cards, req.type, minLength, maxLength, requiredCardId)) {
    const candidateIds = new Set(candidate.map((card) => card.id))
    const remaining = cards.filter((card) => !candidateIds.has(card.id))
    const tail = findContractMelds(
      remaining,
      requirements.slice(1),
      minCards,
      cardsUsed + candidate.length,
      requiredCardId,
      requiredCardUsed || (
        requiredCardId !== undefined && candidateIds.has(requiredCardId)
      ),
      requireAllCards,
      failedStates
    )
    if (tail) return [{ type: req.type, cards: candidate }, ...tail]
  }
  failedStates.add(stateKey)
  return null
}

/**
 * Find one exact set of hand melds satisfying the contract. When provided, the
 * required card ID must appear in the returned contract. Set requireAllCards
 * when every selected card must be included in the opening contract.
 */
export function findMeldsForContract(
  cards: Card[],
  contract: RoundContract,
  requiredCardId?: string,
  requireAllCards = false
): { type: MeldType; cards: Card[] }[] | null {
  if (cards.length < contract.minCards) return null
  if (requiredCardId && !cards.some((card) => card.id === requiredCardId)) return null
  return findContractMelds(
    cards,
    contract.requirements,
    contract.minCards,
    0,
    requiredCardId,
    false,
    requireAllCards
  )
}
