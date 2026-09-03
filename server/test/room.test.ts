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

test('round two accepts a natural deuce in a straight alongside a joker', () => {
  const room = playableRoom()
  room.round = 2
  room.contract = CONTINENTAL_ROUNDS[1]!
  room.players[0]!.hand = [
    card('2d', 'diamonds', 2, true),
    card('3d', 'diamonds', 3),
    card('joker', 'joker', 0, true),
    card('5d', 'diamonds', 5),
    card('jh', 'hearts', 11),
    card('jd', 'diamonds', 11),
    card('jc', 'clubs', 11),
  ]

  const result = room.playMelds('p1', [
    { type: 'straight', cards: room.players[0]!.hand.slice(0, 4) },
    { type: 'trio', cards: room.players[0]!.hand.slice(4) },
  ])

  assert.deepEqual(result, { ok: true })
  assert.deepEqual(room.players[0]!.hand, [])
  assert.deepEqual(room.melds.map(meld => meld.type), ['straight', 'trio'])
  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundScores.p1, -20)
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

test('removing the active player does not transfer their draw or meld bonus state', () => {
  const room = new Room({ roomId: '1234' })
  room.addPlayer('p1', 'One')
  room.addPlayer('p2', 'Two')
  room.addPlayer('p3', 'Three')
  room.phase = 'playing'
  room.round = 2
  room.contract = CONTINENTAL_ROUNDS[1]!
  room.currentPlayerIndex = 0
  room.currentPlayerHasDrawn = true
  room.playedMeldThisTurn = true

  room.removePlayer('p1')

  assert.equal(room.players[room.currentPlayerIndex]?.id, 'p2')
  assert.equal(room.currentPlayerHasDrawn, false)
  assert.equal(room.playedMeldThisTurn, false)
  assert.deepEqual(room.discard('p2', room.players[0]!.hand[0]?.id ?? 'missing'), {
    ok: false,
    error: 'Draw first before discarding',
  })
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

test('a remaining deuce scores two despite legacy out-of-turn purchase penalties', () => {
  const room = playableRoom()
  room.players[0]!.hand = []
  room.players[1]!.hand = [card('two', 'clubs', 2, true)]
  // Older version-1 snapshots may contain these now-retired score surcharges.
  room.roundPenalties.p2 = 20

  room.endRound('p1', false)

  assert.equal(room.roundScores.p1, -10)
  assert.equal(room.roundScores.p2, 2)
  assert.equal(room.players[1]!.score, 2)
})

test('discarding a final deuce awards the normal winner score', () => {
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

test('playMelds rejects a second standalone contract after the player is down', () => {
  const room = playableRoom()
  room.melds = [{
    id: 'own-contract',
    type: 'trio',
    cards: [card('9h-table', 'hearts', 9), card('9d-table', 'diamonds', 9), card('9c-table', 'clubs', 9)],
    ownerId: 'p1',
  }]
  const before = structuredClone(room.players[0]!.hand)

  assert.deepEqual(room.playMelds('p1', [
    { type: 'trio', cards: room.players[0]!.hand.slice(0, 3) },
    { type: 'trio', cards: room.players[0]!.hand.slice(3, 6) },
  ]), { ok: false, error: 'You already played your contract; add to existing melds or discard' })
  assert.deepEqual(room.players[0]!.hand, before)
})

test('initial play accepts exactly the contract melds but rejects an extra standalone trio', () => {
  const room = playableRoom()
  room.players[0]!.hand = [
    card('7h', 'hearts', 7), card('7d', 'diamonds', 7), card('7c', 'clubs', 7),
    card('8h', 'hearts', 8), card('8d', 'diamonds', 8), card('8c', 'clubs', 8),
    card('9h', 'hearts', 9), card('9d', 'diamonds', 9), card('9c', 'clubs', 9),
    card('keep', 'spades', 13),
  ]

  assert.deepEqual(room.playMelds('p1', [
    { type: 'trio', cards: room.players[0]!.hand.slice(0, 3) },
    { type: 'trio', cards: room.players[0]!.hand.slice(3, 6) },
    { type: 'trio', cards: room.players[0]!.hand.slice(6, 9) },
  ]), { ok: false, error: 'Play exactly the melds required by this round contract' })
  assert.equal(room.melds.length, 0)
  assert.equal(room.players[0]!.hand.length, 10)
})

test('a player not yet down may reclaim a straight Joker only when their contract can use it', () => {
  const room = playableRoom()
  const tableJoker = card('table-joker', 'joker', 0, true)
  room.players[0]!.hand = [
    card('4s', 'spades', 4),
    card('7h', 'hearts', 7), card('7d', 'diamonds', 7),
    card('8h', 'hearts', 8), card('8d', 'diamonds', 8), card('8c', 'clubs', 8),
  ]
  room.melds = [{
    id: 'run',
    type: 'straight',
    cards: [card('2s', 'spades', 2), card('3s', 'spades', 3), tableJoker, card('5s', 'spades', 5)],
    ownerId: 'p2',
  }]

  assert.deepEqual(room.swapJoker('p1', 'run', '4s', tableJoker.id), { ok: true })
  assert.deepEqual(room.melds[0]!.cards.map(item => item.id), ['2s', '3s', '4s', '5s'])
  assert.equal(room.players[0]!.hand.some(item => item.id === tableJoker.id), true)
  assert.equal(room.swappedJokerCardId, tableJoker.id)

  const hand = room.players[0]!.hand
  assert.deepEqual(room.playMelds('p1', [
    { type: 'trio', cards: hand.filter(item => ['7h', '7d', tableJoker.id].includes(item.id)) },
    { type: 'trio', cards: hand.filter(item => ['8h', '8d', '8c'].includes(item.id)) },
  ]), { ok: true })
  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundScores.p1, -10)
  assert.equal(room.swappedJokerCardId, null)
})

test('a pre-contract Joker swap is rejected when the resulting hand cannot play the contract', () => {
  const room = playableRoom()
  const tableJoker = card('table-joker', 'joker', 0, true)
  room.players[0]!.hand = [card('4s', 'spades', 4), card('unrelated', 'clubs', 10)]
  room.melds = [{
    id: 'run',
    type: 'straight',
    cards: [card('2s', 'spades', 2), card('3s', 'spades', 3), tableJoker, card('5s', 'spades', 5)],
    ownerId: 'p2',
  }]

  assert.deepEqual(room.swapJoker('p1', 'run', '4s', tableJoker.id), {
    ok: false,
    error: 'You can only swap if you can play your full contract with that Joker this turn',
  })
  assert.equal(room.players[0]!.hand.some(item => item.id === '4s'), true)
  assert.equal(room.melds[0]!.cards.some(item => item.id === tableJoker.id), true)
})

test('an already-down player fills a straight gap and keeps the selected Joker at that straight end', () => {
  const room = playableRoom()
  const requestedJoker = card('joker-four', 'joker', 0, true)
  const otherJoker = card('joker-six', 'joker', 0, true)
  room.players[0]!.hand = [card('4s', 'spades', 4), card('keep', 'clubs', 10)]
  room.melds = [{
    id: 'multi-joker-run',
    type: 'straight',
    cards: [card('3s', 'spades', 3), requestedJoker, card('5s', 'spades', 5), otherJoker, card('7s', 'spades', 7)],
    ownerId: 'p2',
  }, {
    id: 'p1-is-down',
    type: 'trio',
    cards: [card('9h', 'hearts', 9), card('9d', 'diamonds', 9), card('9c', 'clubs', 9)],
    ownerId: 'p1',
  }]

  assert.deepEqual(room.swapJoker('p1', 'multi-joker-run', '4s', requestedJoker.id), { ok: true })
  assert.deepEqual(room.melds[0]!.cards.map(item => item.id), ['3s', '4s', '5s', otherJoker.id, '7s', requestedJoker.id])
  assert.deepEqual(room.players[0]!.hand.map(item => item.id), ['keep'])
  assert.equal(room.swappedJokerCardId, null)
  assert.equal(room.swappedJokerPlayerId, null)
})

test('swapping the last hand card after going down ends the round with the later-turn bonus', () => {
  const room = playableRoom()
  room.round = 5
  room.contract = CONTINENTAL_ROUNDS[4]!
  const tableJoker = card('table-joker', 'joker', 0, true)
  room.players[0]!.hand = [card('4s', 'spades', 4)]
  room.players[1]!.hand = [card('ace', 'hearts', 14)]
  room.melds = [{
    id: 'run',
    type: 'straight',
    cards: [card('2s', 'spades', 2), card('3s', 'spades', 3), tableJoker, card('5s', 'spades', 5)],
    ownerId: 'p2',
  }, {
    id: 'p1-is-down',
    type: 'trio',
    cards: [card('9h', 'hearts', 9), card('9d', 'diamonds', 9), card('9c', 'clubs', 9)],
    ownerId: 'p1',
  }]

  assert.deepEqual(room.swapJoker('p1', 'run', '4s', tableJoker.id), { ok: true })
  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundScores.p1, -10)
  assert.equal(room.roundScores.p2, 20)
  assert.equal(room.melds[0]!.cards.at(-1)?.id, tableJoker.id)
})

test('adding the final card on the contract turn receives the round-scaled bonus', () => {
  const room = playableRoom()
  room.round = 2
  room.contract = CONTINENTAL_ROUNDS[1]!
  room.players[0]!.hand = [
    card('2d', 'diamonds', 2), card('3d', 'diamonds', 3), card('4d', 'diamonds', 4), card('5d', 'diamonds', 5),
    card('jh', 'hearts', 11), card('jd', 'diamonds', 11), card('jc', 'clubs', 11),
    card('9s', 'spades', 9),
  ]
  room.melds = [{
    id: 'table-nines',
    type: 'trio',
    cards: [card('9h-table', 'hearts', 9), card('9d-table', 'diamonds', 9), card('9c-table', 'clubs', 9)],
    ownerId: 'p2',
  }]

  assert.deepEqual(room.playMelds('p1', [
    { type: 'straight', cards: room.players[0]!.hand.slice(0, 4) },
    { type: 'trio', cards: room.players[0]!.hand.slice(4, 7) },
  ]), { ok: true })
  assert.deepEqual(room.addToMeld('p1', 'table-nines', [room.players[0]!.hand[0]!]), { ok: true })
  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundScores.p1, -20)
})

test('adding the final card on a later turn receives only the normal bonus', () => {
  const room = playableRoom()
  room.round = 5
  room.contract = CONTINENTAL_ROUNDS[4]!
  room.players[0]!.hand = [card('7s', 'spades', 7)]
  room.melds = [{
    id: 'table-sevens',
    type: 'trio',
    cards: [card('7h-table', 'hearts', 7), card('7d-table', 'diamonds', 7), card('7c-table', 'clubs', 7)],
    ownerId: 'p2',
  }, {
    id: 'p1-is-down',
    type: 'trio',
    cards: [card('9h-table', 'hearts', 9), card('9d-table', 'diamonds', 9), card('9c-table', 'clubs', 9)],
    ownerId: 'p1',
  }]

  assert.deepEqual(room.addToMeld('p1', 'table-sevens', [room.players[0]!.hand[0]!]), { ok: true })
  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundScores.p1, -10)
})

test('Jokers cannot be swapped out of trios', () => {
  const room = playableRoom()
  room.players[0]!.hand = [card('7s', 'spades', 7)]
  room.melds = [{
    id: 'trio',
    type: 'trio',
    cards: [card('7h-table', 'hearts', 7), card('7d-table', 'diamonds', 7), card('table-joker', 'joker', 0, true)],
    ownerId: 'p2',
  }]

  assert.deepEqual(room.swapJoker('p1', 'trio', '7s', 'table-joker'), {
    ok: false,
    error: 'Jokers can only be swapped in a straight',
  })
})

test('swapJoker rejects a missing or non-Joker target ID', () => {
  const room = playableRoom()
  room.players[0]!.hand = [card('4s', 'spades', 4)]
  room.melds = [{
    id: 'run',
    type: 'straight',
    cards: [card('3s', 'spades', 3), card('table-joker', 'joker', 0, true), card('5s', 'spades', 5), card('6s', 'spades', 6)],
    ownerId: 'p2',
  }]

  assert.deepEqual(room.swapJoker('p1', 'run', '4s', 'missing'), { ok: false, error: 'Joker not found in meld' })
  assert.deepEqual(room.swapJoker('p1', 'run', '4s', '3s'), { ok: false, error: 'Joker not found in meld' })
})

test('an already-down swap fails when the Joker has no legal exposed destination', () => {
  const room = playableRoom()
  room.players[0]!.hand = [card('4s', 'spades', 4)]
  room.melds = [{
    id: 'full-run',
    type: 'straight',
    cards: Array.from({ length: 13 }, (_, index) =>
      index === 2
        ? card('table-joker', 'joker', 0, true)
        : card(`s${index + 2}`, 'spades', index + 2)
    ),
    ownerId: 'p2',
  }, {
    id: 'p1-is-down',
    type: 'trio',
    cards: [card('9h', 'hearts', 9), card('9d', 'diamonds', 9), card('9c', 'clubs', 9)],
    ownerId: 'p1',
  }]

  assert.deepEqual(room.swapJoker('p1', 'full-run', '4s', 'table-joker'), {
    ok: false,
    error: 'That card cannot replace this Joker and move it to an exposed end',
  })
})

test('a turn timeout completes a guaranteed pre-contract Joker swap before ending the turn', () => {
  const room = playableRoom()
  const tableJoker = card('table-joker', 'joker', 0, true)
  room.players[0]!.hand = [
    card('4s', 'spades', 4),
    card('7h', 'hearts', 7), card('7d', 'diamonds', 7),
    card('8h', 'hearts', 8), card('8d', 'diamonds', 8), card('8c', 'clubs', 8),
  ]
  room.melds = [{
    id: 'run',
    type: 'straight',
    cards: [card('2s', 'spades', 2), card('3s', 'spades', 3), tableJoker, card('5s', 'spades', 5)],
    ownerId: 'p2',
  }]
  assert.deepEqual(room.swapJoker('p1', 'run', '4s', tableJoker.id), { ok: true })
  room.turnDeadline = Date.now() - 1

  assert.equal(room.handleTurnTimeout(), true)
  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundScores.p1, -10)
  assert.equal(room.swappedJokerCardId, null)
})

test('discarding the last card on the contract turn receives the round-scaled bonus', () => {
  const room = playableRoom()
  room.round = 2
  room.contract = CONTINENTAL_ROUNDS[1]!
  room.players[0]!.hand = [
    card('2d', 'diamonds', 2), card('3d', 'diamonds', 3), card('4d', 'diamonds', 4), card('5d', 'diamonds', 5),
    card('jh', 'hearts', 11), card('jd', 'diamonds', 11), card('jc', 'clubs', 11),
    card('last', 'spades', 13),
  ]

  assert.deepEqual(room.playMelds('p1', [
    { type: 'straight', cards: room.players[0]!.hand.slice(0, 4) },
    { type: 'trio', cards: room.players[0]!.hand.slice(4, 7) },
  ]), { ok: true })
  assert.deepEqual(room.discard('p1', 'last'), { ok: true })
  assert.equal(room.phase, 'round_end')
  assert.equal(room.roundScores.p1, -20)
})

test('finishing round seven immediately publishes game end and the -70 bonus', () => {
  const room = playableRoom()
  room.round = 7
  room.contract = CONTINENTAL_ROUNDS[6]!
  room.players[0]!.hand = [
    card('2h', 'hearts', 2), card('3h', 'hearts', 3), card('4h', 'hearts', 4), card('5h', 'hearts', 5),
    card('6d', 'diamonds', 6), card('7d', 'diamonds', 7), card('8d', 'diamonds', 8), card('9d', 'diamonds', 9),
    card('10c', 'clubs', 10), card('jc', 'clubs', 11), card('qc', 'clubs', 12), card('kc', 'clubs', 13),
  ]

  assert.deepEqual(room.playMelds('p1', [
    { type: 'straight', cards: room.players[0]!.hand.slice(0, 4) },
    { type: 'straight', cards: room.players[0]!.hand.slice(4, 8) },
    { type: 'straight', cards: room.players[0]!.hand.slice(8, 12) },
  ]), { ok: true })
  assert.equal(room.phase, 'game_end')
  assert.equal(room.round, 7)
  assert.equal(room.roundScores.p1, -70)
})

test('discarding the last card after the round seven contract shows the final game state', () => {
  const room = playableRoom()
  room.round = 7
  room.contract = CONTINENTAL_ROUNDS[6]!
  room.players[0]!.hand = [
    card('2h', 'hearts', 2), card('3h', 'hearts', 3), card('4h', 'hearts', 4), card('5h', 'hearts', 5),
    card('6d', 'diamonds', 6), card('7d', 'diamonds', 7), card('8d', 'diamonds', 8), card('9d', 'diamonds', 9),
    card('10c', 'clubs', 10), card('jc', 'clubs', 11), card('qc', 'clubs', 12), card('kc', 'clubs', 13),
    card('last', 'spades', 2),
  ]

  assert.deepEqual(room.playMelds('p1', [
    { type: 'straight', cards: room.players[0]!.hand.slice(0, 4) },
    { type: 'straight', cards: room.players[0]!.hand.slice(4, 8) },
    { type: 'straight', cards: room.players[0]!.hand.slice(8, 12) },
  ]), { ok: true })
  assert.deepEqual(room.discard('p1', 'last'), { ok: true })
  assert.equal(room.phase, 'game_end')
  assert.equal(room.roundScores.p1, -70)
})
