import assert from 'node:assert/strict'
import test from 'node:test'
import { actionSummary, discardBlocker, discardExplanation, meldSummary } from '../src/lib/tableSummary.ts'
import type { Card, GameState, Meld, PublicAction } from '../src/types.ts'

const c = (id: string, rank: number, suit: Card['suit'] = 'hearts'): Card => ({ id, rank, suit })
const trio: Meld = { id: 'trio', type: 'trio', ownerId: 'other', cards: [c('a', 8), c('b', 8, 'clubs'), c('c', 8, 'spades')] }
const state = { melds: [trio], players: [{ id: 'other', name: 'Ada' }] } as GameState

test('discard preflight matches public meld restrictions and identifies the owner', () => {
  assert.equal(discardBlocker(state, 'me', c('held', 8))?.id, 'trio')
  assert.match(discardExplanation(state, 'me', c('held', 8), 'en')!, /Ada’s Trio · 8/)
  assert.equal(discardBlocker(state, 'me', c('held', 7)), undefined)
  assert.equal(discardBlocker({ ...state, melds: [...state.melds, { ...trio, ownerId: 'me' }] }, 'me', c('held', 8)), undefined)
})

test('collapsed summaries identify rank, suit, ordered straight cards and length', () => {
  assert.equal(meldSummary(trio, 'en'), 'Trio · 8 · 3 cards')
  assert.equal(meldSummary({ ...trio, type: 'straight', cards: [c('4', 4), c('2', 2), c('5', 5), c('3', 3)] }, 'es'), 'Escalera · 2♥ 3♥ 4♥ 5♥ · 4 cartas')
})

test('public purchases describe only the exposed discard and penalty count', () => {
  const action: PublicAction = { id: '1', round: 1, playerId: 'other', playerName: 'Ada', kind: 'buy', cards: [c('q', 12)], penaltyCount: 1 }
  assert.equal(actionSummary(action, 'en'), 'Ada bought Q♥ + 1 penalty card')
  assert.equal(actionSummary({ ...action, kind: 'stock', cards: [] }, 'en'), 'Ada drew from stock')
  assert.match(actionSummary({ ...action, penaltyCount: 0 }, 'es'), /sin carta de penalización/)
})
