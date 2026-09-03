import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTINENTAL_ROUNDS, type Card, type Suit } from '../../shared/types.ts'
import { findMeldsForContract, isValidStraight, isValidTrio } from '../src/lib/meld.ts'

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
