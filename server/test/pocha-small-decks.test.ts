import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import { createPochaDeck, createSpanishDeck32, createSpanishDeck36 } from '../src/game/pocha/index.js'
import { createPochaHandState } from '../src/game/pocha/pochaEngine.js'
import { defaultPochaSettings, roundSchedule } from '../src/game/pocha/pochaRules.js'
import { isPochaDeckSize, POCHA_DECK_SIZES } from '../src/game/pocha/pochaTypes.js'
import type { PochaDeckSize, PochaGameState } from '../src/game/pocha/pochaTypes.js'

const expectedRanks: Record<PochaDeckSize, number[]> = {
  32: [1, 3, 5, 6, 7, 10, 11, 12],
  36: [1, 2, 3, 5, 6, 7, 10, 11, 12],
  40: [1, 2, 3, 4, 5, 6, 7, 10, 11, 12],
  48: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
}
const players = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `Jugador ${i}`, seatIndex: i, score: 0, connected: true,
}))
const roomWith = (deckSize: PochaDeckSize, n: number) => {
  const room = new Room({ roomId: 'small-decks', gameType: 'pocha', pochaDeckSize: deckSize })
  for (const p of players(n)) room.addPlayer(p.id, p.name)
  return room
}

test('all four deck options contain the exact intended ranks in every suit with unique cards', () => {
  assert.deepEqual(POCHA_DECK_SIZES, [32, 36, 40, 48])
  for (const deckSize of POCHA_DECK_SIZES) {
    const deck = createPochaDeck(deckSize)
    assert.equal(deck.length, deckSize)
    assert.equal(new Set(deck.map(card => card.id)).size, deckSize)
    assert.equal(new Set(deck.map(card => `${card.suit}:${card.rank}`)).size, deckSize)
    for (const suit of ['oros', 'copas', 'espadas', 'bastos']) {
      assert.deepEqual(deck.filter(card => card.suit === suit).map(card => card.rank).sort((a, b) => a - b), expectedRanks[deckSize])
    }
    assert.equal(isPochaDeckSize(deckSize), true)
  }
  assert.equal(createSpanishDeck36().filter(card => card.rank === 2).length, 4)
  assert.equal(createSpanishDeck36().some(card => card.rank === 4), false)
  assert.equal(createSpanishDeck32().length, 32)
  assert.equal(createSpanishDeck32().some(card => [2, 4, 8, 9].includes(card.rank)), false)
  assert.equal(createPochaDeck().length, 40)
  for (const value of [undefined, null, 0, 31, 33, '32', '36', NaN, Infinity, {}, []]) assert.equal(isPochaDeckSize(value), false)
})

test('round maximums use the selected deck for every supported player count and mode', () => {
  for (const deckSize of POCHA_DECK_SIZES) for (let n = 2; n <= 10; n++) for (const mode of ['normal', 'subastada'] as const) {
    const settings = { ...defaultPochaSettings(n, deckSize), mode }
    const max = Math.floor(deckSize / n)
    assert.equal(settings.maxCards, max)
    const schedule = roundSchedule(settings, n, deckSize)
    assert.equal(Math.max(...schedule), max)
    assert.equal(schedule.filter(cards => cards === max).length, n)
    assert.throws(() => roundSchedule({ ...settings, maxCards: max + 1 }, n, deckSize))
  }
})

test('small-deck normal peaks expose the dealer last card only when the whole deck was dealt', () => {
  for (const deckSize of [32, 36] as const) for (const n of [4, 5]) {
    const maxCards = Math.floor(deckSize / n)
    const settings = { mode: 'normal' as const, maxCards, oneCardRounds: 1, peakRounds: 1 }
    const schedule = roundSchedule(settings, n, deckSize)
    const s = createPochaHandState('full-deal', players(n), schedule.indexOf(maxCards) + 1, n - 1, deckSize, settings)
    const dealt = s.players.flatMap(p => p.hand)
    assert.equal(dealt.length, n * maxCards)
    assert.equal(new Set(dealt.map(card => `${card.suit}:${card.rank}`)).size, dealt.length)
    assert.ok(dealt.every(card => expectedRanks[deckSize].includes(card.rank)))
    assert.ok(expectedRanks[deckSize].includes(s.trumpCard!.rank))
    if (deckSize % n === 0) assert.deepEqual(s.trumpCard, s.players[n - 1].hand.at(-1))
    else assert.ok(!dealt.some(card => card.id === s.trumpCard!.id))
    const auction = createPochaHandState('auction', players(n), schedule.indexOf(maxCards) + 1, n - 1, deckSize, { ...settings, mode: 'subastada' })
    assert.equal(auction.phase, 'auction')
    assert.equal(auction.trumpCard, null)
  }
})

test('snapshot parsing rejects a removed rank everywhere cards can be saved', () => {
  for (const deckSize of POCHA_DECK_SIZES) {
    const room = roomWith(deckSize, 3)
    assert.deepEqual(room.startPochaGame({ mode: 'normal', maxCards: 2, oneCardRounds: 1, peakRounds: 1 }), { ok: true })
    assert.equal(Room.fromSnapshot(room.toSnapshot()).pocha!.deckSize, deckSize)
    const absentRanks = Array.from({ length: 13 }, (_, i) => i + 1).filter(rank => !expectedRanks[deckSize].includes(rank))
    for (const rank of absentRanks) {
      const invalid = { id: 'removed-rank', suit: 'oros' as const, rank }
      const patches: ((state: PochaGameState) => void)[] = [
        state => { state.players[0].hand[0] = invalid },
        state => { state.trumpCard = invalid },
        state => { state.currentTrick = [{ playerId: 'p0', card: invalid }] },
        state => { state.lastTrick = { cards: [{ playerId: 'p0', card: invalid }], winnerId: 'p0' } },
      ]
      for (const patch of patches) {
        const raw = room.toSnapshot()
        patch(raw.pocha!)
        assert.throws(() => Room.fromSnapshot(raw), /Invalid Pocha snapshot/)
      }
    }
  }
})

test('lobby configuration preserves chosen values and clamps only limits affected by deck or player count', () => {
  const room = roomWith(48, 5)
  assert.equal(room.pocha!.lobbyConfigured, false)
  assert.deepEqual(room.pocha!.settings, { mode: 'normal', maxCards: 9, oneCardRounds: 5, peakRounds: 5 })
  assert.deepEqual(room.configurePocha({ settings: { mode: 'subastada', maxCards: 8, oneCardRounds: 4, peakRounds: 5 } }), { ok: true })
  assert.deepEqual(room.configurePocha({ deckSize: 32 }), { ok: true })
  assert.deepEqual(room.pocha!.settings, { mode: 'subastada', maxCards: 6, oneCardRounds: 4, peakRounds: 5 })
  room.addPlayer('p5', 'Jugador 5')
  assert.deepEqual(room.pocha!.settings, { mode: 'subastada', maxCards: 5, oneCardRounds: 4, peakRounds: 5 })
  room.setSeat('p5', 7)
  assert.equal(room.pocha!.settings.mode, 'subastada')
  for (const id of ['p5', 'p4', 'p3']) room.removePlayer(id)
  assert.deepEqual(room.pocha!.settings, { mode: 'subastada', maxCards: 5, oneCardRounds: 3, peakRounds: 3 })
  assert.equal(room.pocha!.deckSize, 32)
  const restored = Room.fromSnapshot(room.toSnapshot(), { disconnectPlayers: false })
  assert.deepEqual(restored.pocha!.settings, room.pocha!.settings)
  assert.equal(restored.pocha!.lobbyConfigured, true)
  assert.deepEqual(restored.startPochaGame(), { ok: true })
  assert.deepEqual(restored.pocha!.schedule, [1, 1, 1, 2, 3, 4, 5, 5, 5, 4, 3, 2, 1, 1, 1])
})

test('lobby defaults continue to track participants until customized and older saves remain compatible', () => {
  const room = roomWith(36, 3)
  assert.deepEqual(room.pocha!.settings, { mode: 'normal', maxCards: 12, oneCardRounds: 3, peakRounds: 3 })
  room.addPlayer('p3', 'Jugador 3')
  assert.deepEqual(room.pocha!.settings, { mode: 'normal', maxCards: 9, oneCardRounds: 4, peakRounds: 4 })
  const old = room.toSnapshot()
  delete old.pocha!.lobbyConfigured
  assert.equal(Room.fromSnapshot(old).pocha!.lobbyConfigured, false)
  ;(old.pocha as unknown as Record<string, unknown>).lobbyConfigured = 'true'
  assert.throws(() => Room.fromSnapshot(old), /Invalid Pocha snapshot/)
})

test('invalid lobby updates never partially mutate deck, configuration or seats', () => {
  const room = roomWith(40, 5)
  for (const patch of [null, [], {}, { deckSize: '32' }, { deckSize: 35 }, { settings: null },
    { surprise: true }, { settings: { surprise: true } }, { settings: { mode: 'bad' } },
    { settings: { maxCards: 0 } }, { settings: { maxCards: 9 } }, { settings: { maxCards: 1.5 } },
    { settings: { oneCardRounds: 6 } }, { settings: { peakRounds: '2' } },
    { deckSize: 32, settings: { maxCards: 8 } }, { settings: { auctionWithRemainder: 'yes' } }]) {
    const before = room.toSnapshot()
    assert.equal(room.configurePocha(patch).ok, false)
    assert.deepEqual(room.toSnapshot(), before)
  }
})
