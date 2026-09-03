import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTINENTAL_ROUNDS,
  type Card,
  type Meld,
  type MeldType,
  type Suit,
} from '../../shared/types.ts'
import { findMeldsForContract, isValidMeld } from '../src/lib/meld.ts'
import { assessMeldTarget, orderMeldCardsForDisplay } from '../src/lib/meldTargeting.ts'

function card(id: string, suit: Suit, rank: number): Card {
  return { id, suit, rank, ...(suit === 'joker' ? { isWild: true } : {}) }
}

function meld(type: MeldType, cards: Card[]): Meld {
  return { id: `${type}-meld`, type, cards, ownerId: 'player-1' }
}

test('reports valid and wrong-rank trio additions', () => {
  const target = meld('trio', [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('7s', 'spades', 7),
  ])

  assert.deepEqual(assessMeldTarget(target, [card('7c', 'clubs', 7)]), {
    canAdd: true,
    reason: 'fits',
    replaceableJokerIds: [],
  })
  assert.equal(assessMeldTarget(target, [card('8c', 'clubs', 8)]).reason, 'wrong-rank')
})

test('accepts multiple cards when their combined trio remains valid', () => {
  const target = meld('trio', [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('7s', 'spades', 7),
  ])
  const selected = [card('7c-1', 'clubs', 7), card('7c-2', 'clubs', 7)]
  const result = assessMeldTarget(target, selected)

  assert.equal(result.canAdd, isValidMeld(target.type, [...target.cards, ...selected]))
  assert.equal(result.canAdd, true)
  assert.equal(result.reason, 'fits')
  assert.deepEqual(result.replaceableJokerIds, [])
})

test('distinguishes wrong suit, duplicate rank, and non-consecutive straight additions', () => {
  const target = meld('straight', [
    card('5h', 'hearts', 5),
    card('6h', 'hearts', 6),
    card('7h', 'hearts', 7),
    card('8h', 'hearts', 8),
  ])

  assert.equal(assessMeldTarget(target, [card('9d', 'diamonds', 9)]).reason, 'wrong-suit')
  assert.equal(assessMeldTarget(target, [card('8h-2', 'hearts', 8)]).reason, 'duplicate-rank')
  assert.equal(assessMeldTarget(target, [card('10h', 'hearts', 10)]).reason, 'not-consecutive')

  const bothEnds = [card('4h', 'hearts', 4), card('9h', 'hearts', 9)]
  assert.deepEqual(assessMeldTarget(target, bothEnds), {
    canAdd: true,
    reason: 'fits',
    replaceableJokerIds: [],
  })
})

test('rejects additions that remove the natural-card majority', () => {
  const target = meld('trio', [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('joker-1', 'joker', 0),
  ])
  const result = assessMeldTarget(target, [card('joker-2', 'joker', 0)])

  assert.equal(result.canAdd, false)
  assert.equal(result.reason, 'too-many-jokers')
  assert.deepEqual(result.replaceableJokerIds, [])
})

test('only the Joker representing the matching gap can be replaced', () => {
  const target = meld('straight', [
    card('ah', 'hearts', 14),
    card('joker-two', 'joker', 0),
    card('3h', 'hearts', 3),
    card('4h', 'hearts', 4),
    card('joker-five', 'joker', 0),
  ])
  const result = assessMeldTarget(target, [card('2h', 'hearts', 2)])

  assert.equal(isValidMeld(target.type, target.cards), true)
  assert.equal(result.canAdd, false)
  assert.equal(result.reason, 'not-consecutive')
  assert.deepEqual(result.replaceableJokerIds, ['joker-two'])
})

test('requires a selected natural card before reporting replacement IDs', () => {
  const target = meld('trio', [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('joker-1', 'joker', 0),
  ])

  assert.deepEqual(assessMeldTarget(target, []), {
    canAdd: false,
    reason: 'no-cards',
    replaceableJokerIds: [],
  })
  assert.deepEqual(
    assessMeldTarget(target, [card('7s', 'spades', 7), card('7c', 'clubs', 7)]).replaceableJokerIds,
    []
  )
  assert.deepEqual(assessMeldTarget(target, [card('joker-2', 'joker', 0)]).replaceableJokerIds, [])
  assert.deepEqual(
    assessMeldTarget(target, [card('7s', 'spades', 7)], { jokerSwapMode: 'reclaim' }).replaceableJokerIds,
    [],
    'Jokers in trios cannot be swapped'
  )
})

test('reports invalid for an underlength meld and mirrors the validator for non-empty selections', () => {
  const cases = [
    {
      target: meld('trio', [card('7h', 'hearts', 7)]),
      selected: [card('7d', 'diamonds', 7)],
      reason: 'invalid',
    },
    {
      target: meld('straight', [
        card('5h', 'hearts', 5),
        card('6h', 'hearts', 6),
        card('7h', 'hearts', 7),
        card('8h', 'hearts', 8),
      ]),
      selected: [card('10h', 'hearts', 10)],
      reason: 'not-consecutive',
    },
  ] as const

  for (const entry of cases) {
    const result = assessMeldTarget(entry.target, [...entry.selected])
    assert.equal(result.canAdd, isValidMeld(entry.target.type, [...entry.target.cards, ...entry.selected]))
    assert.equal(result.reason, entry.reason)
  }
})

test('can suppress Joker swaps while another reclaimed Joker is outstanding', () => {
  const target = meld('straight', [
    card('3s', 'spades', 3),
    card('joker', 'joker', 0),
    card('5s', 'spades', 5),
    card('6s', 'spades', 6),
  ])

  assert.deepEqual(
    assessMeldTarget(target, [card('4s', 'spades', 4)], { jokerSwapMode: false }).replaceableJokerIds,
    []
  )
})

test('reclaims a straight Joker before going down without requiring an exposed destination', () => {
  const target = meld('straight', [
    card('2s', 'spades', 2),
    card('3s', 'spades', 3),
    card('table-joker', 'joker', 0),
    card('5s', 'spades', 5),
  ])

  const result = assessMeldTarget(target, [card('4s', 'spades', 4)], {
    allowAdd: false,
    jokerSwapMode: 'reclaim',
  })
  assert.equal(result.canAdd, false)
  assert.deepEqual(result.replaceableJokerIds, ['table-joker'])
})

test('contract-aware reclaim eligibility requires the exact reclaimed Joker', () => {
  const target = meld('straight', [
    card('2s', 'spades', 2),
    card('3s', 'spades', 3),
    card('table-joker', 'joker', 0),
    card('5s', 'spades', 5),
  ])
  const selected = card('4s', 'spades', 4)
  const contractCards = [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('7s', 'spades', 7),
    card('8h', 'hearts', 8),
    card('8d', 'diamonds', 8),
  ]
  const canUseInContract = (joker: Card) =>
    findMeldsForContract(
      [...contractCards, joker],
      CONTINENTAL_ROUNDS[0]!,
      joker.id
    ) !== null

  assert.deepEqual(
    assessMeldTarget(target, [selected], {
      allowAdd: false,
      jokerSwapMode: 'reclaim',
      canReclaimJoker: canUseInContract,
    }).replaceableJokerIds,
    ['table-joker']
  )
  assert.deepEqual(
    assessMeldTarget(target, [selected], {
      allowAdd: false,
      jokerSwapMode: 'reclaim',
      canReclaimJoker: () => false,
    }).replaceableJokerIds,
    []
  )
})

test('after going down, a swapped Joker must remain in the same straight at an open end', () => {
  const openRun = meld('straight', [
    card('2s', 'spades', 2),
    card('3s', 'spades', 3),
    card('table-joker', 'joker', 0),
    card('5s', 'spades', 5),
  ])
  assert.deepEqual(
    assessMeldTarget(openRun, [card('4s', 'spades', 4)], { jokerSwapMode: 'relocate' }).replaceableJokerIds,
    ['table-joker']
  )

  const fullRun: Meld = {
    id: 'full-run',
    type: 'straight',
    ownerId: 'other',
    cards: Array.from({ length: 13 }, (_, index) =>
    index === 2
      ? card('table-joker', 'joker', 0)
      : card(`s${index + 2}`, 'spades', index + 2)
    ),
  }
  assert.deepEqual(
    assessMeldTarget(fullRun, [card('4s', 'spades', 4)], { jokerSwapMode: 'relocate' }).replaceableJokerIds,
    []
  )
})

test('orders straight cards and places Jokers in their represented visual gaps', () => {
  const unordered = meld('straight', [
    card('5h', 'hearts', 5),
    card('2h', 'hearts', 2),
    card('table-joker', 'joker', 0),
    card('3h', 'hearts', 3),
  ])
  assert.deepEqual(
    orderMeldCardsForDisplay(unordered).map((entry) => entry.id),
    ['2h', '3h', 'table-joker', '5h']
  )

  const aceLow = meld('straight', [
    card('4s', 'spades', 4),
    card('as', 'spades', 14),
    card('2s', 'spades', 2),
    card('3s', 'spades', 3),
  ])
  assert.deepEqual(
    orderMeldCardsForDisplay(aceLow).map((entry) => entry.id),
    ['as', '2s', '3s', '4s']
  )

  const twoEnds = meld('straight', [
    card('3s', 'spades', 3),
    card('4s', 'spades', 4),
    card('5s', 'spades', 5),
    card('joker-low', 'joker', 0),
    card('joker-high', 'joker', 0),
  ])
  assert.deepEqual(
    orderMeldCardsForDisplay(twoEnds).map((entry) => entry.id),
    ['joker-low', '3s', '4s', '5s', 'joker-high'],
    'the displayed layout must not place two Jokers in adjacent gaps'
  )

  const exactJokerAtEnd = meld('straight', [
    card('3s-arranged', 'spades', 3),
    card('4s-arranged', 'spades', 4),
    card('5s-arranged', 'spades', 5),
    card('joker-other', 'joker', 0),
    card('7s-arranged', 'spades', 7),
    card('joker-requested', 'joker', 0),
  ])
  assert.deepEqual(
    orderMeldCardsForDisplay(exactJokerAtEnd).map((entry) => entry.id),
    exactJokerAtEnd.cards.map((entry) => entry.id),
    'an already-arranged swap result must preserve the exact Joker at its exposed end'
  )
})
