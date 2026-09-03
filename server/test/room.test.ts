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

function roomWithDiscardOffer(): Room {
  const room = new Room({ roomId: '1234', discardOptionDelaySeconds: 0 })
  room.addPlayer('p1', 'One')
  room.addPlayer('p2', 'Two')
  room.addPlayer('p3', 'Three')
  room.phase = 'playing'
  room.currentPlayerIndex = 0
  room.currentPlayerHasDrawn = true
  room.hasHadTurn = [true, false, false]
  room.players[0]!.hand = [card('ace', 'hearts', 14), card('held', 'clubs', 10)]
  room.players[1]!.hand = [card('p2-held', 'diamonds', 8)]
  room.players[2]!.hand = [card('p3-held', 'spades', 9)]
  room.stock = [card('penalty', 'clubs', 5), card('next-draw', 'diamonds', 6)]
  room.discardPile = [card('old-discard', 'spades', 4)]
  room.topDiscard = room.discardPile[0]!

  assert.equal(room.discard('p1', 'ace').ok, true)
  assert.equal(room.discardOptionPlayerIndex, 1)
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

test('an out-of-turn discard taker draws a penalty card without taking the next player turn', () => {
  const room = roomWithDiscardOffer()

  assert.equal(room.passDiscard('p2').ok, true)
  assert.equal(room.discardOptionPlayerIndex, 2)
  assert.equal(room.takeDiscard('p3').ok, true)

  assert.equal(room.currentPlayerIndex, 1)
  assert.equal(room.currentPlayerHasDrawn, false)
  assert.deepEqual(room.hasHadTurn, [true, false, false])
  assert.deepEqual(room.players[2]!.hand.map(c => c.id), ['p3-held', 'ace', 'penalty'])
  assert.deepEqual(room.stock.map(c => c.id), ['next-draw'])
  assert.equal(room.roundPenalties.p3, undefined)
  assert.equal(room.discardOptionPlayerIndex, null)
  assert.equal(room.discarderIndex, null)

  assert.deepEqual(room.draw('p3', false), { ok: false, error: 'Not your turn' })
  assert.equal(room.draw('p2', false).ok, true)
  assert.equal(room.currentPlayerHasDrawn, true)
  assert.deepEqual(room.hasHadTurn, [true, true, false])
})

test('the priority player who takes the discard starts their turn with a completed draw', () => {
  const room = roomWithDiscardOffer()

  assert.equal(room.takeDiscard('p2').ok, true)

  assert.equal(room.currentPlayerIndex, 1)
  assert.equal(room.currentPlayerHasDrawn, true)
  assert.deepEqual(room.hasHadTurn, [true, true, false])
  assert.deepEqual(room.players[1]!.hand.map(c => c.id), ['p2-held', 'ace'])
  assert.deepEqual(room.stock.map(c => c.id), ['penalty', 'next-draw'])
  assert.equal(room.roundPenalties.p2, undefined)
})

test('a remaining deuce scores five despite legacy out-of-turn purchase penalties', () => {
  const room = playableRoom()
  room.players[0]!.hand = []
  room.players[1]!.hand = [card('two', 'clubs', 2, true)]
  // Older version-1 snapshots may contain these now-retired score surcharges.
  room.roundPenalties.p2 = 20

  room.endRound('p1', false)

  assert.equal(room.roundScores.p1, -10)
  assert.equal(room.roundScores.p2, 5)
  assert.equal(room.players[1]!.score, 5)
})

test('discarding a final wild deuce awards the normal winner score', () => {
  const room = playableRoom()
  room.melds = [{
    id: 'own-trio',
    type: 'trio',
    cards: [card('7h-table', 'hearts', 7), card('7d-table', 'diamonds', 7), card('7c-table', 'clubs', 7)],
    ownerId: 'p1',
  }]
  room.players[0]!.hand = [card('final-two', 'spades', 2, true)]
  room.players[1]!.hand = [card('ace', 'hearts', 14)]

  assert.deepEqual(room.discard('p1', 'final-two'), { ok: true })

  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundEnderId, 'p1')
  assert.deepEqual(room.players[0]!.hand, [])
  assert.equal(room.topDiscard?.id, 'final-two')
  assert.equal(room.roundScores.p1, -10)
  assert.equal(room.players[0]!.score, -10)
  assert.equal(room.roundScores.p2, 20)
})
