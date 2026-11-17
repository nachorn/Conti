import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import { findContractMeldsInHand, isValidMeld } from '../src/game/meld.js'
import type { Card } from '../src/types.js'

/** A physical two-deck fixture: nobody has ended the round or been assigned a score. */
function trappedRoom() {
  const room = new Room({ roomId: 'lock5', maxPlayers: 5, deckCount: 2, secondsPerTurn: 0, discardOptionDelaySeconds: 0 })
  for (let index = 0; index < 5; index++) room.addPlayer(`p${index}`, `Synthetic ${index}`)
  assert.equal(room.startGame(), true)
  const pool = [...room.stock, ...room.discardPile, ...room.players.flatMap(player => player.hand)]
  const take = (rank: number) => {
    const index = pool.findIndex(card => card.rank === rank)
    assert.notEqual(index, -1)
    return pool.splice(index, 1)[0]!
  }
  room.players[0]!.hand = [7, 7, 12, 12, 9, 9, 10].map(take)
  room.players[1]!.hand = [7, 7, 7, 9, 9, 9, 2, 3].map(take)
  room.players[2]!.hand = [10, 10, 10, 12, 12, 12, 4, 5].map(take)
  const initialDiscard = take(6), nextDraw = take(0)
  room.players[3]!.hand = pool.splice(0, 7)
  room.players[4]!.hand = pool.splice(0, 7)
  room.discardPile = [initialDiscard]
  room.topDiscard = room.discardPile[0]!
  room.stock = [nextDraw, ...pool]
  room.discardOptionPlayerIndex = null
  room.discarderIndex = null
  room.discardOptionAvailableAt = null
  room.hasHadTurn = Array(5).fill(true)
  for (const index of [1, 2]) {
    room.currentPlayerIndex = index
    room.currentPlayerHasDrawn = true
    const hand = room.players[index]!.hand
    assert.equal(room.playMelds(`p${index}`, [{ type: 'trio', cards: hand.slice(0, 3) }, { type: 'trio', cards: hand.slice(3, 6) }]).ok, true)
  }
  room.currentPlayerIndex = 0
  room.currentPlayerHasDrawn = false
  room.playedMeldThisTurn = false
  assert.equal(room.draw('p0', false).ok, true)
  // Validate the whole snapshot, including physical card identities and contract.
  return Room.fromSnapshot(room.toSnapshot(), { disconnectPlayers: false })
}
function physicalCards(room: Room): Card[] { return [...room.stock, ...room.discardPile, ...room.players.flatMap(player => player.hand), ...room.melds.flatMap(meld => meld.cards)] }
const addable = (room: Room, card: Card) => room.melds.some(meld => isValidMeld(meld.type, [...meld.cards, card]))

test('an untimed five-player turn with every card addable and no contract can discard normally and advance', () => {
  const room = trappedRoom(), hand = room.players[0]!.hand
  assert.equal(hand.length, 8)
  assert.equal(hand.every(card => addable(room, card)), true)
  assert.equal(findContractMeldsInHand(hand, room.contract), null)
  assert.equal(room.turnDeadline, null)
  assert.equal(room.draw('p0', false).ok, false, 'drawing twice is not a way out')
  assert.equal(room.addToMeld('p0', room.melds[0]!.id, [hand[0]!]).ok, false, 'the player cannot lay off before their contract')
  const physical = physicalCards(room).map(card => card.id).sort()
  assert.equal(physical.length, 110)
  assert.equal(new Set(physical).size, 110)
  const cardId = hand[0]!.id
  assert.equal(room.discard('p0', cardId).ok, true)
  assert.equal(room.topDiscard?.id, cardId)
  assert.equal(room.currentPlayerHasDrawn, false)
  assert.equal(room.discardOptionPlayerIndex, 1)
  for (const index of [1, 2, 3, 4]) assert.equal(room.passDiscard(`p${index}`).ok, true)
  assert.equal(room.currentPlayerIndex, 1)
  assert.equal(room.draw('p1', false).ok, true)
  assert.deepEqual(physicalCards(room).map(card => card.id).sort(), physical)
  assert.equal(room.players.every(player => player.score === 0), true)
  assert.equal(room.roundHistory.length, 0)
})

test('an addable card is still blocked before the contract when another discard is available', () => {
  const room = trappedRoom(), hand = room.players[0]!.hand
  const safeIndex = room.stock.findIndex(card => !addable(room, card))
  assert.notEqual(safeIndex, -1)
  const safe = room.stock[safeIndex]!, replaced = hand[hand.length - 1]!
  hand[hand.length - 1] = safe; room.stock[safeIndex] = replaced
  assert.equal(room.discard('p0', hand[0]!.id).ok, false)
  assert.equal(room.currentPlayerHasDrawn, true)
  assert.equal(room.discard('p0', safe.id).ok, true)
})

test('the all-addable escape cannot bypass an outstanding reclaimed Joker', () => {
  const room = trappedRoom(), hand = room.players[0]!.hand
  room.swappedJokerPlayerId = 'p0'
  room.swappedJokerCardId = hand.find(card => card.rank === 0)!.id
  assert.equal(hand.every(card => addable(room, card)), true)
  assert.deepEqual(room.discard('p0', hand[0]!.id), { ok: false, error: 'Play the joker you took in a meld before discarding' })
  assert.equal(room.currentPlayerHasDrawn, true)
  assert.equal(hand.length, 8)
})
