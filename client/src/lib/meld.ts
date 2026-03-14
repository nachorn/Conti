import type { Card, MeldType, RoundContract } from '../types'

function isWild(c: Card): boolean {
  return c.isWild === true || c.suit === 'joker' || c.rank === 0
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

function missingRanks(ranks: number[], min: number, max: number): number[] {
  const set = new Set(ranks)
  const out: number[] = []
  for (let r = min; r <= max; r++) {
    if (!set.has(r)) out.push(r)
  }
  return out
}

function isConsecutiveRanks(ranks: number[]): boolean {
  if (ranks.length === 0) return false
  const sorted = [...ranks].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  if (max - min + 1 !== sorted.length) return false
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i + 1]! - sorted[i]! !== 1) return false
  }
  return true
}

function ranksConsecutiveNoWrap(ranks: number[]): boolean {
  if (ranks.length === 0) return false
  const hasAce = ranks.includes(14)
  const hasTwo = ranks.includes(2)
  if (hasAce && hasTwo) {
    const low = ranks.map((r) => (r === 14 ? 1 : r)).sort((a, b) => a - b)
    if (isConsecutiveRanks(low)) return true
  }
  if (hasAce && !hasTwo) {
    const asHigh = ranks.filter((r) => r !== 14).concat([14]).sort((a, b) => a - b)
    if (isConsecutiveRanks(asHigh)) return true
    const asLow = ranks.map((r) => (r === 14 ? 1 : r)).sort((a, b) => a - b)
    if (isConsecutiveRanks(asLow)) return true
  }
  return isConsecutiveRanks(ranks)
}

export function isValidStraight(cards: Card[]): boolean {
  if (cards.length < 4) return false
  const nonWild = cards.filter((c) => !isWild(c)).sort((a, b) => a.rank - b.rank)
  const wildCount = cards.length - nonWild.length
  if (nonWild.length <= wildCount) return false
  if (nonWild.length === 0) return false
  const suit = nonWild[0]!.suit
  if (nonWild.some((c) => c.suit !== suit)) return false
  const ranks = nonWild.map((c) => c.rank)
  if (!ranksConsecutiveNoWrap(ranks)) return false
  let min = Math.min(...ranks)
  let max = Math.max(...ranks)
  if (ranks.includes(2) && ranks.includes(14)) {
    const low = ranks.map((r) => (r === 14 ? 1 : r))
    min = Math.min(...low)
    max = Math.max(...low)
  }
  const span = max - min + 1
  if (span > cards.length) return false
  const holes = span - nonWild.length
  if (holes > wildCount) return false
  const ranksInRun =
    ranks.includes(2) && ranks.includes(14) ? ranks.map((r) => (r === 14 ? 1 : r)) : ranks
  const missing = missingRanks(ranksInRun, Math.min(...ranksInRun), Math.max(...ranksInRun))
  for (let i = 0; i < missing.length - 1; i++) {
    if (missing[i + 1]! - missing[i]! === 1) return false
  }
  return true
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
