import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTINENTAL_ROUNDS, type Card, type Suit } from '../../shared/types.ts'
import {
  findMeldsForContract,
  isValidStraight,
  isValidTrio,
  replaceAndMoveJokerToStraightEnd,
  replaceJokerInStraight,
} from '../src/lib/meld.ts'

function card(id: string, suit: Suit, rank: number, isWild = false): Card {
  return { id, suit, rank, ...(isWild ? { isWild: true } : {}) }
}

test('a deuce plays naturally in a straight while a joker fills the gap', () => {
  assert.equal(isValidStraight([
    card('2d', 'diamonds', 2, true),
    card('3d', 'diamonds', 3),
    card('joker', 'joker', 0, true),
    card('5d', 'diamonds', 5),
  ]), true)
})

test('suited deuces can be natural in a trio of twos', () => {
  assert.equal(isValidTrio([
    card('2d', 'diamonds', 2, true),
    card('2h', 'hearts', 2, true),
    card('2s', 'spades', 2, true),
  ]), true)
})

test('a deuce cannot substitute for another rank or suit', () => {
  assert.equal(isValidTrio([
    card('2d', 'diamonds', 2, true),
    card('7h', 'hearts', 7),
    card('7s', 'spades', 7),
  ]), false)

  assert.equal(isValidStraight([
    card('2h', 'hearts', 2, true),
    card('5d', 'diamonds', 5),
    card('6d', 'diamonds', 6),
    card('7d', 'diamonds', 7),
  ]), false)
})

test('jokers still obey natural-card majority and non-adjacent wild rules', () => {
  assert.equal(isValidTrio([
    card('7d', 'diamonds', 7),
    card('joker-1', 'joker', 0, true),
    card('joker-2', 'joker', 0, true),
  ]), false)

  assert.equal(isValidStraight([
    card('3h', 'hearts', 3),
    card('6h', 'hearts', 6),
    card('7h', 'hearts', 7),
    card('joker-1', 'joker', 0, true),
    card('joker-2', 'joker', 0, true),
  ]), false)
})

test('round 2 solver finds 2D-3D-Joker-5D plus three Jacks', () => {
  const cards = [
    card('2d', 'diamonds', 2, true),
    card('3d', 'diamonds', 3),
    card('joker', 'joker', 0, true),
    card('5d', 'diamonds', 5),
    card('jh', 'hearts', 11),
    card('jd', 'diamonds', 11),
    card('js', 'spades', 11),
  ]

  const melds = findMeldsForContract(cards, CONTINENTAL_ROUNDS[1]!)
  assert.ok(melds)
  assert.deepEqual(
    melds.map((meld) => ({ type: meld.type, ids: meld.cards.map((item) => item.id).sort() })),
    [
      { type: 'trio', ids: ['jd', 'jh', 'js'] },
      { type: 'straight', ids: ['2d', '3d', '5d', 'joker'] },
    ]
  )
})

test('replacing a straight Joker preserves the exact reclaimed card identity', () => {
  const cards = [
    card('2s', 'spades', 2),
    card('3s', 'spades', 3),
    card('chosen-joker', 'joker', 0, true),
    card('5s', 'spades', 5),
  ]
  const result = replaceJokerInStraight(
    cards,
    'chosen-joker',
    card('4s', 'spades', 4)
  )

  assert.ok(result)
  assert.equal(result.joker, cards[2])
  assert.deepEqual(result.cards.map((item) => item.id), ['2s', '3s', '4s', '5s'])
  assert.equal(
    replaceJokerInStraight(cards, 'different-joker', card('4s', 'spades', 4)),
    null
  )
})

test('post-contract replacement relocates the same Joker to an exposed end', () => {
  const cards = [
    card('2s', 'spades', 2),
    card('3s', 'spades', 3),
    card('chosen-joker', 'joker', 0, true),
    card('5s', 'spades', 5),
  ]
  const result = replaceAndMoveJokerToStraightEnd(
    cards,
    'chosen-joker',
    card('4s', 'spades', 4)
  )

  assert.ok(result)
  assert.equal(result.length, cards.length + 1)
  assert.deepEqual(result.map((item) => item.id), [
    '2s',
    '3s',
    '4s',
    '5s',
    'chosen-joker',
  ])
  assert.equal(isValidStraight(result), true)

  const fullRun = Array.from({ length: 13 }, (_, index) =>
    index === 2
      ? card('full-run-joker', 'joker', 0, true)
      : card(`s${index + 2}`, 'spades', index + 2)
  )
  assert.equal(
    replaceAndMoveJokerToStraightEnd(
      fullRun,
      'full-run-joker',
      card('4s-full-run', 'spades', 4)
    ),
    null
  )
})

test('a swap cannot reinterpret an endpoint Joker as a different missing rank', () => {
  const cards = [
    card('ace-joker', 'joker', 0, true),
    card('2h', 'hearts', 2),
    card('3h', 'hearts', 3),
    card('4h', 'hearts', 4),
  ]

  assert.equal(
    replaceJokerInStraight(cards, 'ace-joker', card('5h', 'hearts', 5)),
    null
  )
  assert.equal(
    replaceAndMoveJokerToStraightEnd(cards, 'ace-joker', card('5h', 'hearts', 5)),
    null
  )
})

test('contract solver can require one exact reclaimed Joker', () => {
  const cards = [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('7s', 'spades', 7),
    card('8h', 'hearts', 8),
    card('8d', 'diamonds', 8),
    card('joker-one', 'joker', 0, true),
    card('joker-two', 'joker', 0, true),
  ]

  const melds = findMeldsForContract(cards, CONTINENTAL_ROUNDS[0]!, 'joker-two')
  assert.ok(melds)
  assert.equal(melds.flatMap((meld) => meld.cards).some((item) => item.id === 'joker-two'), true)
  assert.equal(
    findMeldsForContract(cards, CONTINENTAL_ROUNDS[0]!, 'missing-joker'),
    null
  )
})

test('opening contract can use every selected card in longer required melds', () => {
  const cards = [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('7s', 'spades', 7),
    card('7c', 'clubs', 7),
    card('8h', 'hearts', 8),
    card('8d', 'diamonds', 8),
    card('8s', 'spades', 8),
    card('8c', 'clubs', 8),
  ]

  const melds = findMeldsForContract(cards, CONTINENTAL_ROUNDS[0]!, undefined, true)
  assert.ok(melds)
  assert.equal(melds.length, 2)
  assert.deepEqual(melds.map((meld) => meld.cards.length), [4, 4])
  assert.deepEqual(
    new Set(melds.flatMap((meld) => meld.cards.map((item) => item.id))),
    new Set(cards.map((item) => item.id))
  )
})

test('contract search preserves cards needed by a later meld and distinguishes subset from all-selected mode', () => {
  const contractCards = [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('7s', 'spades', 7),
    card('7c', 'clubs', 7),
    card('4h', 'hearts', 4),
    card('5h', 'hearts', 5),
    card('6h', 'hearts', 6),
    card('8h', 'hearts', 8),
  ]
  const unrelated = card('qc', 'clubs', 12)

  const exact = findMeldsForContract(contractCards, CONTINENTAL_ROUNDS[1]!, undefined, true)
  assert.ok(exact)
  assert.equal(exact.find((meld) => meld.type === 'straight')?.cards.some((item) => item.id === '7h'), true)
  assert.equal(exact.flatMap((meld) => meld.cards).length, contractCards.length)

  assert.ok(findMeldsForContract([...contractCards, unrelated], CONTINENTAL_ROUNDS[1]!))
  assert.equal(
    findMeldsForContract([...contractCards, unrelated], CONTINENTAL_ROUNDS[1]!, undefined, true),
    null
  )
})

test('contract search stays bounded for a duplicate-heavy large hand', () => {
  const duplicateHeavy = [
    ...(['hearts', 'diamonds', 'clubs', 'spades'] as const).flatMap((suit) =>
      Array.from({ length: 3 }, (_, index) => card(`7-${suit}-${index}`, suit, 7))
    ),
    ...Array.from({ length: 9 }, (_, index) => card(`joker-${index}`, 'joker', 0, true)),
    card('9h', 'hearts', 9),
  ]
  const startedAt = performance.now()

  assert.equal(findMeldsForContract(duplicateHeavy, CONTINENTAL_ROUNDS[6]!), null)
  assert.ok(performance.now() - startedAt < 1_000, 'duplicate-heavy search exceeded 1 second')
})
