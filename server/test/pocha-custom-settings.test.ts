import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import { defaultPochaSettings, pochaScoring, roundSchedule, scoreHand } from '../src/game/pocha/pochaRules.js'
import type { PochaAction, PochaSettings } from '../src/game/pocha/pochaTypes.js'

const roomWith = (n = 5) => {
  const room = new Room({ roomId: '1234', gameType: 'pocha', pochaDeckSize: 48 })
  for (let i = 0; i < n; i++) room.addPlayer(`p${i}`, `Jugador ${i}`)
  return room
}

test('custom scoring keeps exact bonuses and winning tricks separate from symmetric misses', () => {
  assert.deepEqual(pochaScoring(), { exactBidPoints: 5, trickPoints: 2, missPenalty: 2 })
  for (const [bid, won, expected] of [[0, 0, 5], [3, 3, 11], [3, 2, -2], [3, 1, -4], [3, 4, -2]]) {
    assert.equal(scoreHand(bid, won), expected)
    assert.equal(scoreHand(bid, won, {}), expected)
  }
  const custom = { exactBidPoints: 10, trickPoints: 3, missPenalty: 4 }
  for (const [bid, won, expected] of [[0, 0, 10], [3, 3, 19], [3, 2, -4], [3, 1, -8], [3, 4, -4], [0, 5, -20]]) {
    assert.equal(scoreHand(bid, won, custom), expected)
  }
  assert.equal(scoreHand(3, 3, { exactBidPoints: 0 }), 6)
  assert.equal(scoreHand(3, 3, { trickPoints: 0 }), 5)
  assert.equal(scoreHand(3, 1, { missPenalty: 0 }), 0)
  assert.equal(scoreHand(0, 0, { exactBidPoints: 0, trickPoints: 0, missPenalty: 0 }), 0)
})

test('one-card opening and closing blocks are independent with the existing single-block special case', () => {
  const custom = { mode: 'normal' as const, maxCards: 4, oneCardRounds: 5, oneCardRoundsEnd: 2, peakRounds: 3 }
  assert.deepEqual(roundSchedule(custom, 5, 40), [1, 1, 1, 1, 1, 2, 3, 4, 4, 4, 3, 2, 1, 1])
  assert.deepEqual(roundSchedule({ ...custom, maxCards: 1 }, 5, 40), [1, 1, 1, 1, 1])
  const { oneCardRoundsEnd: _end, ...legacy } = custom
  assert.deepEqual(roundSchedule(legacy, 5, 40), [1, 1, 1, 1, 1, 2, 3, 4, 4, 4, 3, 2, 1, 1, 1, 1, 1])
  for (const deckSize of [32, 36, 40, 48]) for (let n = 2; n <= 10; n++) {
    for (const mode of ['normal', 'subastada'] as const) for (let start = 1; start <= n; start++) for (let end = 1; end <= n; end++) {
      const settings = { ...defaultPochaSettings(n, deckSize), mode, oneCardRounds: start, oneCardRoundsEnd: end }
      const schedule = roundSchedule(settings, n, deckSize)
      assert.equal(schedule.length, start + end + n + 2 * (settings.maxCards - 2))
      assert.deepEqual(schedule.slice(0, start), Array(start).fill(1))
      assert.equal(schedule[start], 2)
      assert.deepEqual(schedule.slice(-end), Array(end).fill(1))
      assert.equal(schedule.at(-end - 1), 2)
    }
  }
})

test('custom settings survive deck changes, joins, departures, lobby saves and start', () => {
  const room = roomWith()
  const custom = { mode: 'subastada' as const, maxCards: 8, oneCardRounds: 5, oneCardRoundsEnd: 2, peakRounds: 5,
    exactBidPoints: 12, trickPoints: 4, missPenalty: 3 }
  assert.deepEqual(room.configurePocha({ settings: custom }), { ok: true })
  assert.deepEqual(room.configurePocha({ deckSize: 32 }), { ok: true })
  assert.deepEqual(room.pocha!.settings, { ...custom, maxCards: 6 })
  room.addPlayer('p5', 'Jugador 5')
  assert.equal(room.pocha!.settings.maxCards, 5)
  for (const id of ['p5', 'p4', 'p3']) room.removePlayer(id)
  const expected = { ...custom, maxCards: 5, oneCardRounds: 3, peakRounds: 3 }
  assert.deepEqual(room.pocha!.settings, expected)
  assert.deepEqual(room.configurePocha({ settings: { oneCardRoundsEnd: 3 } }), { ok: true })
  room.removePlayer('p2')
  assert.equal(room.pocha!.settings.oneCardRoundsEnd, 2)
  assert.deepEqual(pochaScoring(room.pocha!.settings), { exactBidPoints: 12, trickPoints: 4, missPenalty: 3 })
  const restored = Room.fromSnapshot(room.toSnapshot(), { disconnectPlayers: false })
  assert.deepEqual(restored.pocha!.settings, room.pocha!.settings)
  assert.deepEqual(restored.startPochaGame(), { ok: true })
  assert.deepEqual(restored.pocha!.schedule, roundSchedule(restored.pocha!.settings, 2, 32))
})

test('invalid custom settings cannot partially change a lobby or start a game', () => {
  const room = roomWith()
  const invalid = [
    { oneCardRoundsEnd: 0 }, { oneCardRoundsEnd: 6 }, { oneCardRoundsEnd: 1.5 }, { oneCardRoundsEnd: null },
    ...['exactBidPoints', 'trickPoints', 'missPenalty'].flatMap(key => [-1, 101, 1.5, null, '2', NaN, Infinity].map(value => ({ [key]: value }))),
  ]
  for (const patch of invalid) {
    const before = room.toSnapshot()
    assert.equal(room.configurePocha({ deckSize: 36, settings: patch }).ok, false)
    assert.deepEqual(room.toSnapshot(), before)
    assert.equal(room.startPochaGame({ ...room.pocha!.settings, ...patch } as PochaSettings).ok, false)
    assert.deepEqual(room.toSnapshot(), before)
  }
  for (const value of [0, 100]) assert.equal(room.configurePocha({ settings: { exactBidPoints: value, trickPoints: value, missPenalty: value } }).ok, true)
})

test('old saves retain the traditional points and symmetrical schedule without adding new fields', () => {
  const room = roomWith()
  const legacy = { mode: 'normal' as const, maxCards: 4, oneCardRounds: 3, peakRounds: 2 }
  assert.equal(room.startPochaGame(legacy).ok, true)
  const restored = Room.fromSnapshot(room.toSnapshot(), { disconnectPlayers: false })
  assert.deepEqual(restored.pocha!.settings, legacy)
  assert.deepEqual(restored.pocha!.schedule, [1, 1, 1, 2, 3, 4, 4, 3, 2, 1, 1, 1])
  assert.deepEqual(pochaScoring(restored.pocha!.settings), { exactBidPoints: 5, trickPoints: 2, missPenalty: 2 })
})

test('save parser rejects malformed custom settings and discards unrecognized ones', () => {
  const room = roomWith()
  assert.equal(room.configurePocha({ settings: { oneCardRoundsEnd: 2, exactBidPoints: 100, trickPoints: 0, missPenalty: 100 } }).ok, true)
  assert.deepEqual(Room.fromSnapshot(room.toSnapshot()).pocha!.settings, room.pocha!.settings)
  for (const patch of [{ oneCardRoundsEnd: 6 }, { oneCardRoundsEnd: null }, { exactBidPoints: 101 }, { trickPoints: -1 }, { missPenalty: '2' }]) {
    const raw = room.toSnapshot()
    Object.assign(raw.pocha!.settings, patch)
    assert.throws(() => Room.fromSnapshot(raw))
  }
  const raw = room.toSnapshot()
  ;(raw.pocha!.settings as unknown as Record<string, unknown>).unrecognized = 'discard'
  assert.equal('unrecognized' in Room.fromSnapshot(raw).pocha!.settings, false)
})

for (const mode of ['normal', 'subastada'] as const) test(`${mode}: custom scoring and asymmetric rounds complete with large totals and restore after every action`, t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  let room = roomWith(2)
  const settings: PochaSettings = { mode, maxCards: 24, oneCardRounds: 1, oneCardRoundsEnd: 2, peakRounds: 2,
    exactBidPoints: 100, trickPoints: 100, missPenalty: 100 }
  assert.equal(room.startPochaGame(settings).ok, true)
  let actions = 0
  while (room.pocha!.phase !== 'game_end' && actions++ < 5000) {
    t.mock.timers.tick(4000)
    const state = room.pocha!, id = state.players[state.currentPlayerIndex].id
    if (state.phase === 'hand_end') assert.equal(room.nextRound(), true)
    else {
      let action: PochaAction
      if (state.phase === 'auction') action = { type: 'auction', value: state.auction.length === 0 ? 0 : null }
      else if (state.phase === 'choosing_trump') action = { type: 'trump', suit: 'oros' }
      else if (state.phase === 'bidding') action = { type: 'bid', value: room.getState(id).pocha!.blockedBid === 0 ? 1 : 0 }
      else action = { type: 'play', cardId: room.getState(id).pocha!.legalCardIds![0] }
      assert.deepEqual(room.pochaAction(id, action), { ok: true })
    }
    room = Room.fromSnapshot(room.toSnapshot(), { disconnectPlayers: false })
    assert.deepEqual(room.pocha!.settings, settings)
  }
  assert.equal(room.pocha!.phase, 'game_end')
  assert.equal(room.pocha!.history.length, 49)
  assert.ok(room.pocha!.players.some(player => Math.abs(player.score) > 10000))
  assert.ok(room.pocha!.history.some(round => round.players.some(player => Math.abs(player.points) > 53)))
  for (const player of room.pocha!.players) {
    let total = 0
    for (const round of room.pocha!.history) {
      const result = round.players.find(p => p.id === player.id)!
      const expected = result.bid === result.tricksWon ? 100 + result.tricksWon * 100 : -100 * Math.abs(result.bid - result.tricksWon)
      assert.equal(result.points, expected)
      total += expected
      assert.equal(result.total, total)
    }
    assert.equal(player.score, total)
  }
  t.mock.timers.tick(4000)
  assert.equal(room.rematch(), true)
  assert.deepEqual(room.pocha!.settings, settings)
})
