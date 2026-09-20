import assert from 'node:assert/strict'
import test from 'node:test'
import { readSavedGames, rememberGame, forgetGame, SAVED_GAMES_KEY } from '../src/lib/savedGames.ts'
import type { GameState } from '../src/types.ts'

function storage() {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}
const session = { roomId: '1234', playerId: 'ana', token: 'a'.repeat(43) }
const state = { roomId: '1234', gameType: 'continental', round: 4,
  players: [{ id: 'ana', name: 'Ana', hand: [{ secretCard: true }] }, { id: 'pablo', name: 'Pablo' }],
  savedGame: { paused: true, updatedAt: 100, expiresAt: 200 },
} as unknown as GameState

test('browser saves preserve separate seats and rooms across reads without storing cards', () => {
  const disk = storage()
  assert.ok(rememberGame(disk, session, state))
  assert.ok(rememberGame(disk, { ...session, playerId: 'pablo' }, state))
  assert.ok(rememberGame(disk, { ...session, roomId: '9876' }, { ...state, roomId: '9876' }))
  assert.equal(readSavedGames(disk).length, 3)
  assert.equal(readSavedGames(disk)[0].round, 4)
  assert.equal(readSavedGames(disk)[0].paused, true)
  assert.equal(JSON.stringify(readSavedGames(disk)).includes('secretCard'), false)
  rememberGame(disk, session, { ...state, round: 5 })
  assert.equal(readSavedGames(disk).length, 3)
  assert.equal(readSavedGames(disk).find(g => g.roomId === '1234' && g.playerId === 'ana')!.round, 5)
  assert.ok(forgetGame(disk, session))
  assert.equal(readSavedGames(disk).length, 2)
  assert.ok(readSavedGames(disk).some(g => g.playerId === 'pablo'))
})

test('corrupt or unrelated entries do not hide valid saved games; missing storage fails safely', () => {
  const disk = storage()
  rememberGame(disk, session, state)
  disk.setItem(`${SAVED_GAMES_KEY}:broken`, '{')
  disk.setItem(`${SAVED_GAMES_KEY}:invalid`, JSON.stringify({ ...session, round: 'bad' }))
  disk.setItem('other-feature', '{}')
  assert.equal(readSavedGames(disk).length, 1)
  assert.deepEqual(readSavedGames(null), [])
  assert.equal(rememberGame(null, session, state), false)
  assert.equal(rememberGame(disk, { ...session, roomId: '9999' }, state), false)
  const blocked = { ...disk, setItem: () => { throw new Error('Quota exceeded') } }
  assert.equal(rememberGame(blocked, session, state), false)
  assert.equal(readSavedGames(disk).length, 1)
})

test('Pocha summaries use the hand number, and stale entries can still be checked with the server', () => {
  const disk = storage()
  rememberGame(disk, session, { ...state, gameType: 'pocha', pocha: { handNumber: 12 } } as GameState)
  assert.equal(readSavedGames(disk)[0].round, 12)
  assert.equal(readSavedGames(disk)[0].gameType, 'pocha')
})
