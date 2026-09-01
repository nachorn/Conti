import assert from 'node:assert/strict'
import test from 'node:test'
import { createContinentalDeck } from '../src/game/deck.js'
import { isValidStraight, satisfiesContract } from '../src/game/meld.js'
import { trickWinner } from '../src/game/pocha/pochaEngine.js'
import { handPenalty } from '../src/game/scoring.js'
import { CONTINENTAL_ROUNDS, type Card } from '../src/types.js'

function card(id: string, suit: Card['suit'], rank: number, isWild = false): Card {
  return { id, suit, rank, isWild }
}

test('deuces and jokers are marked wild in a Continental deck', () => {
  const deck = createContinentalDeck(2, 2)
  const deuces = deck.filter(c => c.rank === 2)
  const jokers = deck.filter(c => c.suit === 'joker')

  assert.equal(deuces.length, 8)
  assert.ok(deuces.every(c => c.isWild === true))
  assert.equal(jokers.length, 4)
  assert.ok(jokers.every(c => c.isWild === true))
})

test('a wild card can fill an internal straight gap', () => {
  assert.equal(isValidStraight([
    card('5h', 'hearts', 5),
    card('2h', 'hearts', 2, true),
    card('7h', 'hearts', 7),
    card('8h', 'hearts', 8),
  ]), true)
})

test('two adjacent wild positions do not make a valid straight', () => {
  assert.equal(isValidStraight([
    card('5h', 'hearts', 5),
    card('2h', 'hearts', 2, true),
    card('j', 'joker', 0, true),
    card('8h', 'hearts', 8),
    card('9h', 'hearts', 9),
  ]), false)
})

test('each repeated contract requirement needs a distinct meld', () => {
  const trio = {
    type: 'trio' as const,
    cards: [card('7h', 'hearts', 7), card('7d', 'diamonds', 7), card('7c', 'clubs', 7)],
  }
  assert.equal(satisfiesContract([trio], CONTINENTAL_ROUNDS[0]!), false)

  const secondTrio = {
    type: 'trio' as const,
    cards: [card('8h', 'hearts', 8), card('8d', 'diamonds', 8), card('8c', 'clubs', 8)],
  }
  assert.equal(satisfiesContract([trio, secondTrio], CONTINENTAL_ROUNDS[0]!), true)
})

test('cards 2 through 9 use the documented five-point penalty', () => {
  const hand = Array.from({ length: 8 }, (_, index) => card(String(index), 'clubs', index + 2))
  assert.equal(handPenalty(hand), 40)
})

test('Pocha trick comparison selects the stronger card', () => {
  const winner = trickWinner([
    { playerId: 'low', card: { id: 'two', suit: 'oros', rank: 2 } },
    { playerId: 'high', card: { id: 'ace', suit: 'oros', rank: 1 } },
  ], 0, 'oros', ['low', 'high'])

  assert.equal(winner, 'high')
})
