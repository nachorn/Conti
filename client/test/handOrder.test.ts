import assert from 'node:assert/strict'
import test from 'node:test'
import { cardDropSide, moveHandCard } from '../src/lib/handOrder.ts'

test('a card can move left before another card', () => {
  assert.deepEqual(moveHandCard(['a', 'b', 'c', 'd'], 'd', 'b', 'before'), ['a', 'd', 'b', 'c'])
})

test('a card can move right after an adjacent card', () => {
  assert.deepEqual(moveHandCard(['a', 'b', 'c', 'd'], 'b', 'c', 'after'), ['a', 'c', 'b', 'd'])
})

test('dropping at either end and invalid drops are safe', () => {
  assert.deepEqual(moveHandCard(['a', 'b', 'c'], 'c', 'a', 'before'), ['c', 'a', 'b'])
  assert.deepEqual(moveHandCard(['a', 'b', 'c'], 'a', 'c', 'after'), ['b', 'c', 'a'])
  const unchanged = ['a', 'b', 'c']
  assert.equal(moveHandCard(unchanged, 'a', 'a', 'after'), unchanged)
  assert.equal(moveHandCard(unchanged, 'missing', 'b', 'before'), unchanged)
})

test('pointer position chooses the nearest side of a card', () => {
  assert.equal(cardDropSide(119, 100, 40), 'before')
  assert.equal(cardDropSide(120, 100, 40), 'after')
})
