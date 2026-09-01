import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import { CONTINENTAL_ROUNDS, type Card } from '../src/types.js'

function card(id: string, suit: Card['suit'], rank: number, isWild = false): Card {
  return { id, suit, rank, isWild }
}

function playableRoom(): Room {
  const room = new Room({ roomId: '1234' })
  room.addPlayer('p1', 'One')
  room.addPlayer('p2', 'Two')
  room.phase = 'playing'
  room.currentPlayerIndex = 0
  room.currentPlayerHasDrawn = true
  room.hasHadTurn = [true, true]
  room.contract = CONTINENTAL_ROUNDS[0]!
  room.players[0]!.hand = [
    card('7h', 'hearts', 7), card('7d', 'diamonds', 7), card('7c', 'clubs', 7),
    card('8h', 'hearts', 8), card('8d', 'diamonds', 8), card('8c', 'clubs', 8),
    card('keep', 'spades', 13),
  ]
  return room
}

test('playMelds rejects a card ID that is not in the server hand', () => {
  const room = playableRoom()
  const result = room.playMelds('p1', [
    { type: 'trio', cards: [card('7h', 'spades', 12), card('7d', 'spades', 12), card('forged', 'spades', 12)] },
    { type: 'trio', cards: [card('8h', 'clubs', 4), card('8d', 'clubs', 4), card('8c', 'clubs', 4)] },
  ])

  assert.equal(result.ok, false)
  assert.equal(result.error, 'Card not in hand')
  assert.equal(room.players[0]!.hand.length, 7)
})

test('playMelds uses canonical server cards instead of client card attributes', () => {
  const room = playableRoom()
  const submitted = room.players[0]!.hand.slice(0, 6).map(c => ({ ...c, suit: 'spades' as const, rank: 12 }))
  const result = room.playMelds('p1', [
    { type: 'trio', cards: submitted.slice(0, 3) },
    { type: 'trio', cards: submitted.slice(3, 6) },
  ])

  assert.equal(result.ok, true)
  assert.deepEqual(room.melds.map(m => m.cards[0]?.rank), [7, 8])
  assert.deepEqual(room.players[0]!.hand.map(c => c.id), ['keep'])
})

test('removing a player preserves turn indexes', () => {
  const room = new Room({ roomId: '1234' })
  room.addPlayer('p1', 'One')
  room.addPlayer('p2', 'Two')
  room.addPlayer('p3', 'Three')
  room.phase = 'playing'
  room.currentPlayerIndex = 2
  room.dealerIndex = 2
  room.hasHadTurn = [true, false, true]

  room.removePlayer('p1')

  assert.deepEqual(room.players.map(p => p.id), ['p2', 'p3'])
  assert.equal(room.currentPlayerIndex, 1)
  assert.equal(room.dealerIndex, 1)
  assert.deepEqual(room.hasHadTurn, [false, true])
})

test('an expired server turn draws and discards without the client', () => {
  const room = playableRoom()
  room.secondsPerTurn = 15
  room.currentPlayerHasDrawn = false
  room.players[0]!.hand = [card('held', 'clubs', 10)]
  room.stock = [card('drawn', 'diamonds', 11)]
  room.turnDeadline = Date.now() - 1

  assert.equal(room.handleTurnTimeout(), true)
  assert.equal(room.topDiscard?.id, 'held')
  assert.deepEqual(room.players[0]!.hand.map(c => c.id), ['drawn'])
  assert.equal(room.discardOptionPlayerIndex, 1)
  assert.ok((room.turnDeadline ?? 0) > Date.now())
})

test('an expired discard decision automatically passes', () => {
  const room = playableRoom()
  room.secondsPerTurn = 15
  room.currentPlayerHasDrawn = false
  room.discarderIndex = 0
  room.discardOptionPlayerIndex = 1
  room.discardOptionAvailableAt = null
  room.turnDeadline = Date.now() - 1

  assert.equal(room.handleTurnTimeout(), true)
  assert.equal(room.discardOptionPlayerIndex, null)
  assert.equal(room.currentPlayerIndex, 1)
  assert.ok((room.turnDeadline ?? 0) > Date.now())
})
