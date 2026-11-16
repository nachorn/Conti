import test from 'node:test'
import assert from 'node:assert/strict'
import { AdFrequency } from '../src/lib/adFrequency.ts'

test('two actual starts cap later requests and expire on a rolling hour', () => {
  let now = 10_000
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  const gate = new AdFrequency(storage, () => now)
  assert.equal(gate.allowed(), true)
  assert.equal(gate.recordShown(), true)
  now += 1000
  assert.equal(gate.recordShown(), true)
  assert.equal(gate.allowed(), false)
  assert.equal(new AdFrequency(storage, () => now).allowed(), false)
  assert.equal(gate.recordShown(), false)
  now += 60 * 60 * 1000
  assert.equal(gate.allowed(), true)
})

test('blocked storage, corrupt values and a low precision clock preserve an in-memory cap', () => {
  const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  const gate = new AdFrequency(storage, () => 100)
  assert.equal(gate.recordShown(), true)
  assert.equal(gate.recordShown(), true)
  assert.equal(gate.allowed(), false)
  const corrupt = new AdFrequency({ getItem: () => '{broken', setItem: () => {} }, () => 100)
  assert.equal(corrupt.allowed(), true)
})
