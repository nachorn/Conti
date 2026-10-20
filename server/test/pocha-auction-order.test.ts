import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPochaAction, createPochaHandState, nextPochaRound, publicPochaState } from '../src/game/pocha/pochaEngine.js'
import { parsePochaSnapshot } from '../src/game/pocha/pochaSnapshot.js'
import type { PochaAction, PochaGameState } from '../src/game/pocha/pochaTypes.js'

const players = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, name: `Jugador ${i + 1}`, seatIndex: i, score: 0, connected: true,
}))
const currentId = (state: PochaGameState) => state.players[state.currentPlayerIndex].id
const act = (state: PochaGameState, action: PochaAction) =>
  assert.deepEqual(applyPochaAction(state, currentId(state), action), { ok: true })
const restore = (state: PochaGameState) => parsePochaSnapshot(structuredClone(state), state.roomId, state.players)
const seatsFrom = (lead: number, n: number) => Array.from({ length: n }, (_, i) => (lead + i) % n)

test('requested example: J1 opens at 2, J2 wins at 3, J3 passes; predictions are J1 then J3', () => {
  let state = createPochaHandState('example', players(3), 4, 2, 40,
    { mode: 'subastada', maxCards: 4, oneCardRounds: 1, peakRounds: 1 })
  act(state, { type: 'auction', value: 2 })
  act(state, { type: 'auction', value: 3 })
  act(state, { type: 'auction', value: null })
  assert.equal(currentId(state), 'p1')
  state = restore(state)
  act(state, { type: 'trump', suit: 'oros' })
  assert.equal(currentId(state), 'p0')
  act(state, { type: 'bid', value: 0 })
  state = restore(state)
  assert.equal(currentId(state), 'p2')
  assert.equal(publicPochaState(state, 'p2').blockedBid, 1)
  const before = structuredClone(state)
  assert.equal(applyPochaAction(state, 'p2', { type: 'bid', value: 1 }).ok, false)
  assert.deepEqual(state, before)
  act(state, { type: 'bid', value: 0 })
  assert.equal(state.phase, 'playing')
  assert.equal(currentId(state), 'p1')
  assert.equal(state.bids.p1, 3)
  assert.equal(state.originalLeadPlayerIndex, 0)
})

test('all auction seats and original rotations preserve bidding order across decks, player counts and recovery', t => {
  let cases = 0
  let fullDeals = 0
  let partialDeals = 0
  for (const deck of [32, 36, 40, 48] as const) for (let n = 2; n <= 10; n++) {
    for (const maxCards of [1, Math.floor(deck / n)]) for (let original = 0; original < n; original++) {
      for (let winner = 0; winner < n; winner++) {
        const order = seatsFrom(original, n)
        const expected = order.filter(index => index !== winner)
        let state = createPochaHandState('matrix', players(n), maxCards, (original + n - 1) % n, deck,
          { mode: 'subastada', maxCards, oneCardRounds: 1, peakRounds: 1 })
        const offer = winner === original ? 0 : 1
        for (const index of order) {
          assert.equal(state.currentPlayerIndex, index)
          act(state, { type: 'auction', value: index === winner ? offer : index === original ? 0 : null })
        }
        state = restore(state)
        assert.equal(state.currentPlayerIndex, winner)
        act(state, { type: 'trump', suit: 'espadas' })
        state = restore(state)
        const observed: number[] = []
        for (let i = 0; i < expected.length; i++) {
          assert.equal(state.phase, 'bidding')
          assert.equal(state.currentPlayerIndex, expected[i])
          observed.push(state.currentPlayerIndex)
          const before = structuredClone(state)
          // The winner must never get a second prediction, even when seated between remaining players.
          assert.equal(applyPochaAction(state, `p${winner}`, { type: 'bid', value: 0 }).ok, false)
          assert.deepEqual(state, before)
          const blocked = publicPochaState(state, currentId(state)).blockedBid
          if (i < expected.length - 1) assert.equal(blocked, null)
          else {
            const difference = maxCards - Object.values(state.bids).reduce((sum, bid) => sum + bid, 0)
            assert.equal(blocked, difference >= 0 && difference <= maxCards ? difference : null)
            if (blocked !== null) {
              assert.equal(applyPochaAction(state, currentId(state), { type: 'bid', value: blocked }).ok, false)
              assert.deepEqual(state, before)
            }
          }
          act(state, { type: 'bid', value: blocked === 0 ? 1 : 0 })
          state = restore(state)
        }
        assert.deepEqual(observed, expected)
        assert.equal(new Set(observed).size, n - 1)
        assert.equal(state.phase, 'playing')
        assert.equal(state.currentPlayerIndex, winner)
        assert.equal(state.bids[`p${winner}`], offer)
        assert.equal(state.players[winner].bid, offer)
        assert.equal(state.originalLeadPlayerIndex, original)
        assert.equal(state.dealerIndex, (original + n - 1) % n)
        assert.equal(Object.keys(state.bids).length, n)
        if (n * maxCards === deck) fullDeals++; else partialDeals++
        cases++
      }
    }
  }
  assert.equal(cases, 3072)
  assert.ok(fullDeals > 0 && partialDeals > 0)
  t.diagnostic(`${cases} auction paths, including ${fullDeals} full deals and ${partialDeals} partial deals`)
})

test('normal rounds keep their original prediction order for every deck, player count and lead', () => {
  for (const deck of [32, 36, 40, 48] as const) for (let n = 2; n <= 10; n++) {
    for (let original = 0; original < n; original++) {
      const state = createPochaHandState('normal', players(n), 1, (original + n - 1) % n, deck,
        { mode: 'normal', maxCards: 1, oneCardRounds: 1, peakRounds: 1 })
      for (const index of seatsFrom(original, n)) {
        assert.equal(state.currentPlayerIndex, index)
        act(state, { type: 'bid', value: 0 })
      }
      assert.equal(state.phase, 'playing')
      assert.equal(state.currentPlayerIndex, original)
    }
  }
})

test('the same auction winner keeps the first trick but the original hand and final bidder rotate each round', t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1000 })
  let state = createPochaHandState('rotation', players(3), 1, 2, 36,
    { mode: 'subastada', maxCards: 1, oneCardRounds: 3, peakRounds: 1 })
  const orders: number[][] = []
  for (let round = 0; round < 3; round++) {
    assert.equal(state.originalLeadPlayerIndex, round)
    for (const index of seatsFrom(round, 3)) {
      act(state, { type: 'auction', value: index === 1 ? 1 : index === round ? 0 : null })
    }
    act(state, { type: 'trump', suit: 'bastos' })
    const order: number[] = []
    while (state.phase === 'bidding') {
      order.push(state.currentPlayerIndex)
      act(state, { type: 'bid', value: publicPochaState(state, currentId(state)).blockedBid === 0 ? 1 : 0 })
    }
    orders.push(order)
    assert.equal(state.currentPlayerIndex, 1)
    while (state.phase === 'playing') {
      act(state, { type: 'play', cardId: publicPochaState(state, currentId(state)).legalCardIds![0] })
    }
    assert.equal(state.history.at(-1)!.players.reduce((sum, p) => sum + p.tricksWon, 0), 1)
    state = restore(state)
    if (round < 2) {
      t.mock.timers.tick(4000)
      nextPochaRound(state)
    }
  }
  assert.deepEqual(orders, [[0, 2], [2, 0], [2, 0]])
  assert.equal(state.phase, 'game_end')
})

test('an older in-progress auction save retains completed bids and skips them when continuing', () => {
  let state = createPochaHandState('legacy-bids', players(5), 4, 4, 40,
    { mode: 'subastada', maxCards: 4, oneCardRounds: 1, peakRounds: 1 })
  for (const value of [0, null, 1, null, null]) act(state, { type: 'auction', value })
  act(state, { type: 'trump', suit: 'copas' })
  // Old releases began at p3 after p2 won. Preserve a save made after p3's prediction.
  state.currentPlayerIndex = 4
  state.players[3].bid = 0
  state.bids.p3 = 0
  state = restore(state)
  const observed: number[] = []
  while (state.phase === 'bidding') {
    observed.push(state.currentPlayerIndex)
    act(state, { type: 'bid', value: 0 })
    state = restore(state)
  }
  assert.deepEqual(observed, [4, 0, 1])
  assert.equal(state.bids.p2, 1)
  assert.equal(state.bids.p3, 0)
  assert.equal(state.phase, 'playing')
  assert.equal(state.currentPlayerIndex, 2)
})
