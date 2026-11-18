import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test, { type TestContext } from 'node:test'
import { MembershipService, adminEmailsFromEnvironment, createMembershipService } from '../src/membership.js'
import { createGameServer } from '../src/app.js'
import type { SnapshotStore } from '../src/storage.js'
import { ADMIN_PROOF_COOKIE } from '../src/adminAuth.js'
import { ADMIN_PROOF_SESSION_MS } from '../src/adminStepUp.js'
import type { ManualPlusAudit } from '../../shared/plusAdminAudit.js'

const KEY = 'synthetic-admin-master-for-role-tests-2026'
const ORIGIN = 'https://nrnplay.com'
const EMAILS = ['owner-a@example.test', 'owner-b@example.test', 'ordinary@example.test']
const TOKENS = ['A'.repeat(43), 'B'.repeat(43), 'C'.repeat(43)]
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
class MemoryStore implements SnapshotStore {
  healthy = true
  constructor(public value: any = null) {}
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value) }
  async close() {}
  isHealthy() { return this.healthy }
}
function fixture(now: number) {
  return { version: 1, accounts: EMAILS.map((email, i) => ({ id: `role-account-${i}`, email, name: `Synthetic ${i + 1}`, createdAt: now - 1000 })),
    sessions: TOKENS.map((token, i) => ({ accountId: `role-account-${i}`, tokenHash: digest(token), expiresAt: now + 60 * 60_000 })),
    challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [], bmcSubscriptions: [], plusAudit: [] }
}
async function harness(t: TestContext, options: { roles?: readonly string[] | null } = {}) {
  const clock = { now: Date.now() }, membershipStore = new MemoryStore(fixture(clock.now)), gameStore = new MemoryStore()
  const inbox = new Map<string, { code: string; purpose?: 'admin' }>(), cookies = new Map<string, string>()
  const membership = await new MembershipService({ store: membershipStore, authSecret: 'synthetic-membership-role-secret-2026', dashboardKey: KEY,
    sendCode: async (email, code, _lang, purpose) => { inbox.set(email, { code, purpose }) },
    adminEmails: options.roles === null ? undefined : options.roles ?? EMAILS.slice(0, 2).map(email => ` ${email.toUpperCase()} `), now: () => clock.now }).load()
  const server = await createGameServer(gameStore, { dashboardKey: KEY, membership, origins: [ORIGIN],
    footballAdmin: { read: async () => ({ available: false, stale: false, report: null }) } })
  const port = await server.listen(0, '127.0.0.1'), base = `http://127.0.0.1:${port}`
  t.after(async () => { await server.close(); await membership.close() })
  const call = (path: string, options: RequestInit = {}) => fetch(base + path, { redirect: 'error', ...options })
  const read = (path: string, token = TOKENS[0]) => call(path, { headers: { Authorization: `Bearer ${token}`, Cookie: cookies.get(token) ?? '' } })
  const write = (path: string, body: unknown, token = TOKENS[0], extra: Record<string, string> = {}) => call(path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Cookie: cookies.get(token) ?? '', 'Content-Type': 'application/json', 'X-Admin-Request': '1', Origin: ORIGIN, ...extra }, body: JSON.stringify(body) })
  const unlock = async (index = 0) => {
    const token = TOKENS[index]
    assert.equal((await write('/api/admin/session/challenge', { lang: 'es' }, token)).status, 200)
    const email = inbox.get(EMAILS[index])
    assert(email && email.purpose === 'admin')
    const proof = await write('/api/admin/session', { code: email.code }, token)
    assert.equal(proof.status, 200)
    const rawCookie = proof.headers.get('set-cookie')!
    assert(rawCookie.startsWith(ADMIN_PROOF_COOKIE + '='))
    for (const attribute of ['Max-Age=1800', 'Path=/api/admin', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert(rawCookie.includes(attribute))
    assert(!rawCookie.includes('Domain='))
    const cookie = rawCookie.split(';')[0]
    cookies.set(token, cookie)
    return cookie
  }
  return { call, read, write, unlock, inbox, membership, membershipStore, gameStore, server, clock }
}
const READS = ['/api/admin/dashboard', '/api/admin/operations', '/api/admin/overview', '/api/admin/accounts', '/api/admin/memberships', '/api/admin/plus/readiness', '/api/admin/plus/subscriptions']
const WRITES = [
  ['/api/admin/memberships/grant', { email: EMAILS[2], expiresAt: null }],
  ['/api/admin/memberships/revoke', { email: EMAILS[2] }],
  ['/api/admin/plus/revoke', { subscriptionId: '1', reason: 'synthetic' }],
  ['/api/admin/plus/giveaways/import', { event: {}, reason: 'synthetic' }],
  ['/api/admin/rooms/cleanup', { rooms: [] }],
  ['/api/admin/rooms/1234/test-bot', {}],
] as const

test('only verified allowlisted accounts receive isAdmin, and configuration never lists roles or emails', async t => {
  const h = await harness(t)
  for (let i = 0; i < 3; i++) {
    const response = await h.read('/api/membership/me', TOKENS[i]); assert.equal(response.status, 200)
    const body: any = await response.json()
    assert.equal(body.account.isAdmin, i < 2 ? true : undefined)
    if (i === 2) assert(!Object.hasOwn(body.account, 'isAdmin'))
  }
  const config: any = await (await h.call('/api/membership/config')).json()
  const encoded = JSON.stringify(config)
  assert(!encoded.includes('isAdmin')); assert(!encoded.includes('adminEmails')); assert(!encoded.includes('ADMIN_ACCOUNT_EMAILS'))
  for (const email of EMAILS) assert(!encoded.includes(email))
  await h.unlock()
  const listed: any = await (await h.read('/api/admin/accounts')).json()
  assert(listed.accounts.every((account: any) => !Object.hasOwn(account, 'isAdmin')), 'Role details are only for the authenticated account')
  assert.equal((await h.call('/api/membership/me')).status, 401)
})

test('every existing and new admin API rejects guests, ordinary users, forged flags and the master Bearer in account-only mode', async t => {
  const h = await harness(t)
  for (const path of READS) {
    const normalSession = await h.read(path)
    assert.equal(normalSession.status, 401)
    assert.deepEqual(await normalSession.json(), { error: 'verification_required' })
  }
  const adminCookie = await h.unlock()
  await h.unlock(1)
  assert.equal((await h.call('/api/admin/dashboard', { headers: { Cookie: adminCookie } })).status, 401, 'Cookie still requires its account session')
  assert.equal((await h.call('/api/admin/dashboard', { headers: { Cookie: adminCookie, Authorization: `Bearer ${TOKENS[1]}` } })).status, 401, 'A proof cannot change accounts')
  for (const path of READS) {
    assert.equal((await h.read(path)).status, 200, path)
    assert.equal((await h.read(path, TOKENS[1])).status, 200, 'Second normalized allowlisted account is also an admin')
    for (const [headers, expected] of [[{}, 401], [{ Authorization: `Bearer ${TOKENS[2]}` }, 403], [{ Authorization: `Bearer ${KEY}` }, 401],
      [{ Authorization: 'Bearer eyJpc0FkbWluIjp0cnVlfQ.fake.signature', 'X-Is-Admin': 'true' }, 401]] as const) {
      const response = await h.call(path, { headers: headers as Record<string, string> }); assert.equal(response.status, expected, path)
      const body: any = await response.json(); assert.deepEqual(body, { error: expected === 401 ? 'unauthorized' : 'forbidden' })
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  }
  for (const [path, body] of WRITES) {
    assert.equal((await h.write(path, body, TOKENS[2])).status, 403, path)
    assert.equal((await h.write(path, body, KEY)).status, 401, path)
  }
})

test('legacy master cookies and password login cannot bypass roles; clearing old cookies does not revoke account sessions', async t => {
  const legacy = await harness(t, { roles: null }), h = await harness(t)
  const logged = await legacy.write('/api/admin/session', { password: KEY, remember: true }, KEY)
  assert.equal(logged.status, 200)
  const cookie = logged.headers.get('set-cookie')!.split(';')[0]
  assert.equal((await legacy.call('/api/admin/dashboard', { headers: { Cookie: cookie } })).status, 200)
  for (const path of READS) assert.equal((await h.call(path, { headers: { Cookie: cookie } })).status, 401)
  for (const token of [KEY, TOKENS[2]]) {
    const response = await h.write('/api/admin/session', { password: KEY, remember: true }, token)
    assert.equal(response.status, token === KEY ? 401 : 403); assert.equal(response.headers.get('set-cookie'), null)
  }
  const authorized = await h.write('/api/admin/session', { password: KEY, remember: true })
  assert.equal(authorized.status, 400); assert.equal(authorized.headers.get('set-cookie'), null, 'No master-key cookie is issued in role mode')
  const proof = await h.unlock()
  const clear = await h.call('/api/admin/session', { method: 'DELETE', headers: { Authorization: `Bearer ${TOKENS[0]}`, Cookie: proof, 'X-Admin-Request': '1', Origin: ORIGIN } })
  assert.equal(clear.status, 200)
  assert.equal((await h.read('/api/admin/dashboard')).status, 401, 'The previous proof was revoked on the server')
  assert.equal((await h.read('/api/membership/me')).status, 200, 'Admin-cookie cleanup cannot log out the account')
})

test('role-authorized Plus changes require CSRF headers and a trusted origin', async t => {
  const h = await harness(t), body = JSON.stringify({ email: EMAILS[2], expiresAt: null })
  const cookie = await h.unlock()
  const post = (headers: Record<string, string>) => h.call('/api/admin/memberships/grant', { method: 'POST', headers: { Authorization: `Bearer ${TOKENS[0]}`, Cookie: cookie, 'Content-Type': 'application/json', ...headers }, body })
  assert.equal((await post({})).status, 403)
  assert.equal((await post({ 'X-Admin-Request': '1', Origin: 'https://attacker.example.test' })).status, 403)
  assert.equal((await post({ 'X-Admin-Request': '1', Origin: 'https://conti.nrnplay.com', 'Sec-Fetch-Site': 'same-site' })).status, 403)
  assert.equal((await post({ 'X-Admin-Request': '1', Origin: ORIGIN })).status, 200)
  assert.equal(h.membership.authenticate(TOKENS[2])!.adFree, true)
  assert.equal(h.membership.authenticate(TOKENS[2])!.isAdmin, undefined, 'Plus does not grant administration')
})

test('verified admin gift changes retain the actor and before/after state in the same durable snapshot', async t => {
  const h = await harness(t)
  await h.unlock()
  await h.unlock(1)
  const expiry = h.clock.now + 60_000
  const gift = { email: EMAILS[2], expiresAt: expiry }
  const grant = () => h.write('/api/admin/memberships/grant', gift)
  assert.equal((await grant()).status, 200)
  assert.equal((await grant()).status, 200)
  h.clock.now += 1_000
  const revoke = () => h.write('/api/admin/memberships/revoke', { email: EMAILS[2] }, TOKENS[1])
  assert.equal((await revoke()).status, 200)
  assert.equal((await revoke()).status, 200)
  assert.equal(h.membership.authenticate(TOKENS[2])?.adFree, false)

  const response = await h.read('/api/admin/plus/subscriptions', TOKENS[1])
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const { manualAudit } = await response.json() as { manualAudit: ManualPlusAudit[] }
  assert.equal(manualAudit.length, 2)
  assert.deepEqual(manualAudit.map(({ id, ...entry }) => entry), [
    { at: h.clock.now - 1_000, action: 'gift_granted', email: EMAILS[2], actorEmail: EMAILS[0], subscriptionId: null, reason: null,
      before: null, after: { active: true, expiresAt: expiry } },
    { at: h.clock.now, action: 'gift_revoked', email: EMAILS[2], actorEmail: EMAILS[1], subscriptionId: null, reason: null,
      before: { active: true, expiresAt: expiry }, after: { active: false, expiresAt: expiry } },
  ])
  assert.deepEqual(h.membershipStore.value.manualPlusAudit.map((entry: { actorAccountId: string }) => entry.actorAccountId), ['role-account-0', 'role-account-1'])
  assert.equal(h.membershipStore.value.grants[0].active, false)
  const saved = structuredClone(h.membershipStore.value)
  const restarted = await new MembershipService({ store: new MemoryStore(saved), authSecret: 'synthetic-reload-role-secret-2026' }).load()
  assert.equal(restarted.authenticate(TOKENS[2])?.adFree, false)
  await restarted.close()
})

test('revocation and expiry are enforced per request; storage failures return 503 before role rejection', async t => {
  const down = await harness(t)
  down.membershipStore.healthy = false
  for (const path of READS) assert.equal((await down.read(path, TOKENS[2])).status, 503, path)
  for (const [path, body] of WRITES) assert.equal((await down.write(path, body, TOKENS[2])).status, 503, path)
  const h = await harness(t)
  await h.unlock()
  await h.unlock(1)
  assert.equal((await h.call('/api/membership/logout', { method: 'POST', headers: { Authorization: `Bearer ${TOKENS[0]}` } })).status, 200)
  for (const path of READS) assert.equal((await h.read(path)).status, 401, path)
  h.clock.now += ADMIN_PROOF_SESSION_MS
  for (const path of READS) assert.equal((await h.read(path, TOKENS[1])).status, 401, path)
  assert(h.membership.authenticate(TOKENS[1]), 'Admin expiry leaves the normal account session active')
  h.clock.now += 30 * 60_000
  for (const path of READS) assert.equal((await h.read(path, TOKENS[1])).status, 401, path)
  assert.equal(h.membership.authenticate(TOKENS[1]), null)
})

test('ordinary and game sessions cannot request admin email and issued codes are single-use', async t => {
  const h = await harness(t), linked = await h.membership.linkedSession(TOKENS[0])
  assert.equal(linked.account.isAdmin, undefined)
  for (const token of [TOKENS[2], linked.token]) {
    assert.equal((await h.write('/api/admin/session/challenge', { lang: 'en' }, token)).status, 403)
  }
  assert.equal(h.inbox.size, 0)
  assert.equal((await h.write('/api/admin/session/challenge', { lang: 'en' }, TOKENS[0], { Origin: 'https://pocha.nrnplay.com' })).status, 403)
  await h.unlock()
  const code = h.inbox.get(EMAILS[0])!.code
  assert.equal((await h.write('/api/admin/session', { code })).status, 400)
  assert.equal((await h.write('/api/admin/session/challenge', { lang: 'en' })).status, 429)
})

test('an explicitly empty role allowlist fails closed instead of enabling the old master key', async t => {
  const h = await harness(t, { roles: [] })
  assert(h.membership.adminAccountVerifier())
  assert.equal((await h.read('/api/admin/accounts')).status, 403)
  assert.equal((await h.read('/api/admin/accounts', KEY)).status, 401)
})

test('an allowlisted email challenge confers no account role until email verification succeeds', async () => {
  const store = new MemoryStore(), inbox = new Map<string, string>()
  const membership = await new MembershipService({ store, authSecret: 'synthetic-email-proof-admin-secret-2026', adminEmails: [EMAILS[0].toUpperCase()],
    sendCode: async (email, code) => { inbox.set(email, code) } }).load()
  try {
    await membership.requestCode(EMAILS[0], 'en', 'synthetic-peer')
    assert.equal(membership.getAdminAccountSummary().total, 0)
    assert.equal(membership.authenticate(TOKENS[0]), null)
    const code = inbox.get(EMAILS[0])!
    await assert.rejects(() => membership.verifyCode(EMAILS[0], code === '000000' ? '999999' : '000000', 'synthetic-peer'), /invalid_code/)
    assert.equal(membership.getAdminAccountSummary().total, 0)
    const verified = await membership.verifyCode(EMAILS[0], code, 'synthetic-peer')
    assert.equal(verified.account.isAdmin, true)
    assert.equal(membership.authenticate(verified.token)?.isAdmin, true)
  } finally { await membership.close() }
})

test('environment parsing normalizes CSV case and factory loads the role policy without creating accounts or exposing it publicly', async () => {
  const expected = EMAILS.slice(0, 2)
  assert.deepEqual(adminEmailsFromEnvironment({ ADMIN_ACCOUNT_EMAILS: ` ${expected[0].toUpperCase()} , ${expected[1]} , ${expected[0]} ` }), expected)
  assert.equal(adminEmailsFromEnvironment({}), undefined)
  assert.deepEqual(adminEmailsFromEnvironment({ ADMIN_ACCOUNT_EMAILS: ' , ' }), [])
  assert.throws(() => adminEmailsFromEnvironment({ ADMIN_ACCOUNT_EMAILS: 'not-an-email' }), /valid account email/)
  await assert.rejects(() => createMembershipService({ ADMIN_ACCOUNT_EMAILS: expected.join(',') }), /Enable accounts/)
  const directory = await mkdtemp(join(tmpdir(), 'nrn-admin-roles-')), path = join(directory, 'memberships.json')
  let membership: MembershipService | undefined
  try {
    await writeFile(path, JSON.stringify(fixture(Date.now())), { mode: 0o600 })
    membership = await createMembershipService({ MEMBERSHIP_ENABLED: 'true', MEMBERSHIP_AUTH_SECRET: 'synthetic-membership-factory-secret-2026',
      ADMIN_DASHBOARD_KEY: KEY, ADMIN_ACCOUNT_EMAILS: expected.map(email => email.toUpperCase()).join(','), MEMBERSHIP_STATE_PATH: path })
    assert(membership)
    for (let i = 0; i < 3; i++) assert.equal(membership.authenticate(TOKENS[i])?.isAdmin, i < 2 ? true : undefined)
    assert.equal(membership.listAdminAccounts().total, 3)
  } finally {
    await membership?.close()
    const absolute = resolve(directory)
    assert(dirname(absolute) === resolve(tmpdir()) && basename(absolute).startsWith('nrn-admin-roles-'))
    await rm(absolute, { recursive: true, force: true })
  }
})
