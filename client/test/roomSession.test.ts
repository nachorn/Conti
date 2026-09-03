import assert from 'node:assert/strict'
import test from 'node:test'
import { emitWhenReady, isRoomSession, readRoomSession, writeRoomSession, type SessionStorage } from '../src/lib/roomSession.ts'

const session = { roomId: '1234', playerId: 'stable-player-id', token: 'a-private-random-token-with-at-least-32-characters' }

function memoryStorage(): SessionStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

test('a saved seat survives a new read and can be explicitly forgotten', () => {
  const storage = memoryStorage()
  assert.equal(writeRoomSession(storage, session), true)
  assert.deepEqual(readRoomSession(storage), session)
  assert.equal(writeRoomSession(storage, null), true)
  assert.equal(readRoomSession(storage), null)
})

test('per-tab storage does not share a seat with a separate tab', () => {
  const firstTab = memoryStorage()
  const secondTab = memoryStorage()
  writeRoomSession(firstTab, session)
  assert.equal(readRoomSession(secondTab), null)
})

test('a refreshed credential replaces the old saved token', () => {
  const storage = memoryStorage()
  writeRoomSession(storage, session)
  const refreshed = { ...session, token: 'another-private-random-token-with-at-least-32-characters' }
  writeRoomSession(storage, refreshed)
  assert.deepEqual(readRoomSession(storage), refreshed)
})

test('malformed, partial and oversized saved credentials are rejected', () => {
  for (const value of [null, {}, 'text', { ...session, roomId: '12345' }, { ...session, token: 'short' }, { ...session, playerId: '' }, { ...session, token: 'x'.repeat(257) }]) {
    assert.equal(isRoomSession(value), false)
    const storage = { ...memoryStorage(), getItem: () => JSON.stringify(value) }
    assert.equal(readRoomSession(storage), null)
  }
  assert.equal(readRoomSession({ ...memoryStorage(), getItem: () => '{broken JSON' }), null)
})

test('blocked or unavailable storage does not crash connection recovery', () => {
  const blocked = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
    removeItem: () => { throw new Error('blocked') },
  }
  assert.equal(readRoomSession(blocked), null)
  assert.equal(writeRoomSession(blocked, session), false)
  assert.equal(writeRoomSession(blocked, null), false)
  assert.equal(readRoomSession(null), null)
  assert.equal(writeRoomSession(null, session), false)
})

test('game actions never enter Socket.IO offline or unauthenticated buffers', () => {
  const events: unknown[][] = []
  const socket = { connected: false, emit: (...args: unknown[]) => { events.push(args) } }
  assert.equal(emitWhenReady(socket, true, 'discard', { cardId: 'card-1' }), false)
  socket.connected = true
  assert.equal(emitWhenReady(socket, false, 'discard', { cardId: 'card-1' }), false)
  assert.equal(emitWhenReady(null, true, 'leave'), false)
  assert.deepEqual(events, [])
  assert.equal(emitWhenReady(socket, true, 'discard', { cardId: 'card-2' }), true)
  assert.deepEqual(events, [['discard', { cardId: 'card-2' }]])
})
