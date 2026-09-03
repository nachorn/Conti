import assert from 'node:assert/strict'
import test from 'node:test'
import { pochaRankLabel, pochaRankLong } from '../src/components/pocha/pochaCardUtils.ts'

test('Pocha card faces use numeric labels for every rank', () => {
  assert.deepEqual(
    [1, 8, 9, 10, 11, 12].map(pochaRankLabel),
    ['1', '8', '9', '10', '11', '12'],
  )
})

test('Pocha court ranks keep their accessible Spanish names', () => {
  assert.equal(pochaRankLong(10), 'Sota')
  assert.equal(pochaRankLong(11), 'Caballo')
  assert.equal(pochaRankLong(12), 'Rey')
})

test('invalid Pocha ranks have a safe fallback label', () => {
  assert.equal(pochaRankLabel(0), '?')
  assert.equal(pochaRankLabel(13), '?')
  assert.equal(pochaRankLabel(1.5), '?')
})
