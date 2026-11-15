import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  authorizeGameSignIn, beginGameSignIn, consumeGameSignIn, createGameSignInRequest,
  GAME_SIGN_IN_STORAGE_KEY, GAME_SIGN_IN_TTL, GameSignInError, gameSignInReturnUrl,
  isAllowedGameOrigin, parseGameConnectionRequest, readGameSignInReturn,
  type GameSignInStorage,
} from '../src/lib/gameSignIn.ts'

const origin = 'https://pocha.nrnplay.com'
const secret = (letter: string) => letter.repeat(43)
const now = 1_000_000
function storage(): GameSignInStorage {
  const data = new Map<string, string>()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}
async function pending(store = storage()) {
  const url = new URL(await createGameSignInRequest({ origin, storage: store, now }))
  return { store, url, state: url.searchParams.get('state')! }
}
function validSession() {
  return { token: secret('t'), expiresAt: now + 60_000, account: { id: 'member-1', email: 'ana@example.com', name: 'Ana', hasPassword: true, adFree: false, source: null, expiresAt: null } }
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

test('game destinations accept only exact trusted origins and explicit local development hosts', () => {
  for (const value of ['https://football.nrnplay.com', 'https://conti.nrnplay.com', origin, 'https://footballchampion.net']) assert.equal(isAllowedGameOrigin(value), true)
  for (const value of [null, 'https://nrnplay.com', 'https://pocha.nrnplay.com/', 'https://pocha.nrnplay.com/game',
    'https://pocha.nrnplay.com.evil.test', 'https://pocha.nrnplay.com@evil.test', 'https://evil.test#https://pocha.nrnplay.com',
    'https://pocha.nrnplay.com:444', 'http://pocha.nrnplay.com', 'javascript:alert(1)', 'http://localhost:5174']) assert.equal(isAllowedGameOrigin(value), false)
  assert.equal(isAllowedGameOrigin('http://localhost:5174', true), true)
  assert.equal(isAllowedGameOrigin('http://127.0.0.1:5173', true), true)
  assert.equal(isAllowedGameOrigin('http://localhost:5175', true), false)
})

test('central request binds an independently random state and a private verifier to a SHA-256 challenge', async () => {
  const { store, url, state } = await pending()
  const saved = JSON.parse(store.getItem(GAME_SIGN_IN_STORAGE_KEY)!)
  assert.equal(url.origin, 'https://nrnplay.com')
  assert.equal(url.pathname, '/connect')
  assert.equal(saved.origin, origin)
  assert.equal(saved.expiresAt, now + GAME_SIGN_IN_TTL)
  assert.match(saved.verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.match(state, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(saved.verifier, state)
  assert.equal(url.searchParams.get('challenge'), createHash('sha256').update(saved.verifier).digest('base64url'))
  assert.equal(url.href.includes(saved.verifier), false)
  assert.equal(url.searchParams.has('token'), false)
  assert.deepEqual(parseGameConnectionRequest(url.search), { origin, challenge: url.searchParams.get('challenge'), state })
})

test('blocked storage or an untrusted central destination cannot trigger navigation', async () => {
  let navigated = false
  const blocked: GameSignInStorage = { getItem: () => null, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
  await assert.rejects(beginGameSignIn({ origin, storage: blocked, now, navigate: () => { navigated = true } }), { code: 'storage' })
  assert.equal(navigated, false)
  await assert.rejects(createGameSignInRequest({ origin, storage: storage(), centralOrigin: 'https://evil.test' }), { code: 'invalid_request' })
  const local = new URL(await createGameSignInRequest({ origin: 'http://localhost:5174', centralOrigin: 'http://localhost:5173', storage: storage(), development: true, now }))
  assert.equal(local.origin, 'http://localhost:5173')
})

test('malformed and duplicate central parameters cannot become an authorization request', () => {
  const good = new URLSearchParams({ origin, challenge: secret('c'), state: secret('s') })
  for (const value of ['', '?origin=https://evil.test', `${good}&state=${secret('s')}`, `${good}&next=https://evil.test`,
    good.toString().replace(secret('c'), 'short')]) assert.equal(parseGameConnectionRequest(value), null)
})

test('callback is scrubbed before its one-use proof is read or exchanged', async () => {
  const { store, state } = await pending()
  let scrubbed = false
  const proof = readGameSignInReturn({ origin, storage: store, now, hash: `#nrn-code=${secret('c')}&state=${state}`, scrub: () => { scrubbed = true } })
  assert.equal(scrubbed, true)
  assert.equal(proof?.code, secret('c'))
  assert.equal(proof?.origin, origin)
  assert.match(proof!.verifier, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(store.getItem(GAME_SIGN_IN_STORAGE_KEY), null)
  assert.throws(() => readGameSignInReturn({ origin, storage: store, now, hash: `#nrn-code=${secret('c')}&state=${state}`, scrub: () => {} }), { code: 'invalid_request' })
  assert.equal(readGameSignInReturn({ origin, storage: store, now, hash: '#rules', scrub: () => { throw new Error('should not scrub another anchor') } }), null)
})

test('mismatched state, another origin and expired proofs are rejected after removing the callback fragment', async () => {
  const { store, state } = await pending()
  let scrubCount = 0
  const read = (target: string, returnedState: string, at = now) => readGameSignInReturn({ origin: target, storage: store, now: at,
    hash: `#nrn-code=${secret('c')}&state=${returnedState}`, scrub: () => { ++scrubCount } })
  assert.throws(() => read(origin, secret('x')), { code: 'invalid_request' })
  assert.throws(() => read('https://conti.nrnplay.com', state), { code: 'invalid_request' })
  assert.throws(() => read(origin, state, now + GAME_SIGN_IN_TTL), { code: 'expired' })
  assert.equal(scrubCount, 3)
})

test('a fragment that cannot be scrubbed is never sent to the exchange endpoint', async () => {
  const { store, state } = await pending()
  let calls = 0
  await assert.rejects(consumeGameSignIn({ origin, storage: store, now, hash: `#nrn-code=${secret('c')}&state=${state}`,
    scrub: () => { throw new Error('history blocked') }, fetch: async () => { ++calls; return response(validSession()) } }), { code: 'storage' })
  assert.equal(calls, 0)
})

test('central authorization sends the existing token only in the header and returns a code-only fragment', async () => {
  const request = { origin, challenge: secret('h'), state: secret('s') }
  const code = await authorizeGameSignIn(request, secret('t'), { apiUrl: 'https://api.example.test/', fetch: async (url, init) => {
    assert.equal(url, 'https://api.example.test/api/membership/game-authorize')
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${secret('t')}`)
    assert.deepEqual(JSON.parse(String(init?.body)), { origin, challenge: secret('h') })
    return response({ code: secret('c'), expiresAt: now + 60_000 })
  } })
  const destination = new URL(gameSignInReturnUrl(request, code))
  assert.equal(destination.origin, origin)
  assert.equal(destination.pathname, '/')
  assert.equal(destination.search, '')
  assert.equal(destination.hash, `#nrn-code=${secret('c')}&state=${secret('s')}`)
  assert.equal(destination.href.includes(secret('t')), false)
})

test('StrictMode startup calls share a single exchange and only return a validated server session', async () => {
  const { store, state } = await pending()
  let hash = `#nrn-code=${secret('c')}&state=${state}`
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const consume = () => consumeGameSignIn({ origin, storage: store, now, hash, apiUrl: 'https://api.example.test', scrub: () => { hash = '' },
    fetch: async (url, init) => {
      ++calls
      assert.equal(hash, '', 'callback cleared before fetch')
      assert.equal(url, 'https://api.example.test/api/membership/game-exchange')
      const body = JSON.parse(String(init?.body))
      assert.equal(body.code, secret('c'))
      assert.equal(body.origin, origin)
      assert.match(body.verifier, /^[A-Za-z0-9_-]{43}$/)
      assert.equal(new Headers(init?.headers).has('Authorization'), false)
      await gate
      return response(validSession())
    } })
  const first = consume()
  const second = consume()
  assert.equal(first, second)
  release()
  assert.deepEqual(await first, validSession())
  assert.equal(calls, 1)
  assert.equal(await consume(), null, 'completed exchange does not re-adopt a stale session later')
})

test('rejected or malformed exchanges cannot become a session', async () => {
  for (const invalid of [null, {}, { ...validSession(), token: 'short' }, { ...validSession(), expiresAt: now - 1 }]) {
    const { store, state } = await pending()
    await assert.rejects(consumeGameSignIn({ origin, storage: store, now, hash: `#nrn-code=${secret('c')}&state=${state}`, scrub: () => {}, fetch: async () => response(invalid) }), GameSignInError)
    assert.equal(store.getItem(GAME_SIGN_IN_STORAGE_KEY), null)
  }
  const { store, state } = await pending()
  await assert.rejects(consumeGameSignIn({ origin, storage: store, now, hash: `#nrn-code=${secret('c')}&state=${state}`, scrub: () => {}, fetch: async () => response({ error: 'invalid_code' }, 400) }), { code: 'exchange' })
})
