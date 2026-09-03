import assert from 'node:assert/strict'
import test from 'node:test'
import { createContinentalDeck } from '../src/game/deck.js'
import {
  canSatisfyContractWithHand,
  isValidStraight,
  isValidTrio,
  replaceAndMoveJokerToStraightEnd,
  replaceJokerInStraight,
  satisfiesContract,
} from '../src/game/meld.js'
import { createPochaDeck, createSpanishDeck40, createSpanishDeck48 } from '../src/game/pocha/spanishDeck.js'
import { getCardsPerHand, trickWinner } from '../src/game/pocha/pochaEngine.js'
import { handPenalty } from '../src/game/scoring.js'
import { CONTINENTAL_ROUNDS, type Card } from '../src/types.js'

function card(id: string, suit: Card['suit'], rank: number, isWild = false): Card {
  return { id, suit, rank, isWild }
}

test('each Continental deck has three Jokers and only Jokers are wild', () => {
  const twoDeckShoe = createContinentalDeck(2, 2)
  const threeDeckShoe = createContinentalDeck(6, 3)
  const deuces = twoDeckShoe.filter(c => c.rank === 2)
  const jokers = twoDeckShoe.filter(c => c.suit === 'joker')
  const nonJokers = twoDeckShoe.filter(c => c.suit !== 'joker')

  assert.equal(deuces.length, 8)
  assert.ok(deuces.every(c => c.isWild !== true))
  assert.equal(twoDeckShoe.length, 110)
  assert.equal(jokers.length, 6)
  assert.equal(threeDeckShoe.length, 165)
  assert.equal(threeDeckShoe.filter(c => c.suit === 'joker').length, 9)
  assert.ok(jokers.every(c => c.isWild === true))
  assert.ok(nonJokers.every(c => c.isWild !== true))
})

test('a joker can fill an internal straight gap', () => {
  assert.equal(isValidStraight([
    card('5h', 'hearts', 5),
    card('j', 'joker', 0, true),
    card('7h', 'hearts', 7),
    card('8h', 'hearts', 8),
  ]), true)
})

test('a deuce cannot substitute for a missing rank', () => {
  assert.equal(isValidStraight([
    card('5h', 'hearts', 5),
    card('2h', 'hearts', 2, true),
    card('7h', 'hearts', 7),
    card('8h', 'hearts', 8),
  ]), false)
})

test('two adjacent wild positions do not make a valid straight', () => {
  assert.equal(isValidStraight([
    card('5h', 'hearts', 5),
    card('j1', 'joker', 0, true),
    card('j2', 'joker', 0, true),
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

test('contract feasibility can require one specific card to appear in the solution', () => {
  const hand = [
    card('7h', 'hearts', 7), card('7d', 'diamonds', 7), card('7c', 'clubs', 7),
    card('8h', 'hearts', 8), card('8d', 'diamonds', 8), card('8c', 'clubs', 8),
    card('unusable', 'spades', 9),
  ]

  assert.equal(canSatisfyContractWithHand(hand, CONTINENTAL_ROUNDS[0]!), true)
  assert.equal(canSatisfyContractWithHand(hand, CONTINENTAL_ROUNDS[0]!, 'unusable'), false)
})

test('contract feasibility preserves a suited card needed after an overlapping trio', () => {
  const hand = [
    card('7h', 'hearts', 7),
    card('7d', 'diamonds', 7),
    card('7s', 'spades', 7),
    card('7c', 'clubs', 7),
    card('4h', 'hearts', 4),
    card('5h', 'hearts', 5),
    card('6h', 'hearts', 6),
    card('8h', 'hearts', 8),
  ]

  assert.equal(canSatisfyContractWithHand(hand, CONTINENTAL_ROUNDS[1]!), true)
})

test('contract feasibility stays bounded for a duplicate-heavy large hand', () => {
  const duplicateHeavy = [
    ...(['hearts', 'diamonds', 'clubs', 'spades'] as const).flatMap(suit =>
      Array.from({ length: 3 }, (_, index) => card(`7-${suit}-${index}`, suit, 7))
    ),
    ...Array.from({ length: 9 }, (_, index) => card(`joker-${index}`, 'joker', 0, true)),
    card('9h', 'hearts', 9),
  ]
  const startedAt = performance.now()

  assert.equal(canSatisfyContractWithHand(duplicateHeavy, CONTINENTAL_ROUNDS[6]!), false)
  assert.ok(performance.now() - startedAt < 1_000, 'duplicate-heavy search exceeded 1 second')
})

test('Continental penalties use face value for 2 through 10 and fixed picture-card values', () => {
  const numberedCards = Array.from({ length: 9 }, (_, index) => card(String(index + 2), 'clubs', index + 2))
  const hand = [
    ...numberedCards,
    card('jack-hand', 'clubs', 11),
    card('queen-hand', 'clubs', 12),
    card('king-hand', 'clubs', 13),
    card('ace-hand', 'clubs', 14),
    card('joker-hand', 'joker', 0, true),
  ]

  assert.deepEqual(hand.map(card => handPenalty([card])), [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10, 10, 20, 50])
  assert.equal(handPenalty(hand), 154)
})

test('a suited deuce can be its natural rank while a joker fills a straight gap', () => {
  assert.equal(isValidStraight([
    card('2d', 'diamonds', 2, true),
    card('3d', 'diamonds', 3),
    card('joker', 'joker', 0, true),
    card('5d', 'diamonds', 5),
  ]), true)
})

test('deuces form a natural trio while a joker remains wild', () => {
  assert.equal(isValidTrio([
    card('2h', 'hearts', 2, true),
    card('2d', 'diamonds', 2, true),
    card('2c', 'clubs', 2, true),
    card('joker', 'joker', 0, true),
  ]), true)
})

test('joker swaps preserve the selected Joker gap and identity', () => {
  const multiJokerRun = [
    card('3h', 'hearts', 3),
    card('joker-four', 'joker', 0, true),
    card('5h', 'hearts', 5),
    card('joker-six', 'joker', 0, true),
    card('7h', 'hearts', 7),
  ]

  assert.ok(replaceJokerInStraight(
    multiJokerRun,
    'joker-four',
    card('4h', 'hearts', 4),
  ))
  assert.equal(replaceJokerInStraight(
    multiJokerRun,
    'joker-six',
    card('4h-other', 'hearts', 4),
  ), null)

  const endpointRun = [
    card('ace-joker', 'joker', 0, true),
    card('2h', 'hearts', 2),
    card('3h', 'hearts', 3),
    card('4h', 'hearts', 4),
  ]
  assert.equal(replaceAndMoveJokerToStraightEnd(
    endpointRun,
    'ace-joker',
    card('5h', 'hearts', 5),
  ), null)
})

test('Pocha trick comparison selects the stronger card', () => {
  const winner = trickWinner([
    { playerId: 'low', card: { id: 'two', suit: 'oros', rank: 2 } },
    { playerId: 'high', card: { id: 'ace', suit: 'oros', rank: 1 } },
  ], 0, 'oros', ['low', 'high'])

  assert.equal(winner, 'high')
})

test('Pocha deck variants contain exactly the requested Spanish ranks', () => {
  const deck40 = createSpanishDeck40()
  const deck48 = createSpanishDeck48()

  assert.equal(deck40.length, 40)
  assert.equal(deck48.length, 48)
  assert.equal(deck40.filter(card => card.rank === 8 || card.rank === 9).length, 0)
  assert.equal(deck48.filter(card => card.rank === 8).length, 4)
  assert.equal(deck48.filter(card => card.rank === 9).length, 4)
  assert.equal(new Set(deck40.map(card => card.id)).size, 40)
  assert.equal(new Set(deck48.map(card => card.id)).size, 48)
})

test('Pocha uses the 40-card deck by default and can select the full deck', () => {
  assert.equal(createPochaDeck().length, 40)
  assert.equal(createPochaDeck(48).length, 48)
})

test('Pocha full-deck trick order places 9 and 8 between 10 and 7', () => {
  const winner = (firstRank: number, secondRank: number) => trickWinner([
    { playerId: 'first', card: { id: `first-${firstRank}`, suit: 'oros', rank: firstRank } },
    { playerId: 'second', card: { id: `second-${secondRank}`, suit: 'oros', rank: secondRank } },
  ], 0, 'copas', ['first', 'second'])

  assert.equal(winner(7, 8), 'second')
  assert.equal(winner(8, 9), 'second')
  assert.equal(winner(9, 10), 'second')
})

test('Pocha hand size uses the largest complete deal for the selected deck', () => {
  assert.equal(getCardsPerHand(10, 4), 10)
  assert.equal(getCardsPerHand(12, 4, 48), 12)
  assert.equal(getCardsPerHand(9, 5, 48), 9)
  assert.equal(getCardsPerHand(10, 5, 48), 8)
})
