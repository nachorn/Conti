import assert from 'node:assert/strict'
import test from 'node:test'
import { collectActions } from '../src/lib/actionPlayback.ts'
import { actionSummary } from '../src/lib/tableSummary.ts'
import type { GameState, PublicAction } from '../src/types.ts'

const action = (id: string, kind: PublicAction['kind'] = 'discard'): PublicAction => ({ id, round: 1, playerId: 'ada', playerName: 'Ada', kind, cards: [], penaltyCount: 0 })
const state = (activity: PublicAction[], phase: GameState['phase'] = 'playing', round = 1) => ({ roomId: '1234', phase, round, activity }) as GameState

test('joins and reconnects baseline history without replaying old actions', () => {
  const initial = collectActions(null, state([action('1')]), true)
  assert.deepEqual(initial.actions, [])
  const disconnected = collectActions(initial.cursor, state([action('2')]), false)
  assert.equal(disconnected.reset, true)
  assert.deepEqual(collectActions(disconnected.cursor, state([action('1'), action('2')]), true).actions, [])
})

test('batched turn actions stay ordered, repeated snapshots do not duplicate them, and final discards are collected', () => {
  const initial = collectActions(null, state([]), true)
  const feed = [action('1', 'stock'), action('2', 'add'), action('3')]
  const update = collectActions(initial.cursor, state(feed), true)
  assert.deepEqual(update.actions.map(a => a.kind), ['stock', 'add', 'discard'])
  assert.deepEqual(collectActions(update.cursor, state(feed), true).actions, [])
  assert.deepEqual(collectActions(update.cursor, state([...feed, action('4')], 'round_end'), true).actions.map(a => a.id), ['4'])
})

test('rolling history, round changes, and rematches cannot reuse stale action IDs', () => {
  const initial = collectActions(null, state([action('23'), action('24')]), true)
  assert.deepEqual(collectActions(initial.cursor, state([action('24'), action('25')]), true).actions.map(a => a.id), ['25'])
  const nextRound = collectActions(initial.cursor, state([], 'playing', 2), true)
  assert.equal(nextRound.reset, true)
  assert.deepEqual(collectActions(nextRound.cursor, state([action('1')], 'playing', 2), true).actions.map(a => a.id), ['1'])
  assert.equal(collectActions(nextRound.cursor, state([], 'playing', 1), true).reset, true)
})

test('meld additions identify the exact destination in both languages', () => {
  const added: PublicAction = { ...action('1', 'add'), cards: [{id:'new',rank:8,suit:'hearts'}], targetName: 'Bram',
    melds: [{ id:'meld', ownerId:'bram', type:'trio', cards:[{id:'a',rank:8,suit:'clubs'},{id:'b',rank:8,suit:'spades'},{id:'c',rank:8,suit:'diamonds'},{id:'new',rank:8,suit:'hearts'}] }] }
  assert.match(actionSummary(added, 'en'), /Ada added 8♥ \(Bram · Trio · 8 · 4 cards\)/)
  assert.match(actionSummary(added, 'es'), /Bram · Trío · 8 · 4 cartas/)
})
