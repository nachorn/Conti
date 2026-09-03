import type { Card, MeldType, RoundContract } from '../types'

function isWild(c: Card): boolean {
  return c.suit === 'joker' || c.rank === 0
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
  if (cards.length < 4) return false
  const nonWild = cards.filter((c) => !isWild(c))
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount) return false
  if (nonWild.length === 0) return false
  const suit = nonWild[0]!.suit
  if (nonWild.some((c) => c.suit !== suit)) return false
  const ranks = nonWild.map((c) => c.rank)
  if (new Set(ranks).size !== ranks.length) return false

  const rankVariants = ranks.includes(14)
    ? [ranks, ranks.map((rank) => rank === 14 ? 1 : rank)]
    : [ranks]

  return rankVariants.some((variant) => {
    for (let start = 1; start + cards.length - 1 <= 14; start++) {
      const end = start + cards.length - 1
      if (!variant.every((rank) => rank >= start && rank <= end)) continue
      const naturalRanks = new Set(variant)
      const wildPositions: number[] = []
      for (let rank = start; rank <= end; rank++) {
        if (!naturalRanks.has(rank)) wildPositions.push(rank)
      }
      if (wildPositions.length !== wildCount) continue
      const hasAdjacentWilds = wildPositions.some(
        (rank, index) => index > 0 && rank - wildPositions[index - 1]! === 1
      )
      if (!hasAdjacentWilds) return true
    }
    return false
  })
}

export function isValidMeld(type: MeldType, cards: Card[]): boolean {
  return type === 'trio' ? isValidTrio(cards) : isValidStraight(cards)
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

function buildMeldsOfType(cards: Card[], type: MeldType, minLength: number): { type: MeldType; cards: Card[] }[] {
  const out: { type: MeldType; cards: Card[] }[] = []
  if (type === 'trio') {
    const wilds = cards.filter(isWild)
    const byRank = new Map<number, Card[]>()
    for (const c of cards) {
      if (isWild(c)) continue
      const list = byRank.get(c.rank) ?? []
      list.push(c)
      byRank.set(c.rank, list)
    }
    for (const [, list] of byRank) {
      if (list.length >= 3) {
        out.push({ type: 'trio', cards: list.slice(0, 3) })
      }
      const needWilds = 3 - list.length
      if (needWilds > 0 && needWilds <= wilds.length && list.length > needWilds) {
        out.push({
          type: 'trio',
          cards: [...list, ...wilds.slice(0, needWilds)],
        })
      }
    }
  } else {
    for (let size = minLength; size <= cards.length; size++) {
      for (const subset of subsetsOfSize(cards, size)) {
        if (isValidStraight(subset)) {
          out.push({ type: 'straight', cards: subset })
        }
      }
    }
  }
  return out
}

function tryFillContract(
  requirements: RoundContract['requirements'],
  reqIndex: number,
  availableCards: Card[],
  acc: { type: MeldType; cards: Card[] }[]
): { type: MeldType; cards: Card[] }[] | null {
  if (reqIndex >= requirements.length) return acc
  const req = requirements[reqIndex]!
  const candidates = buildMeldsOfType(availableCards, req.type, req.minLength)
  const usedIds = new Set(acc.flatMap((m) => m.cards.map((c) => c.id)))
  for (const meld of candidates) {
    if (meld.cards.length < req.minLength) continue
    const meldIds = new Set(meld.cards.map((c) => c.id))
    if ([...meldIds].some((id) => usedIds.has(id))) continue
    const remaining = availableCards.filter((c) => !meldIds.has(c.id))
    const next = tryFillContract(requirements, reqIndex + 1, remaining, [...acc, meld])
    if (next) return next
  }
  return null
}

/**
 * From the given cards, find a set of melds that satisfies the contract (one meld per requirement, no card reused).
 * Returns the melds to send or null if impossible.
 */
export function findMeldsForContract(
  cards: Card[],
  contract: RoundContract
): { type: MeldType; cards: Card[] }[] | null {
  if (cards.length < contract.minCards) return null
  return tryFillContract(contract.requirements, 0, cards, [])
}
