import assert from 'node:assert/strict'
import test from 'node:test'
import { getTurnCue, TurnCueTracker } from '../src/lib/turnCue.ts'
import { playTurnPing } from '../src/lib/turnSound.ts'
import type { GameState } from '../src/types.ts'

const state = (changes = {}) => ({ roomId: 'room', phase: 'playing', round: 1, players: [{ id: 'me' }, { id: 'other' }], currentPlayerIndex: 0, ...changes }) as GameState
test('Conti notifies the decision maker, including delayed discard options', () => {
  const cue = getTurnCue(state(), 'me')!
  assert.ok(cue); assert.equal(cue.delayMs, 0)
  assert.equal(getTurnCue(state(), 'other'), null)
  const offer = state({ discardOptionPlayerIndex: 1, discardOptionAvailableAt: 2000 })
  assert.equal(getTurnCue(offer, 'me', 1000), null)
  assert.equal(getTurnCue(offer, 'other', 1000)!.delayMs, 1000)
  assert.equal(getTurnCue(offer, 'other', 3000)!.delayMs, 0)
  assert.equal(getTurnCue(state({ stockCount: 10, hasDrawn: true }), 'me')!.key, cue.key)
  for (const s of [null, state({ phase: 'lobby' }), state({ phase: 'round_end' }), state({ savedGame: { paused: true } })]) assert.equal(getTurnCue(s, 'me'), null)
})
test('Pocha covers bidding, auction, trump selection and each trick after its review', () => {
  const pocha = { handNumber: 1, currentPlayerIndex: 0, players: [{ id: 'me', tricksWon: 0 }, { id: 'other', tricksWon: 0 }] }
  const keys = new Set<string>()
  for (const phase of ['auction', 'choosing_trump', 'bidding', 'playing']) {
    const s = state({ pocha: { ...pocha, phase } })
    keys.add(getTurnCue(s, 'me')!.key)
    assert.equal(getTurnCue(s, 'other'), null)
  }
  assert.equal(keys.size, 4)
  const next = getTurnCue(state({ pocha: { ...pocha, phase: 'playing', players: [{ id: 'me', tricksWon: 1 }], lastTrick: {}, trickReviewUntil: 5000, serverTime: 1000 } }), 'me', 99999)!
  assert.equal(next.delayMs, 4000)
  assert.ok(!keys.has(next.key))
  assert.equal(getTurnCue(state({ pocha: { ...pocha, phase: 'game_end' } }), 'me'), null)
})
test('sound tracker ignores repeated updates and reconnects, but accepts new decisions', () => {
  const tracker = new TurnCueTracker()
  const cue = getTurnCue(state(), 'me')!
  assert.equal(tracker.observe(cue, true), true)
  tracker.notified(cue)
  assert.equal(tracker.observe({ ...cue }, true), false)
  assert.equal(tracker.observe(null, false), false)
  assert.equal(tracker.observe(cue, true), false)
  assert.equal(tracker.observe(null, true), false)
  assert.equal(tracker.observe(cue, true), true)
  tracker.notified(cue)
  assert.equal(tracker.observe({ ...cue, key: 'next' }, true), true)
})
test('ping schedules two quiet notes and cleans up audio nodes; suspended audio stays silent', () => {
  const starts: number[] = [], stops: number[] = [], gains: number[] = []
  const oscillators: any[] = []
  let cleaned = 0
  const audio = { state: 'running', currentTime: 10, destination: {},
    createOscillator() { const o = { frequency: { value: 0 }, connect() {}, disconnect() { cleaned++ }, start(t: number) { starts.push(t) }, stop(t: number) { stops.push(t) }, onended: () => {} }; oscillators.push(o); return o },
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime(v: number) { gains.push(v) }, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() { cleaned++ } } }
  }
  assert.equal(playTurnPing(audio as unknown as AudioContext), true)
  assert.deepEqual(starts, [10, 10.12]); assert.equal(stops.length, 2)
  assert.deepEqual(gains, [.12, .12]); assert.deepEqual(oscillators.map(o => o.frequency.value), [740, 988])
  oscillators.forEach(o => o.onended()); assert.equal(cleaned, 4)
  audio.state = 'suspended'; assert.equal(playTurnPing(audio as unknown as AudioContext), false)
  assert.equal(starts.length, 2)
})
