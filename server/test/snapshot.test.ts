import assert from 'node:assert/strict'
import test from 'node:test'
import { Room, type RoomSnapshot } from '../src/room.js'
import { CONTINENTAL_ROUNDS, type Card } from '../src/types.js'

function playingRoom(): Room {
  const room = new Room({
    roomId: '4821',
    deckCount: 3,
    maxPlayers: 8,
    discardOptionDelaySeconds: 5,
    secondsPerTurn: 30,
  })
  room.addPlayer('p1', 'One')
  room.addPlayer('p2', 'Two')
  room.addPlayer('p3', 'Three')
  room.setSeat('p2', 5)
  assert.equal(room.startGame(), true)
  room.roundPenalties = { p2: 10 }
  room.roundScores = { p1: -10, p2: 60, p3: 25 }
  room.players[0]!.score = -10
  room.players[1]!.score = 60
  room.players[2]!.score = 25
  room.players[2]!.connected = false
  return room
}

function jsonSnapshot(room: Room): RoomSnapshot {
  return JSON.parse(JSON.stringify(room.toSnapshot())) as RoomSnapshot
}

function trio(prefix: string, rank = 7): Card[] {
  return (['hearts', 'diamonds', 'clubs'] as const).map(suit => ({ id: `${prefix}-${suit}`, suit, rank, isWild: false }))
}

test('snapshot includes every Room gameplay field and preserves an exact rollback clone', () => {
  const room = playingRoom()
  const snapshot = jsonSnapshot(room)
  const restored = Room.fromSnapshot(snapshot, { disconnectPlayers: false })

  assert.deepEqual(Object.keys(snapshot).filter(key => key !== 'version').sort(), Object.keys(room).sort())
  assert.deepEqual(restored, room)
  assert.deepEqual(restored.toSnapshot(), snapshot)
  assert.ok(snapshot.stock.length > 0)
  assert.deepEqual(snapshot.players.map(player => player.hand), room.players.map(player => player.hand))
  assert.notEqual(restored.players, room.players)
  assert.notEqual(restored.stock, room.stock)
})

test('startup hydration resets connection flags but does not change deadlines or cards', () => {
  const room = playingRoom()
  const saved = jsonSnapshot(room)
  const restored = Room.fromSnapshot(saved)

  assert.ok(restored.players.every(player => player.connected === false))
  assert.equal(restored.turnDeadline, saved.turnDeadline)
  assert.equal(restored.discardOptionAvailableAt, saved.discardOptionAvailableAt)
  assert.deepEqual(restored.players.map(player => player.hand), saved.players.map(player => player.hand))
  assert.deepEqual(restored.toSnapshot(), {
    ...saved,
    players: saved.players.map(player => ({ ...player, connected: false })),
  })
  assert.equal(saved.players[0]!.connected, true)
})

test('startup hydration migrates a legacy wild deuce to a natural card', () => {
  const saved = jsonSnapshot(playingRoom())
  saved.stock[0] = { ...saved.stock[0]!, suit: 'diamonds', rank: 2, isWild: true }

  const restored = Room.fromSnapshot(saved, { disconnectPlayers: false })

  assert.equal(restored.stock[0]!.rank, 2)
  assert.equal(restored.stock[0]!.isWild, false)
})

test('snapshots and hydrated rooms do not retain mutable references to their source', () => {
  const room = playingRoom()
  const saved = room.toSnapshot()
  const originalCard = room.players[0]!.hand[0]!.rank
  saved.players[0]!.hand[0]!.rank = originalCard === 7 ? 8 : 7
  saved.contract.requirements[0]!.minLength = 99
  saved.roundScores.p1 = 999
  assert.equal(room.players[0]!.hand[0]!.rank, originalCard)
  assert.equal(room.contract.requirements[0]!.minLength, 3)
  assert.equal(room.roundScores.p1, -10)

  const fresh = room.toSnapshot()
  const restored = Room.fromSnapshot(fresh)
  restored.stock.splice(0, 1)
  restored.players[0]!.hand.splice(0, 1)
  restored.contract.requirements[0]!.minLength = 42
  assert.equal(fresh.stock.length, room.stock.length)
  assert.equal(fresh.players[0]!.hand.length, room.players[0]!.hand.length)
  assert.equal(fresh.contract.requirements[0]!.minLength, 3)
})

test('private snapshots are not substituted for the redacted client state', () => {
  const room = Room.fromSnapshot(jsonSnapshot(playingRoom()))
  const ownerState = room.getState('p1')
  const visitorState = room.getState('unknown')

  assert.deepEqual(ownerState.players[0]!.hand, room.players[0]!.hand)
  assert.ok(ownerState.players.slice(1).flatMap(player => player.hand).every(card => card.id === 'hidden'))
  assert.ok(visitorState.players.flatMap(player => player.hand).every(card => card.id === 'hidden'))
  assert.equal('stock' in ownerState, false)
  assert.deepEqual(ownerState.discardPile, [])
})

test('hydrated room can continue the saved discard decision', () => {
  const room = playingRoom()
  room.discardOptionAvailableAt = null
  const restored = Room.fromSnapshot(jsonSnapshot(room), { disconnectPlayers: false })
  const playerId = room.players[room.discardOptionPlayerIndex!]!.id

  assert.deepEqual(restored.takeDiscard(playerId), room.takeDiscard(playerId))
  // Both calls establish fresh deadlines; compare the rest of the authoritative state.
  restored.turnDeadline = room.turnDeadline
  assert.deepEqual(restored.toSnapshot(), room.toSnapshot())
  assert.equal(restored.currentPlayerHasDrawn, true)
})

test('snapshot preserves an outstanding joker replacement obligation and table melds', () => {
  const room = playingRoom()
  const joker: Card = { id: 'swapped-joker', suit: 'joker', rank: 0, isWild: true }
  room.stock = []
  room.melds = [{ id: 'meld-1', type: 'trio', cards: trio('trio'), ownerId: 'p2' }]
  room.players[0]!.hand.push(joker)
  room.currentPlayerIndex = 0
  room.currentPlayerHasDrawn = true
  room.playedMeldThisTurn = true
  room.hasHadTurn = [true, true, true]
  room.discardOptionPlayerIndex = null
  room.discarderIndex = null
  room.discardOptionAvailableAt = null
  room.swappedJokerCardId = joker.id
  room.swappedJokerPlayerId = 'p1'
  const restored = Room.fromSnapshot(jsonSnapshot(room), { disconnectPlayers: false })

  assert.deepEqual(restored, room)
  assert.equal(restored.discard('p1', restored.players[0]!.hand[0]!.id).error, 'Play the joker you took in a meld before discarding')
})

test('lobby, round end, final round and departed meld owners remain recoverable', () => {
  const lobby = new Room({ roomId: '1234' })
  assert.deepEqual(Room.fromSnapshot(jsonSnapshot(lobby)), lobby)
  lobby.addPlayer('p1', 'One')
  assert.deepEqual(Room.fromSnapshot(jsonSnapshot(lobby), { disconnectPlayers: false }), lobby)

  const room = playingRoom()
  room.debugSkipRound()
  assert.equal(Room.fromSnapshot(jsonSnapshot(room)).phase, 'round_end')
  room.round = 7
  room.contract = CONTINENTAL_ROUNDS[6]!
  room.roundEnderId = 'departed-player'
  assert.equal(room.nextRound(), false)
  const ended = Room.fromSnapshot(jsonSnapshot(room))
  assert.equal(ended.round, 8)
  assert.equal(ended.contract.round, 7)
  assert.equal(ended.phase, 'game_end')
  assert.equal(ended.roundEnderId, 'departed-player')

  const withMeld = playingRoom()
  withMeld.stock = []
  withMeld.melds = [{ id: 'old-meld', type: 'trio', cards: trio('old', 8), ownerId: 'departed-player' }]
  assert.equal(Room.fromSnapshot(jsonSnapshot(withMeld)).melds[0]!.ownerId, 'departed-player')
})

test('snapshot validation rejects unsupported versions and incomplete records', () => {
  for (const value of [null, [], {}, { version: 2 }, { version: 1 }, { ...jsonSnapshot(playingRoom()), version: '1' }]) {
    assert.throws(() => Room.fromSnapshot(value), /room snapshot/i)
  }
})

test('snapshot validation rejects invalid enums, bounds and scalar types', () => {
  const saved = jsonSnapshot(playingRoom())
  const invalidFields: Record<string, unknown[]> = {
    roomId: ['', '../save', '__proto__', 'x'.repeat(129)],
    gameType: ['unknown'],
    phase: ['finished'],
    round: [0, 9, 1.5, Infinity],
    maxPlayers: [0, 11, 2, 3.5],
    deckCount: [1, 4, '3'],
    currentPlayerIndex: [-1, 3, 0.5],
    dealerIndex: [-1, 3],
    discardOptionPlayerIndex: [-1, 3],
    discarderIndex: [-1, 3],
    secondsPerTurn: [-1, 121, NaN],
    discardOptionDelaySeconds: [-1, 31],
    turnDeadline: [-1, Infinity, 'tomorrow'],
    discardOptionAvailableAt: [-1, NaN],
    currentPlayerHasDrawn: [null, 1],
    playedMeldThisTurn: ['true'],
  }
  for (const [field, values] of Object.entries(invalidFields)) {
    for (const value of values) {
      assert.throws(() => Room.fromSnapshot({ ...saved, [field]: value }), /room snapshot/i, `${field}=${String(value)}`)
    }
  }
})

test('snapshot validation rejects duplicate players, seats, cards and melds', () => {
  const duplicatePlayer = jsonSnapshot(playingRoom())
  duplicatePlayer.players[1]!.id = duplicatePlayer.players[0]!.id
  assert.throws(() => Room.fromSnapshot(duplicatePlayer), /duplicate player ids/)

  const duplicateSeat = jsonSnapshot(playingRoom())
  duplicateSeat.players[1]!.seatIndex = duplicateSeat.players[0]!.seatIndex
  assert.throws(() => Room.fromSnapshot(duplicateSeat), /duplicate player seats/)

  const duplicateCard = jsonSnapshot(playingRoom())
  duplicateCard.stock[0] = { ...duplicateCard.players[0]!.hand[0]! }
  assert.throws(() => Room.fromSnapshot(duplicateCard), /duplicate card ids/)

  const duplicateMeld = jsonSnapshot(playingRoom())
  duplicateMeld.stock = []
  duplicateMeld.melds = [
    { id: 'same', type: 'trio', cards: trio('first'), ownerId: 'p1' },
    { id: 'same', type: 'trio', cards: trio('second', 8), ownerId: 'p2' },
  ]
  assert.throws(() => Room.fromSnapshot(duplicateMeld), /duplicate meld ids/)
})

test('snapshot validation rejects invalid cards and mismatched top discard', () => {
  const saved = jsonSnapshot(playingRoom())
  for (const replacement of [
    { id: 'bad', suit: 'roses', rank: 7 },
    { id: 'bad', suit: 'hearts', rank: 0 },
    { id: 'bad', suit: 'joker', rank: 7 },
    { id: 'bad', suit: 'hearts', rank: 15 },
    { id: 'bad', suit: 'hearts', rank: 3.5 },
    { id: 'bad', suit: 'hearts', rank: 7, isWild: 'false' },
  ]) {
    const bad = structuredClone(saved)
    const cards: unknown[] = bad.stock
    cards[0] = replacement
    assert.throws(() => Room.fromSnapshot(bad), /room snapshot/i)
  }
  assert.throws(() => Room.fromSnapshot({ ...saved, topDiscard: null }), /topDiscard/)
  assert.throws(() => Room.fromSnapshot({ ...saved, discardPile: [] }), /topDiscard/)
})

test('snapshot validation rejects inconsistent contracts, turns and joker references', () => {
  const saved = jsonSnapshot(playingRoom())
  assert.throws(() => Room.fromSnapshot({ ...saved, contract: CONTINENTAL_ROUNDS[1] }), /contract/)
  assert.throws(() => Room.fromSnapshot({ ...saved, hasHadTurn: [] }), /hasHadTurn/)
  assert.throws(() => Room.fromSnapshot({ ...saved, swappedJokerCardId: 'missing' }), /swapped joker/)
  assert.throws(() => Room.fromSnapshot({ ...saved, swappedJokerCardId: 'missing', swappedJokerPlayerId: 'p1' }), /swapped joker/)
  assert.throws(() => Room.fromSnapshot({ ...saved, roundScores: { intruder: 10 } }), /roundScores/)
  assert.throws(() => Room.fromSnapshot({ ...saved, roundScores: { p1: NaN } }), /roundScores/)
})

test('unrecognized snapshot properties are never copied into Room or public state', () => {
  const saved = jsonSnapshot(playingRoom())
  const restored = Room.fromSnapshot({ ...saved, resumeToken: 'must-not-copy', unexpected: { secret: true } })
  assert.equal('resumeToken' in restored, false)
  assert.equal('unexpected' in restored, false)
  assert.equal('resumeToken' in restored.getState('p1'), false)
})

test('fractional turn settings and resulting deadline precision survive hydration', () => {
  const room = playingRoom()
  room.secondsPerTurn = 0.1234
  room.discardOptionDelaySeconds = 0.2345
  room.discardOptionAvailableAt = Date.now() + 234.5
  room.resetTurnDeadline()
  assert.deepEqual(Room.fromSnapshot(room.toSnapshot(), { disconnectPlayers: false }), room)
})

test('malformed player data, sparse arrays and excessive card counts are rejected', () => {
  for (const update of [
    { name: '' }, { name: 'x'.repeat(25) }, { score: Infinity }, { connected: 'yes' }, { seatIndex: 8 },
  ]) {
    const saved = jsonSnapshot(playingRoom())
    Object.assign(saved.players[0]!, update)
    assert.throws(() => Room.fromSnapshot(saved), /room snapshot/i)
  }
  const sparse = jsonSnapshot(playingRoom())
  delete sparse.stock[0]
  assert.throws(() => Room.fromSnapshot(sparse), /stock/)
  const excessive = jsonSnapshot(playingRoom())
  excessive.players[0]!.hand.push({ id: 'extra-card', suit: 'hearts', rank: 7 })
  assert.throws(() => Room.fromSnapshot(excessive), /too many cards/)
})
