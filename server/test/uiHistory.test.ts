import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import type { Card } from '../src/types.js'

const c = (id: string, rank = 8): Card => ({ id, rank, suit: 'hearts' })
function room() {
  const r = new Room({ roomId: 'history', discardOptionDelaySeconds: 0 })
  for (const id of ['host', 'ada', 'bram', 'cleo']) r.addPlayer(id, id)
  r.startGame()
  r.startRound(0)
  r.stock = [c('private-penalty', 6), c('private-stock', 13)]
  r.discardPile = [c('older', 3), c('public', 12)]
  r.topDiscard = r.discardPile.at(-1)!
  return r
}

test('purchase history stays public, bounded and survives reconnect', () => {
  const r = room()
  assert.equal(r.passDiscard('host').ok, true)
  assert.equal(r.takeDiscard('ada').ok, true)
  assert.equal(r.draw('host', false).ok, true)
  const publicView = r.getState('bram')
  assert.deepEqual(publicView.activity?.map(a => a.kind), ['pass', 'buy', 'stock'])
  assert.equal(publicView.activity?.[1]?.penaltyCount, 1)
  assert.equal(JSON.stringify(publicView.activity).includes('private-'), false)
  assert.deepEqual(Room.fromSnapshot(r.toSnapshot()).getState('bram').activity, publicView.activity)
  for (let i = 0; i < 30; i++) {
    r.currentPlayerHasDrawn = false
    r.stock.push(c(`private-${i}`))
    r.draw('host', false)
  }
  assert.equal(r.activity.length, 24)
  assert.equal(new Set(r.activity.map(a => a.id)).size, 24)
})

test('closing discard and seven score rounds persist, and a rematch resets the game while retaining seats', () => {
  const r = room()
  const seats = r.players.map(p => [p.id, p.name, p.seatIndex, p.connected])
  for (let round = 1; round <= 7; round++) {
    r.discardOptionPlayerIndex = null
    r.discarderIndex = null
    r.currentPlayerIndex = 0
    r.currentPlayerHasDrawn = true
    r.playedMeldThisTurn = true
    r.players[0]!.hand = [c(`closing-${round}`, 2)]
    r.players.slice(1).forEach((p, i) => { p.hand = [c(`held-${round}-${i}`, 5)] })
    assert.equal(r.discard('host', `closing-${round}`).ok, true)
    const result = r.roundHistory.at(-1)!
    assert.equal(result.winnerId, 'host')
    assert.equal(result.scores.host, -10 * round)
    assert.equal(result.closingAction?.cards[0]?.id, `closing-${round}`)
    assert.deepEqual(Room.fromSnapshot(r.toSnapshot()).roundHistory, r.roundHistory)
    if (round < 7) assert.equal(r.nextRound(), true)
  }
  assert.equal(r.roundHistory.length, 7)
  assert.equal(r.players[0]!.score, -280)
  assert.equal(r.phase, 'game_end')
  assert.equal(r.rematch(), true)
  assert.equal(r.phase, 'playing')
  assert.equal(r.round, 1)
  assert.deepEqual(r.players.map(p => [p.id, p.name, p.seatIndex, p.connected]), seats)
  assert.ok(r.players.every(p => p.score === 0 && p.hand.length === 7))
  assert.deepEqual(r.roundHistory, [])
  assert.deepEqual(r.activity, [])
  assert.equal(r.rematch(), false)
})

test('legacy snapshots can collect new history and malformed public history fails closed', () => {
  const r = room()
  const legacy = r.toSnapshot()
  delete legacy.activity
  delete legacy.roundHistory
  assert.deepEqual(Room.fromSnapshot(legacy).roundHistory, [])
  assert.deepEqual(Room.fromSnapshot(legacy).activity, [])
  r.passDiscard('host')
  const bad = r.toSnapshot()
  bad.activity![0]!.kind = 'stock'
  bad.activity![0]!.cards = [c('private')]
  assert.throws(() => Room.fromSnapshot(bad), /private activity/)
  r.discardOptionPlayerIndex = null
  r.endRound(null, false)
  assert.equal(r.roundHistory[0]!.winnerId, null)
  assert.equal(r.roundHistory[0]!.closingAction, undefined)
  const before = r.players.map(p => p.score)
  r.endRound(null, false)
  assert.deepEqual(r.players.map(p => p.score), before)
})
