import assert from 'node:assert/strict'
import type { GameState } from '../../src/types.js'

export async function drivePochaGame(options: {
  playerIds: string[]
  view: (id: string) => GameState
  action: (id: string, event: string, payload?: unknown) => Promise<{ ok: boolean; error?: string }>
  advance: (milliseconds: number) => Promise<void>
}) {
  const { playerIds, view, action, advance } = options
  let actions = 0, privateViewChecks = 0
  const eventCounts: Record<string, number> = {}
  while (actions < 2000) {
    const state = view(playerIds[0]).pocha!
    for (const id of playerIds) {
      const own = view(id).pocha!
      assert.equal(own.players.length, 5)
      assert(own.players.filter(p => p.id !== id).every(p => p.hand.length === 0), 'Other human hands remain private')
      privateViewChecks++
    }
    if (state.phase === 'game_end') {
      const totals = new Map(playerIds.map(id => [id, 0]))
      for (const hand of state.history) {
        assert.equal(hand.players.reduce((sum, p) => sum + p.tricksWon, 0), hand.cardsPerHand)
        for (const p of hand.players) {
          const expected = p.bid === p.tricksWon ? 5 + 2 * p.tricksWon : -2 * Math.abs(p.bid - p.tricksWon)
          assert.equal(p.points, expected)
          totals.set(p.id, totals.get(p.id)! + expected)
          assert.equal(p.total, totals.get(p.id))
        }
      }
      for (const p of state.players) assert.equal(p.score, totals.get(p.id))
      return { actions, rounds: state.history.length, eventCounts, privateViewChecks,
        finalScores: state.players.map(p => ({ name: p.name, score: p.score })) }
    }
    if ((state.trickReviewUntil ?? 0) > (state.serverTime ?? 0)) {
      await advance(state.trickReviewUntil! - state.serverTime! + 1); continue
    }
    let id: string, event: string, payload: unknown
    if (state.phase === 'hand_end') { id = playerIds[0]; event = 'next_round'; payload = {} }
    else {
      id = state.players[state.currentPlayerIndex].id; event = 'pocha_action'
      const own = view(id).pocha!
      if (state.phase === 'bidding') {
        const player = own.players.find(p => p.id === id)!
        let value = Math.min(state.cardsPerHand, player.hand.filter(c => c.rank === 1 || (c.suit === state.trump && c.rank === 3)).length)
        if (value === own.blockedBid) value = value === 0 ? 1 : 0
        payload = { type: 'bid', value }
      } else {
        assert.equal(state.phase, 'playing')
        assert(own.legalCardIds?.length, 'Current human has a legal card')
        payload = { type: 'play', cardId: own.legalCardIds![0] }
      }
    }
    const result = await action(id, event, payload)
    assert.equal(result.ok, true, `${event}: ${result.error ?? ''}`)
    eventCounts[event] = (eventCounts[event] ?? 0) + 1; actions++
  }
  throw new Error('Pocha audit exceeded legal action budget')
}
