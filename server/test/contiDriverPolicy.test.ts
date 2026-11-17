import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTINENTAL_ROUNDS, type Card, type GameState } from '../src/types.js'
import { ContiDiscardPolicy, contiWantsDiscard } from './audit/contiFivePlayerDriver.js'

const card = (id: string, rank: number, suit: Card['suit'] = 'hearts'): Card => ({ id, rank, suit })
const contract = CONTINENTAL_ROUNDS[0]!
const view = (hand: Card[], melds: GameState['melds'] = []) => ({ contract, hasHadTurn: Array(5).fill(true), players: [{ id: 'me', hand }], melds } as GameState)

test('a useful-looking discard is declined unless it completes the whole playable contract', () => {
  const pairHeavy = [card('7h', 7), card('7d', 7, 'diamonds'), card('8h', 8), card('8d', 8, 'diamonds'), card('9', 9), card('2', 2), card('ace', 14)]
  const top = card('7c', 7, 'clubs')
  // The old usefulness threshold bought this repeatedly despite no full contract.
  for (const priority of [true, false]) assert.equal(contiWantsDiscard(top, view(pairHeavy), 'me', priority), false)
  const complete = [...pairHeavy.slice(0, 4), card('8c', 8, 'clubs'), ...pairHeavy.slice(5)]
  assert.equal(contiWantsDiscard(top, view(complete), 'me', true), true)
  assert.equal(contiWantsDiscard(top, { ...view(complete), hasHadTurn: [true, false, false, false, false] }, 'me', true), false)
})

test('an already-down player takes only a priority discard that can be laid off', () => {
  const meld = { id: 'table-trio', ownerId: 'me', type: 'trio' as const, cards: [card('a', 7), card('b', 7, 'diamonds'), card('c', 7, 'clubs')] }
  const state = view([card('held', 12)], [meld])
  assert.equal(contiWantsDiscard(card('fits', 7), state, 'me', true), true)
  assert.equal(contiWantsDiscard(card('fits', 7), state, 'me', false), false)
  assert.equal(contiWantsDiscard(card('misses', 8), state, 'me', true), false)
})

test('repeated draw/discard hands choose a different legal card, independent of order and other players', () => {
  const policy = new ContiDiscardPolicy()
  const hand = [card('pair1', 7), card('pair2', 7, 'diamonds'), card('throw', 14), card('other', 4)]
  const first = policy.choose('me', 1, hand, hand, contract, false)
  const next = policy.choose('me', 1, [...hand].reverse(), hand, contract, false)
  assert.notEqual(next.id, first.id, 'an unchanged hand must not discard the same card forever')
  assert.equal(hand.some(card => card.id === next.id), true)
  assert.equal(policy.choose('another-player', 1, hand, hand, contract, false).id, first.id)
  assert.equal(policy.choose('me', 2, hand, hand, contract, false).id, first.id, 'new rounds do not inherit old hand decisions')
  assert.equal(policy.repeatedHands, 1)
})
