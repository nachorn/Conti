import assert from 'node:assert/strict'
import test from 'node:test'
import { COSMETIC_STORAGE_PREFIX, DEFAULT_COSMETICS, effectiveCosmetics, hasCosmeticAccess, parseCosmetics, readCosmetics, saveCosmetics } from '../src/lib/cosmetics.ts'

test('premium cosmetic preferences never unlock access and expire with the authoritative account', () => {
  const premium = { table: 'midnight', cardBack: 'geometric' } as const
  assert.deepEqual(effectiveCosmetics(premium, null, 1000), DEFAULT_COSMETICS)
  assert.deepEqual(effectiveCosmetics(premium, { adFree: false, expiresAt: null }, 1000), DEFAULT_COSMETICS)
  assert.deepEqual(effectiveCosmetics(premium, { adFree: true, expiresAt: 1000 }, 1000), DEFAULT_COSMETICS)
  assert.deepEqual(effectiveCosmetics(premium, { adFree: true, expiresAt: 1001 }, 1000), premium)
  assert.equal(hasCosmeticAccess({ adFree: true, expiresAt: null }, 1000), true)
})

test('account-scoped preferences contain only known appearance IDs and can restore free defaults', () => {
  const entries = new Map<string, string>()
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value) } }
  assert.equal(saveCosmetics(storage, 'a', { table: 'wine', cardBack: 'linen' }), true)
  assert.deepEqual(readCosmetics(storage, 'a'), { table: 'wine', cardBack: 'linen' })
  assert.deepEqual(readCosmetics(storage, 'b'), DEFAULT_COSMETICS)
  assert.equal(entries.get(COSMETIC_STORAGE_PREFIX + 'a')!.includes('adFree'), false)
  assert.deepEqual(parseCosmetics({ table: '<script>', cardBack: 'https://invalid.example', adFree: true }), DEFAULT_COSMETICS)
  saveCosmetics(storage, 'a', { ...DEFAULT_COSMETICS })
  assert.deepEqual(readCosmetics(storage, 'a'), DEFAULT_COSMETICS)
})

test('blocked, corrupted and oversized cosmetic storage fails safely without affecting game saves', () => {
  assert.deepEqual(readCosmetics({ getItem: () => '{', setItem: () => {} }, 'a'), DEFAULT_COSMETICS)
  assert.deepEqual(readCosmetics({ getItem: () => 'x'.repeat(257), setItem: () => {} }, 'a'), DEFAULT_COSMETICS)
  assert.deepEqual(readCosmetics(null, 'a'), DEFAULT_COSMETICS)
  assert.equal(saveCosmetics({ getItem: () => null, setItem: () => { throw new Error('quota') } }, 'a', { ...DEFAULT_COSMETICS }), false)
})
