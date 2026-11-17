import assert from 'node:assert/strict'
import test from 'node:test'
import { createConnectionWarningDelay, criticalConnectionState, type NoticeClock } from '../src/lib/connectionFeedback.ts'

function clock() {
  let now = 0, sequence = 0
  const jobs = new Map<number, { at: number; callback: () => void }>()
  const timers: NoticeClock = { setTimeout(callback, delay) { const id = ++sequence; jobs.set(id, { at: now + delay, callback }); return id }, clearTimeout(handle) { jobs.delete(handle as number) } }
  return { timers, pending: () => [...jobs.values()].map(job => job.callback), tick(ms: number) {
    now += ms
    for (const [id, job] of [...jobs]) if (job.at <= now) { jobs.delete(id); job.callback() }
  } }
}

test('initial handshake stays silent and a recovered short failure never flashes a notice', () => {
  const timer = clock(), visible: boolean[] = [], warning = createConnectionWarningDelay(value => visible.push(value), 2500, timer.timers)
  warning.update(null); timer.tick(30_000)
  assert.deepEqual(visible, [])
  warning.update(true); timer.tick(2499)
  assert.deepEqual(visible, [])
  const alreadyQueued = timer.pending()[0]
  warning.update(false); alreadyQueued(); timer.tick(1)
  assert.deepEqual(visible, [], 'recovery also invalidates a callback already queued by the browser')
  warning.dispose()
})

test('only a continuous failure reaches the delay; recovery clears immediately and the next failure starts fresh', () => {
  const timer = clock(), visible: boolean[] = [], warning = createConnectionWarningDelay(value => visible.push(value), 2500, timer.timers)
  warning.update(true); timer.tick(2000); warning.update(true); timer.tick(500)
  assert.deepEqual(visible, [true], 'unrelated renders do not keep postponing a genuine outage')
  warning.update(null); timer.tick(5000)
  assert.deepEqual(visible, [true], 'retrying an unresolved outage must not flash the warning off')
  warning.update(false); assert.deepEqual(visible, [true, false])
  warning.update(true); timer.tick(2499); assert.deepEqual(visible, [true, false])
  timer.tick(1); assert.deepEqual(visible, [true, false, true])
  warning.dispose()
})

test('cleanup prevents stale StrictMode timers and critical seat/saving states bypass the delay', () => {
  const timer = clock(), visible: boolean[] = [], warning = createConnectionWarningDelay(value => visible.push(value), 2500, timer.timers)
  warning.update(true)
  const stale = timer.pending()[0]
  warning.dispose(); stale(); timer.tick(3000)
  assert.deepEqual(visible, [])
  for (const status of ['paused', 'replaced'] as const) assert.equal(criticalConnectionState(status, null, true), true)
  for (const status of ['connecting', 'resuming', 'reconnecting'] as const) assert.equal(criticalConnectionState(status, '1234', true), false, 'normal seat recovery uses the same grace period')
  assert.equal(criticalConnectionState('reconnecting', '1234', true, true), true, 'a rejected recovery remains immediate')
  assert.equal(criticalConnectionState('connected', '1234', false), true)
  assert.equal(criticalConnectionState('connected', '1234', true), false)
  assert.equal(criticalConnectionState('reconnecting', null, true), false)
})
