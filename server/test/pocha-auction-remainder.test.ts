import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import { createPochaHandState, publicPochaState } from '../src/game/pocha/pochaEngine.js'
import { isPochaAuctionRound, roundSchedule } from '../src/game/pocha/pochaRules.js'
import type { PochaAction, PochaSettings } from '../src/game/pocha/pochaTypes.js'

const players = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Jugador ${i}`, seatIndex: i, score: 0, connected: true }))
const settings: PochaSettings = { mode: 'subastada', maxCards: 6, oneCardRounds: 3, peakRounds: 3 }

test('auction opt-in applies only to the configured peak; legacy and normal deals keep their trump card', () => {
  for (const option of [undefined, false, true]) {
    for (const mode of ['normal', 'subastada'] as const) {
      const setup = { ...settings, mode, auctionWithRemainder: option }
      const schedule = roundSchedule(setup, 5, 40)
      for (let round = 1; round <= schedule.length; round++) {
        const auction = mode === 'subastada' && option === true && schedule[round - 1] === 6
        const state = createPochaHandState('1234', players, round, 4, 40, setup)
        assert.equal(isPochaAuctionRound(setup, schedule[round - 1], 5, 40), auction)
        assert.equal(state.phase, auction ? 'auction' : 'bidding')
        assert.equal(state.trumpCard === null, auction)
        assert.equal(state.trump === null, auction)
        assert.equal(new Set(state.players.flatMap(p => p.hand.map(c => c.id))).size, state.cardsPerHand * 5)
        if (!auction) assert.ok(!state.players.some(p => p.hand.some(c => c.id === state.trumpCard!.id)))
      }
      const full = { ...setup, maxCards: 8 }
      const peakRound = roundSchedule(full, 5, 40).indexOf(8) + 1
      assert.equal(createPochaHandState('1234', players, peakRound, 4, 40, full).phase, mode === 'subastada' ? 'auction' : 'bidding')
    }
  }
})

test('five complete games preserve the option, auction winner, original rotation and scores through recovery', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const cases = [
    { deck: 40, setup: { ...settings, auctionWithRemainder: true }, auctions: 3 },
    { deck: 48, setup: { ...settings, maxCards: 9, auctionWithRemainder: true }, auctions: 3 },
    { deck: 40, setup: { ...settings, auctionWithRemainder: false }, auctions: 0 },
    { deck: 40, setup: { ...settings, mode: 'normal', auctionWithRemainder: true }, auctions: 0 },
    { deck: 48, setup: { ...settings, maxCards: 1, auctionWithRemainder: true }, auctions: 3 },
  ] as const
  for (const { deck, setup, auctions } of cases) {
    let room = new Room({ roomId: '1234', gameType: 'pocha', pochaDeckSize: deck })
    players.forEach(p => room.addPlayer(p.id, p.name))
    assert.deepEqual(room.startPochaGame(setup), { ok: true })
    let auctionCount = 0
    let actions = 0
    while (room.phase !== 'game_end' && actions++ < 3000) {
      t.mock.timers.tick(4000)
      const s = room.pocha!
      if (s.phase === 'hand_end') {
        const original = s.originalLeadPlayerIndex
        assert.ok(room.nextRound())
        assert.equal(room.pocha!.originalLeadPlayerIndex, (original + 1) % 5)
      } else {
        const id = s.players[s.currentPlayerIndex].id
        let action: PochaAction
        if (s.phase === 'auction') {
          if (s.auction.length === 0) auctionCount++
          assert.equal(s.cardsPerHand, setup.maxCards)
          assert.equal(s.trumpCard, null)
          assert.equal(s.trump, null)
          action = { type: 'auction', value: s.auction.length === 0 ? 0 : s.auction.length === 2 ? 1 : null }
        } else if (s.phase === 'choosing_trump') {
          assert.equal(s.currentPlayerIndex, (s.originalLeadPlayerIndex + 2) % 5)
          assert.equal(s.bids[id], 1)
          assert.equal(s.trumpCard, null)
          action = { type: 'trump', suit: 'oros' }
        } else if (s.phase === 'bidding') {
          action = { type: 'bid', value: publicPochaState(s, id).blockedBid === 0 ? 1 : 0 }
        } else {
          action = { type: 'play', cardId: publicPochaState(s, id).legalCardIds![0] }
        }
        assert.deepEqual(room.pochaAction(id, action), { ok: true })
        if (action.type === 'bid' && room.pocha!.phase === 'playing' && s.auctionWinnerId) {
          assert.equal(room.pocha!.players[room.pocha!.currentPlayerIndex].id, s.auctionWinnerId)
          assert.equal(room.pocha!.trump, 'oros')
          assert.equal(room.pocha!.trumpCard, null)
        }
      }
      room = Room.fromSnapshot(room.toSnapshot(), { disconnectPlayers: false })
      assert.deepEqual(room.pocha!.settings, setup)
    }
    assert.equal(room.phase, 'game_end')
    assert.equal(auctionCount, auctions)
    assert.equal(room.pocha!.history.length, room.pocha!.schedule.length)
    for (const hand of room.pocha!.history) assert.equal(hand.players.reduce((sum, p) => sum + p.tricksWon, 0), hand.cardsPerHand)
    for (const p of room.pocha!.players) assert.equal(p.score, room.pocha!.history.reduce((sum, h) => sum + h.players.find(q => q.id === p.id)!.points, 0))
  }
})

test('invalid option values are rejected on start and restore; old snapshots remain compatible', () => {
  const room = new Room({ roomId: '1234', gameType: 'pocha' })
  players.forEach(p => room.addPlayer(p.id, p.name))
  const before = room.toSnapshot()
  assert.deepEqual(Room.fromSnapshot(before).pocha!.settings, before.pocha!.settings)
  for (const value of ['true', 'false', 0, 1, null, {}]) {
    assert.equal(room.startPochaGame({ ...settings, auctionWithRemainder: value } as any).ok, false)
    assert.deepEqual(room.toSnapshot(), before)
    const invalid = structuredClone(before)
    ;(invalid.pocha!.settings as any).auctionWithRemainder = value
    assert.throws(() => Room.fromSnapshot(invalid))
  }
})
