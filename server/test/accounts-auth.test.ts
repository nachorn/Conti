import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import express from 'express'
import test, { type TestContext } from 'node:test'
import { MembershipService } from '../src/membership.js'
import { configurePasswordDelegate, hashPassword, isStoredPasswordHash, passwordIsAcceptable, PasswordWorkBusy, verifyPassword } from '../src/passwordAuth.js'
import type { SnapshotStore } from '../src/storage.js'

const SECRET = 'account-password-tests-local-secret-not-production'
const PASSWORD = 'Mis amigos juegan Pocha 2026'
const NEW_PASSWORD = 'Otra frase privada para mi mesa'
class MemoryStore implements SnapshotStore {
  value: any = null
  saves = 0
  failAt = Infinity
  saveThenFail = false
  healthy = true
  isHealthy() { return this.healthy }
  async load() { return structuredClone(this.value) }
  async save(value: unknown) {
    this.saves++
    if (this.saves === this.failAt && !this.saveThenFail) throw new Error('local write failed')
    this.value = structuredClone(value)
    if (this.saves === this.failAt) throw new Error('local acknowledgement lost')
  }
  async close() {}
}
async function harness(t: TestContext) {
  const store = new MemoryStore(), clock = { now: Date.now() }, inbox = new Map<string, string>()
  const options = { store, authSecret: SECRET, now: () => clock.now,
    sendCode: async (email: string, code: string) => { inbox.set(email, code) } }
  const service = await new MembershipService(options).load()
  const app = express(); service.registerRoutes(app)
  const server = createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await service.close() })
  const call = (path: string, body?: unknown, token?: string) => fetch(origin + '/api/membership/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const signup = async (email = 'ana@example.com') => {
    const registrationToken = await service.register('Ana', email, PASSWORD, 'es', 'signup-ip')
    return service.verifyCode(email, inbox.get(email)!, 'verify-ip', 'register', registrationToken)
  }
  return { store, clock, inbox, options, service, call, signup }
}

test('registration is untrusted until email proof, then password login preserves the verified identity and hashed-only storage', async t => {
  const h = await harness(t)
  const registered = await h.call('register', { name: ' Ana ', email: ' ANA@EXAMPLE.COM ', password: PASSWORD, lang: 'es' })
  assert.equal(registered.status, 200)
  const { registrationToken } = await registered.json()
  assert.match(registrationToken, /^[a-zA-Z0-9_-]{43}$/)
  assert.equal(JSON.stringify(h.store.value).includes(registrationToken), false)
  assert.equal(h.store.value.accounts.length, 0)
  assert.equal(h.store.value.challenges[0].purpose, 'register')
  assert.equal(isStoredPasswordHash(h.store.value.challenges[0].passwordHash), true)
  assert.equal(JSON.stringify(h.store.value).includes(PASSWORD), false)
  assert.equal((await h.call('password-login', { email: 'ana@example.com', password: PASSWORD })).status, 401)
  assert.equal((await h.call('me')).status, 401)
  const restoredPending = await new MembershipService(h.options).load()
  const first = await restoredPending.verifyCode('ana@example.com', h.inbox.get('ana@example.com')!, 'ip', 'register', registrationToken)
  assert.equal(first.account.name, 'Ana')
  assert.equal(first.account.hasPassword, true)
  assert.equal('passwordHash' in first.account, false)
  assert.equal(restoredPending.authenticate(first.token)?.id, first.account.id)
  const restored = await new MembershipService(h.options).load()
  const second = await restored.passwordLogin(' ANA@example.com ', PASSWORD, 'second-device')
  assert.equal(second.account.id, first.account.id)
  assert.notEqual(second.token, first.token)
  assert.equal(JSON.stringify(h.store.value).includes(second.token), false)
  assert.equal(JSON.stringify(h.store.value).includes(PASSWORD), false)
  await assert.rejects(restored.verifyCode('ana@example.com', h.inbox.get('ana@example.com')!, 'ip', 'register', registrationToken), /invalid_code/)
})

test('existing email signup is a generic acknowledgement and cannot replace its name, password, gifts or sessions', async t => {
  const h = await harness(t), first = await h.signup()
  await h.service.grant('ana@example.com', null)
  const before = structuredClone(h.store.value.accounts[0]), priorCode = h.inbox.get('ana@example.com')
  assert.equal((await h.call('register', { name: 'Attacker', email: 'ana@example.com', password: NEW_PASSWORD })).status, 200)
  assert.deepEqual(h.store.value.accounts[0], before)
  assert.equal(h.inbox.get('ana@example.com'), priorCode)
  assert.equal(h.service.authenticate(first.token)?.source, 'gift')
  await assert.rejects(h.service.passwordLogin('ana@example.com', NEW_PASSWORD, 'ip'), /invalid_credentials/)
  assert.equal((await h.service.passwordLogin('ana@example.com', PASSWORD, 'ip')).account.id, first.account.id)
})

test('the profile closes its own other sessions atomically and rotates the current credential without extending it', async t => {
  const h = await harness(t), current = await h.signup(), otherAccount = await h.signup('bea@example.com')
  const otherBrowser = await h.service.passwordLogin('ana@example.com', PASSWORD, 'different-browser')
  const game = await h.service.linkedSession(current.token)
  const path = 'sessions/revoke-others'
  const denied = await h.call(path, {}, game.token)
  assert.equal(denied.status, 403)
  assert.equal((await denied.json()).error, 'primary_session_required')
  assert.equal((await h.call(path, {})).status, 401)
  assert.ok(h.service.authenticate(otherBrowser.token))
  h.clock.now += 60_000
  const results = await Promise.all([h.call(path, {}, current.token), h.call(path, {}, current.token)])
  assert.deepEqual(results.map(result => result.status).sort(), [200, 401])
  const accepted = results.find(result => result.ok)!
  assert.equal(accepted.headers.get('cache-control'), 'no-store')
  const replacement = await accepted.json()
  assert.equal(replacement.account.id, current.account.id)
  assert.equal(replacement.expiresAt, current.expiresAt)
  assert.notEqual(replacement.token, current.token)
  assert.equal(h.store.value.sessions.length, 2)
  assert.equal(JSON.stringify(h.store.value).includes(replacement.token), false)
  const restored = await new MembershipService(h.options).load()
  assert.equal(restored.authenticate(game.token), null)
  assert.equal(restored.authenticate(otherBrowser.token), null)
  assert.equal(restored.authenticate(current.token), null)
  assert.equal(restored.authenticate(replacement.token)?.id, current.account.id)
  assert.equal(restored.authenticate(otherAccount.token)?.id, otherAccount.account.id)
})

test('a failed storage write never acknowledges closing the other sessions', async t => {
  const h = await harness(t), current = await h.signup(), game = await h.service.linkedSession(current.token)
  const previous = structuredClone(h.store.value)
  h.store.failAt = h.store.saves + 1
  const response = await h.call('sessions/revoke-others', {}, current.token)
  assert.equal(response.status, 503)
  assert.deepEqual(h.store.value, previous)
  const restored = await new MembershipService(h.options).load()
  assert.equal(restored.authenticate(game.token)?.id, current.account.id)
  assert.equal(restored.authenticate(current.token)?.id, current.account.id)
})

test('a planted registration code cannot be consumed as sign-in or complete a different browser registration', async t => {
  const h = await harness(t)
  const victimToken = await h.service.register('Victim', 'victim@example.com', PASSWORD, 'es', 'victim-ip')
  const attackerToken = await h.service.register('Attacker', 'victim@example.com', NEW_PASSWORD, 'es', 'attacker-ip')
  const plantedCode = h.inbox.get('victim@example.com')!
  assert.equal((await h.call('verify', { email: 'victim@example.com', code: plantedCode })).status, 400, 'ordinary email sign-in cannot install another requester\'s password')
  assert.equal((await h.call('verify', { email: 'victim@example.com', code: plantedCode, purpose: 'register' })).status, 400)
  assert.equal((await h.call('verify', { email: 'victim@example.com', code: plantedCode, purpose: 'register', registrationToken: victimToken })).status, 400, 'victim browser is bound to its own request')
  assert.equal(h.store.value.accounts.length, 0)
  const freshToken = await h.service.register('Victim', 'victim@example.com', PASSWORD, 'es', 'victim-ip')
  const freshCode = h.inbox.get('victim@example.com')!
  assert.equal((await h.call('verify', { email: 'victim@example.com', code: freshCode, purpose: 'register', registrationToken: attackerToken })).status, 400)
  const response = await h.call('verify', { email: 'victim@example.com', code: freshCode, purpose: 'register', registrationToken: freshToken })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).account.name, 'Victim')
  await assert.rejects(h.service.passwordLogin('victim@example.com', NEW_PASSWORD, 'ip'), /invalid_credentials/)
  assert.equal((await h.service.passwordLogin('victim@example.com', PASSWORD, 'ip')).account.name, 'Victim')
})

test('reset proof is purpose-bound, one-use and revokes every older session only after changing the password', async t => {
  const h = await harness(t), first = await h.signup()
  const second = await h.service.passwordLogin('ana@example.com', PASSWORD, 'second-ip')
  assert.equal((await h.call('password-reset', { email: 'ana@example.com', lang: 'es' })).status, 200)
  const code = h.inbox.get('ana@example.com')!
  assert.equal((await h.call('verify', { email: 'ana@example.com', code })).status, 400, 'reset codes cannot sign in via the OTP endpoint')
  const wrong = code === '000000' ? '111111' : '000000'
  assert.equal((await h.call('password-reset/confirm', { email: 'ana@example.com', code: wrong, password: NEW_PASSWORD })).status, 400)
  const response = await h.call('password-reset/confirm', { email: 'ana@example.com', code, password: NEW_PASSWORD })
  assert.equal(response.status, 200)
  const changed = await response.json()
  assert.equal(changed.account.id, first.account.id)
  assert.equal(h.service.authenticate(first.token), null)
  assert.equal(h.service.authenticate(second.token), null)
  assert.equal(h.service.authenticate(changed.token)?.id, first.account.id)
  assert.equal((await h.call('password-login', { email: 'ana@example.com', password: PASSWORD })).status, 401)
  assert.equal((await h.call('password-login', { email: 'ana@example.com', password: NEW_PASSWORD })).status, 200)
  assert.equal((await h.call('password-reset/confirm', { email: 'ana@example.com', code, password: NEW_PASSWORD })).status, 400)
  assert.equal(JSON.stringify(h.store.value).includes(NEW_PASSWORD), false)
})

test('legacy email-code accounts and old in-flight codes remain usable, and can add a password through verified reset', async t => {
  const h = await harness(t)
  await h.service.requestCode('legacy@example.com', 'es', 'ip')
  const code = h.inbox.get('legacy@example.com')!
  const old = h.store.value.challenges[0]
  delete old.purpose
  old.codeHash = createHmac('sha256', SECRET).update(`${old.email}\0${old.salt}\0${code}`).digest('hex')
  const restored = await new MembershipService(h.options).load()
  const first = await restored.verifyCode('legacy@example.com', code, 'ip')
  assert.equal(first.account.hasPassword, undefined)
  await restored.requestCode('legacy@example.com', 'es', 'ip')
  const loginCode = h.inbox.get('legacy@example.com')!
  await assert.rejects(restored.confirmPasswordReset('legacy@example.com', loginCode, PASSWORD, 'ip'), /invalid_code/)
  await restored.requestPasswordReset('legacy@example.com', 'es', 'ip')
  const account = await restored.confirmPasswordReset('legacy@example.com', h.inbox.get('legacy@example.com')!, PASSWORD, 'ip')
  assert.equal(account.account.id, first.account.id)
  const withoutMailer = await new MembershipService({ store: h.store, authSecret: SECRET, now: h.options.now }).load()
  assert.equal((await withoutMailer.config()).passwordLoginEnabled, true)
  assert.equal((await withoutMailer.config()).loginEnabled, false)
  assert.equal((await withoutMailer.passwordLogin('legacy@example.com', PASSWORD, 'ip')).account.id, first.account.id)
  await assert.rejects(withoutMailer.register('New', 'new@example.com', PASSWORD, 'es', 'ip'), /email_not_configured/)
})

test('normal email-login, registration and reset challenges survive a separate flow and a reload', async t => {
  const h = await harness(t)
  const email = 'ana@example.com'
  const registrationToken = await h.service.register('Ana', email, PASSWORD, 'es', 'signup-ip')
  const registrationCode = h.inbox.get(email)!
  await h.service.requestCode(email, 'es', 'signin-ip')
  const loginCode = h.inbox.get(email)!
  const restored = await new MembershipService(h.options).load()
  const first = await restored.verifyCode(email, registrationCode, 'verify-ip', 'register', registrationToken)
  await restored.requestPasswordReset(email, 'es', 'reset-ip')
  const resetCode = h.inbox.get(email)!
  const second = await restored.verifyCode(email, loginCode, 'signin-ip')
  assert.equal(second.account.id, first.account.id)
  assert.equal(second.account.hasPassword, true)
  const third = await restored.confirmPasswordReset(email, resetCode, NEW_PASSWORD, 'reset-ip')
  assert.equal(third.account.id, first.account.id)
  assert.equal(restored.authenticate(second.token), null)
})

test('temporary password worker pressure leaves the same reset code available', async t => {
  const h = await harness(t), first = await h.signup()
  const email = first.account.email
  await h.service.requestPasswordReset(email, 'es', 'reset-ip')
  const code = h.inbox.get(email)!
  await h.service.requestCode(email, 'es', 'signin-ip')
  const previousLoginCode = h.inbox.get(email)!
  const passwordReset = { email, code, password: NEW_PASSWORD }
  const stopDelegate = configurePasswordDelegate({ shouldDelegate: () => true, allowLocalFallback: () => false, derive: async () => { throw new Error('local fixture worker unavailable') } })
  try {
    const response = await h.call('password-reset/confirm', passwordReset)
    assert.equal(response.status, 429)
    assert.equal(h.service.authenticate(first.token)?.id, first.account.id)
    assert.equal(h.store.value.challenges.find((challenge: any) => challenge.purpose === 'reset').attempts, 0)
  } finally { stopDelegate() }
  const notifications: (string | undefined)[] = []
  const unsubscribe = h.service.onChange(email => notifications.push(email))
  t.after(unsubscribe)
  assert.equal((await h.call('password-reset/confirm', passwordReset)).status, 200)
  assert.deepEqual(notifications, [email])
  assert.equal((await h.call('password-reset/confirm', passwordReset)).status, 400)
  await assert.rejects(h.service.verifyCode(email, previousLoginCode, 'signin-ip'), /invalid_code/)
  assert.equal(h.service.authenticate(first.token), null)
})

for (const invalidation of ['replacement', 'expiry']) test(`one password reset can derive at a time and rejects ${invalidation} before commit`, async t => {
  const h = await harness(t), first = await h.signup()
  const email = first.account.email
  await h.service.requestPasswordReset(email, 'es', 'reset-ip')
  const code = h.inbox.get(email)!
  let began!: () => void, release!: () => void
  const deriving = new Promise<void>(resolve => { began = resolve })
  const paused = new Promise<void>(resolve => { release = resolve })
  const stopDelegate = configurePasswordDelegate({ shouldDelegate: () => true, allowLocalFallback: () => false, derive: async () => {
    began()
    await paused
    return Buffer.alloc(32)
  } })
  const firstReset = h.service.confirmPasswordReset(email, code, NEW_PASSWORD, 'reset-ip')
  const rejected = assert.rejects(firstReset, /invalid_code/)
  try {
    await Promise.race([deriving, firstReset])
    await assert.rejects(h.service.confirmPasswordReset(email, code, NEW_PASSWORD, 'other-ip'), /rate_limited/)
    if (invalidation === 'replacement') await h.service.requestPasswordReset(email, 'es', 'reset-ip')
    else h.clock.now += 10 * 60_000
  } finally { release(); stopDelegate() }
  await rejected
  assert.equal(h.service.authenticate(first.token)?.id, first.account.id)
  if (invalidation === 'expiry') await h.service.requestPasswordReset(email, 'es', 'reset-ip')
  const second = await h.service.confirmPasswordReset(email, h.inbox.get(email)!, NEW_PASSWORD, 'reset-ip')
  assert.equal(second.account.id, first.account.id)
})

test('a reset commit that never reaches storage leaves its code and old sessions intact on restart', async t => {
  const h = await harness(t), first = await h.signup()
  const email = first.account.email
  await h.service.requestPasswordReset(email, 'es', 'reset-ip')
  const code = h.inbox.get(email)!
  h.store.failAt = h.store.saves + 3
  await assert.rejects(h.service.confirmPasswordReset(email, code, NEW_PASSWORD, 'reset-ip'), /server_unavailable/)
  const restored = await new MembershipService(h.options).load()
  assert.equal(restored.authenticate(first.token)?.id, first.account.id)
  assert.equal((await restored.confirmPasswordReset(email, code, NEW_PASSWORD, 'reset-ip')).account.id, first.account.id)
  assert.equal(restored.authenticate(first.token), null)
})

test('bad, unknown and no-password credentials are generic; durable login limits survive restart', async t => {
  const h = await harness(t)
  await h.signup()
  for (const email of ['unknown@example.com', 'ana@example.com']) {
    const response = await h.call('password-login', { email, password: 'Incorrect but adequately long' })
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: 'invalid_credentials' })
  }
  for (let i = 1; i < 10; i++) await assert.rejects(h.service.passwordLogin('ana@example.com', 'Another wrong long password', 'other-ip'), /invalid_credentials/)
  const saves = h.store.saves
  const response = await h.call('password-login', { email: 'ana@example.com', password: PASSWORD })
  assert.equal(response.status, 429)
  assert.equal(h.store.saves, saves, 'an exhausted budget cannot keep growing counters')
  const restored = await new MembershipService(h.options).load()
  await assert.rejects(restored.passwordLogin('ana@example.com', PASSWORD, 'new-ip'), /rate_limited/)
  h.clock.now += 16 * 60_000
  assert.equal((await restored.passwordLogin('ana@example.com', PASSWORD, 'new-ip')).account.name, 'Ana')
})

test('unknown reset email gets a generic response; codes expire, have five attempts and no account appears before proof', async t => {
  const h = await harness(t)
  const response = await h.call('password-reset', { email: 'unknown@example.com', lang: 'es' })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(h.store.value.accounts.length, 0)
  assert.equal(h.inbox.has('unknown@example.com'), false)
  const tokenAna = await h.service.register('Ana', 'ana@example.com', PASSWORD, 'es', 'ip')
  const correct = h.inbox.get('ana@example.com')!, wrong = correct === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) await assert.rejects(h.service.verifyCode('ana@example.com', wrong, 'ip', 'register', tokenAna), /invalid_code/)
  await assert.rejects(h.service.verifyCode('ana@example.com', correct, 'ip', 'register', tokenAna), /invalid_code/)
  assert.equal(h.store.value.accounts.length, 0)
  const tokenLuis = await h.service.register('Luis', 'luis@example.com', PASSWORD, 'es', 'ip')
  h.clock.now += 10 * 60_000 + 1
  await assert.rejects(h.service.verifyCode('luis@example.com', h.inbox.get('luis@example.com')!, 'ip', 'register', tokenLuis), /invalid_code/)
  assert.equal(h.store.value.accounts.length, 0)
})

test('reset acknowledgement never waits for delivery or exposes mail failure; close drains the bounded delivery work', async t => {
  const h = await harness(t), account = await h.signup()
  let release!: () => void, started = 0, closed = false
  const gate = new Promise<void>(resolve => { release = resolve })
  const service = await new MembershipService({ ...h.options, sendCode: async () => {
    started++
    await gate
    throw new Error('local mail provider unavailable')
  } }).load()
  assert.equal(await service.requestPasswordReset('ana@example.com', 'es', 'known-ip'), undefined)
  assert.equal(started, 1, 'known email delivery may still be running when acknowledgement resolves')
  assert.equal(await service.requestPasswordReset('unknown@example.com', 'es', 'unknown-ip'), undefined)
  assert.equal(started, 1, 'an unknown email is not sent unsolicited mail')
  assert.equal(service.authenticate(account.token)?.id, account.account.id, 'requesting recovery does not sign anyone out')
  const closing = service.close().then(() => { closed = true })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(closed, false)
  release()
  await closing
  assert.equal(service.hasFailedOperation(), false, 'email delivery failure is separate from durable storage failure')
})

test('shutdown limits recovery-delivery draining to fifteen seconds', async t => {
  const h = await harness(t)
  await h.signup()
  const service = await new MembershipService({ ...h.options, sendCode: async () => new Promise<void>(() => {}) }).load()
  await service.requestPasswordReset('ana@example.com', 'es', 'ip')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let closed = false
  const closing = service.close().then(() => { closed = true })
  await new Promise<void>(resolve => setImmediate(resolve))
  t.mock.timers.tick(14_999)
  await Promise.resolve()
  assert.equal(closed, false)
  t.mock.timers.tick(1)
  await closing
  assert.equal(closed, true)
})

test('validation rejects weak or oversized passwords and unsafe names without expensive work or storage changes', async t => {
  const h = await harness(t)
  for (const password of ['short', 'passwordpassword', 'a'.repeat(15), 'z'.repeat(129), null, 42]) {
    const response = await h.call('register', { name: 'Ana', email: 'ana@example.com', password })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_password' })
  }
  for (const name of ['', 'a'.repeat(25), 'Ana\nAdmin', null]) assert.equal((await h.call('register', { name, email: 'ana@example.com', password: PASSWORD })).status, 400)
  assert.equal(h.store.saves, 0)
  assert.equal(passwordIsAcceptable(' una frase con espacios '), true)
  assert.equal(passwordIsAcceptable('🐈'.repeat(15) + ' fin'), true)
  assert.equal(passwordIsAcceptable('una frase válida '.repeat(20)), false)
})

test('an ambiguous reset save fails closed, and restoring durable state revokes the old credential', async t => {
  const h = await harness(t), first = await h.signup()
  await h.service.requestPasswordReset('ana@example.com', 'es', 'ip')
  h.store.failAt = h.store.saves + 3 // Verification budget, proof preflight, atomic reset commit.
  h.store.saveThenFail = true
  await assert.rejects(h.service.confirmPasswordReset('ana@example.com', h.inbox.get('ana@example.com')!, NEW_PASSWORD, 'ip'), /server_unavailable/)
  assert.equal(h.service.hasFailedOperation(), true)
  assert.equal(h.service.authenticate(first.token), null)
  const restored = await new MembershipService(h.options).load()
  assert.equal(restored.authenticate(first.token), null)
  await assert.rejects(restored.passwordLogin('ana@example.com', PASSWORD, 'ip'), /invalid_credentials/)
  assert.equal((await restored.passwordLogin('ana@example.com', NEW_PASSWORD, 'ip')).account.id, first.account.id)
})

test('malformed stored hashes or registration challenges are rejected before use', async t => {
  const h = await harness(t)
  await h.signup()
  const good = structuredClone(h.store.value)
  for (const value of ['plaintext-password', 'scrypt-v1$999999999$8$1$bad$bad', null]) {
    h.store.value = structuredClone(good)
    h.store.value.accounts[0].passwordHash = value
    await assert.rejects(new MembershipService(h.options).load(), /Invalid membership storage/)
  }
  h.store.value = structuredClone(good)
  h.store.value.accounts[0].name = 'Ana\nAdmin'
  await assert.rejects(new MembershipService(h.options).load(), /Invalid membership storage/)
})

test('password KDF uses a versioned independent salt and bounds concurrent expensive work', async () => {
  const a = await hashPassword(PASSWORD), b = await hashPassword(PASSWORD)
  assert(isStoredPasswordHash(a) && isStoredPasswordHash(b))
  assert.notEqual(a, b)
  assert.equal(await verifyPassword(PASSWORD, a), true)
  assert.equal(await verifyPassword(PASSWORD + ' ', a), false, 'passwords are never silently trimmed')
  assert.equal(await verifyPassword(PASSWORD, undefined), false)
  const results = await Promise.allSettled(Array.from({ length: 11 }, () => hashPassword(PASSWORD)))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 9)
  const rejected = results.filter(result => result.status === 'rejected') as PromiseRejectedResult[]
  assert.equal(rejected.length, 2)
  assert(rejected.every(result => result.reason instanceof PasswordWorkBusy))
})
