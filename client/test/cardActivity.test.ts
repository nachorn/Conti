import assert from 'node:assert/strict'
import test from 'node:test'
import { cardLabel, getCardActivity } from '../src/lib/cardActivity.ts'
import type { Card, GameState } from '../src/types.ts'

const card = (id: string): Card => ({ id, rank: 9, suit: 'hearts' })
function state(hand: Card[], changes: Partial<GameState> = {}): GameState {
  return {
    roomId: 'test', phase: 'playing', round: 1,
    contract: { requirements: [], minCards: 0 },
    players: [{ id: 'me', name: 'Me', hand, score: 0, connected: true, seatIndex: 0 },
      { id: 'other', name: 'Alex', hand: [], score: 0, connected: true, seatIndex: 1 }],
    currentPlayerIndex: 0, melds: [], stockCount: 20, discardPile: [],
    topDiscard: card('discard'), dealerIndex: 0, roundScores: {},
    ...changes,
  }
}

test('stock draw identifies the actual new card, regardless of hand order', () => {
  const result = getCardActivity(state([card('a')]), state([card('new'), card('a')]), 'me')
  assert.deepEqual(result.draws, [{ card: card('new'), source: 'stock' }])
})

test('discard purchase separates the public card from the private penalty', () => {
  const result = getCardActivity(state([card('a')]), state([card('a'), card('discard'), card('penalty')], { topDiscard: null }), 'me')
  assert.deepEqual(result.draws.map(({ card, source }) => [card.id, source]), [['discard', 'discard'], ['penalty', 'penalty']])
  assert.equal(result.discard, null)
})

test('priority take and an empty-stock purchase do not invent a penalty', () => {
  const result = getCardActivity(state([card('a')]), state([card('a'), card('discard')], { topDiscard: null }), 'me')
  assert.deepEqual(result.draws.map(({ source }) => source), ['discard'])
})

test('a new discard identifies its player but revealing an older pile card does not', () => {
  const previous = state([card('a')])
  const next = state([card('a')], { topDiscard: card('new'), discarderIndex: 1, discardOptionPlayerIndex: 0 })
  assert.deepEqual(getCardActivity(previous, next, 'me').discard, { card: card('new'), playerName: 'Alex' })
  assert.equal(getCardActivity(next, state([card('a'), card('new')]), 'me').discard, null)
})

test('deals, room changes, unchanged updates and Joker swaps do not produce receipts', () => {
  const previous = state([card('a')])
  for (const next of [state([card('a')]), state([card('joker')]),
    state([card('a'), card('new')], { round: 2 }),
    state([card('a'), card('new')], { roomId: 'other' }),
    state([card('a'), card('new')], { phase: 'round_end' })]) {
    assert.deepEqual(getCardActivity(previous, next, 'me'), { draws: [], discard: null })
  }
  assert.deepEqual(getCardActivity(state([]), state([card('a')]), 'me').draws, [])
})

test('opponents and spectators never receive private draw receipts', () => {
  assert.deepEqual(getCardActivity(state([card('a')]), state([card('a'), card('new')]), 'other').draws, [])
  assert.deepEqual(getCardActivity(state([card('a')]), state([card('a'), card('new')]), null).draws, [])
})

test('card names support English, Spanish, face cards and Jokers', () => {
  assert.equal(cardLabel(card('a'), 'en'), '9 of hearts')
  assert.equal(cardLabel({ ...card('a'), rank: 14, suit: 'spades' }, 'es'), 'A de picas')
  assert.equal(cardLabel({ ...card('a'), rank: 0, suit: 'joker' }, 'es'), 'Comodín')
})
