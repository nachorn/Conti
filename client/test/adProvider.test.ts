import assert from 'node:assert/strict'
import test from 'node:test'
import { placementOutcome } from '../src/lib/adProvider.ts'

test('only shown and closed interstitials mark ad-break readiness', () => {
  assert.equal(placementOutcome({ breakFormat: 'interstitial', breakStatus: 'viewed' }, true, true), 'viewed')
  assert.equal(placementOutcome({ breakFormat: 'interstitial', breakStatus: 'dismissed' }, true, true), 'dismissed')
  assert.equal(placementOutcome({ breakFormat: 'interstitial', breakStatus: 'viewed' }, false, true), 'unavailable')
  assert.equal(placementOutcome({ breakFormat: 'interstitial', breakStatus: 'viewed' }, true, false), 'unavailable')
  assert.equal(placementOutcome({ breakFormat: 'reward', breakStatus: 'viewed' }, true, true), 'unavailable')
})

test('no fill, frequency caps, timeout and provider errors never become viewed', () => {
  for (const breakStatus of ['notReady', 'timeout', 'noAdPreloaded', 'frequencyCapped', 'ignored', 'other', 'invalid', undefined]) {
    assert.equal(placementOutcome({ breakFormat: 'interstitial', breakStatus }, true, true), 'unavailable')
  }
  assert.equal(placementOutcome({ breakStatus: 'error' }, false, false), 'error')
})
