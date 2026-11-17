import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { configurePasswordDelegate, hashPassword, isStoredPasswordHash, PasswordWorkBusy, verifyPassword } from '../src/passwordAuth.js'

const PASSWORD = 'a test-only long password phrase'
const mockKey = (password: string, salt: Buffer) => createHash('sha256').update(password).update(salt).digest()

test('unconfigured deployments keep canonical local scrypt hashes and missing-account dummy work', async () => {
  configurePasswordDelegate(null)
  const stored = await hashPassword(PASSWORD)
  assert.equal(isStoredPasswordHash(stored), true)
  assert.equal(await verifyPassword(PASSWORD, stored), true)
  assert.equal(await verifyPassword('different test-only input', stored), false)
  assert.equal(await verifyPassword(PASSWORD, undefined), false)
})

test('delegate receives only entered password and a copied 16-byte salt, inside the existing slot', async () => {
  const calls: { password: string; salt: Buffer }[] = []
  const reset = configurePasswordDelegate({ shouldDelegate: () => true, allowLocalFallback: () => false,
    derive: async (password, salt) => { calls.push({ password, salt: Buffer.from(salt) }); const result = mockKey(password, salt); salt.fill(0); return result },
  })
  try {
    const stored = await hashPassword(PASSWORD)
    assert.equal(isStoredPasswordHash(stored), true)
    assert.equal(calls[0].salt.length, 16)
    assert.equal(stored.split('$')[4], calls[0].salt.toString('hex'))
    assert.equal(await verifyPassword(PASSWORD, stored), true)
    assert.equal(await verifyPassword('different test-only input', stored), false)
    assert.equal(await verifyPassword(PASSWORD, undefined), false)
  } finally { reset() }
})

test('safe normal pressure stays local and never contacts the delegate', async () => {
  let calls = 0
  const reset = configurePasswordDelegate({ shouldDelegate: async () => false, allowLocalFallback: () => { throw new Error('must not run') },
    derive: async () => { calls++; throw new Error('must not run') },
  })
  const stored = await hashPassword(PASSWORD); reset()
  assert.equal(calls, 0); assert.equal(await verifyPassword(PASSWORD, stored), true)
})

test('unknown pressure, remote errors and malformed keys cannot start an unsafe local fallback', async () => {
  for (const shouldDelegate of [() => { throw new Error('probe unavailable') }, () => undefined as unknown as boolean]) {
    const reset = configurePasswordDelegate({ shouldDelegate, allowLocalFallback: () => true, derive: async () => Buffer.alloc(32) })
    try { await assert.rejects(hashPassword(PASSWORD), PasswordWorkBusy) } finally { reset() }
  }
  for (const derive of [async () => { throw new Error('private worker error') }, async () => Buffer.alloc(31)]) {
    for (const allowLocalFallback of [() => false, () => { throw new Error('probe failed') }, () => undefined as unknown as boolean]) {
      const reset = configurePasswordDelegate({ shouldDelegate: () => true, allowLocalFallback, derive })
      try { await assert.rejects(hashPassword(PASSWORD), { message: 'Password verification busy' }) } finally { reset() }
    }
  }
})

test('fallback rechecks current pressure after the remote failure and retains canonical local cost', async () => {
  let checked = false, safe = false
  const reset = configurePasswordDelegate({ shouldDelegate: () => true,
    derive: async () => { safe = true; throw new Error('worker unavailable') },
    allowLocalFallback: async () => { checked = true; return safe },
  })
  const stored = await hashPassword(PASSWORD); reset()
  assert.equal(checked, true); assert.equal(await verifyPassword(PASSWORD, stored), true)
})

test('delegate keeps one active password job and at most eight waiters', async () => {
  let active = 0, peak = 0, calls = 0, release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const reset = configurePasswordDelegate({ shouldDelegate: () => true, allowLocalFallback: () => false,
    derive: async () => { calls++; active++; peak = Math.max(peak, active); await gate; active--; return Buffer.alloc(32, 7) },
  })
  const jobs = Array.from({ length: 9 }, () => hashPassword(PASSWORD))
  try {
    await assert.rejects(hashPassword(PASSWORD), PasswordWorkBusy)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(calls, 1)
    release(); await Promise.all(jobs)
    assert.equal(calls, 9); assert.equal(peak, 1)
  } finally { release(); await Promise.allSettled(jobs); reset() }
})
