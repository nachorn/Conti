import assert from 'node:assert/strict'
import test from 'node:test'
import { appendChat, restoreChat, type ChatMessage } from '../src/roomChat.js'

const player = { id: 'ana', name: 'Ana' }
test('chat validates input and uses the authenticated sender', () => {
  for (const payload of [null, {}, { text: 'x' }, { clientId: 'a', text: ' ' }, { clientId: 'a', text: 'x'.repeat(281) }, { clientId: {}, text: 'hi' }]) {
    assert.deepEqual(appendChat([], player, payload), { ok: false, error: 'invalid' })
  }
  const result = appendChat([], player, { clientId: 'a', text: '  Hola 👋 <script>  ', name: 'Fake', playerId: 'fake' }, 100)
  assert.ok(result.ok)
  assert.equal(result.messages[0].text, 'Hola 👋 <script>')
  assert.equal(result.messages[0].name, 'Ana')
  assert.equal(result.messages[0].playerId, 'ana')
  assert.equal(result.messages[0].sentAt, 100)
})

test('retries are idempotent, rate limits are per player, and history is bounded', () => {
  let messages: ChatMessage[] = []
  for (let i = 0; i < 5; i++) {
    const result = appendChat(messages, player, { clientId: String(i), text: 'hello' }, 100)
    assert.ok(result.ok); messages = result.messages
  }
  assert.deepEqual(appendChat(messages, player, { clientId: '5', text: 'hello' }, 101), { ok: false, error: 'rate_limit' })
  const retry = appendChat(messages, player, { clientId: '0', text: 'hello' }, 101)
  assert.ok(retry.ok && retry.duplicate); assert.equal(retry.messages.length, 5)
  assert.deepEqual(appendChat(messages, player, { clientId: '0', text: 'changed' }, 101), { ok: false, error: 'invalid' })
  assert.ok(appendChat(messages, { id: 'pablo', name: 'Pablo' }, { clientId: '0', text: 'hello' }, 101).ok)
  for (let i = 5; i < 60; i++) {
    const result = appendChat(messages, player, { clientId: String(i), text: 'hello' }, i * 10_000)
    assert.ok(result.ok); messages = result.messages
  }
  assert.equal(messages.length, 50)
  assert.equal(messages[0].clientId, '10')
})

test('saved chat supports old games, validates corruption, and copies messages', () => {
  assert.deepEqual(restoreChat(undefined), [])
  const result = appendChat([], player, { clientId: 'a', text: 'hello' }, 100)
  assert.ok(result.ok)
  const restored = restoreChat(result.messages)
  assert.deepEqual(restored, result.messages)
  assert.notEqual(restored[0], result.messages[0])
  assert.throws(() => restoreChat([...restored, ...restored]))
  assert.throws(() => restoreChat([{ ...restored[0], sentAt: 'today' }]))
  assert.throws(() => restoreChat([{ ...restored[0], text: '' }]))
})
