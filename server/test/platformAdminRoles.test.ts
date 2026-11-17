import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import test, { type TestContext } from 'node:test'
import { MembershipService, adminEmailsFromEnvironment, createMembershipService } from '../src/membership.js'
import { createGameServer } from '../src/app.js'
import type { SnapshotStore } from '../src/storage.js'

const KEY = 'synthetic-admin-master-for-role-tests-2026'
const ORIGIN = 'https://portal.example.test'
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
    sessions: TOKENS.map((token, i) => ({ accountId: `role-account-${i}`, tokenHash: digest(token), expiresAt: now + 60_000 })),
    challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [], bmcSubscriptions: [], plusAudit: [] }
}
async function harness(t: TestContext, options: { roles?: readonly string[] | null } = {}) {
  const clock = { now: Date.now() }, membershipStore = new MemoryStore(fixture(clock.now)), gameStore = new MemoryStore()
  const membership = await new MembershipService({ store: membershipStore, authSecret: 'synthetic-membership-role-secret-2026', dashboardKey: KEY,
    adminEmails: options.roles === null ? undefined : options.roles ?? EMAILS.slice(0, 2).map(email => ` ${email.toUpperCase()} `), now: () => clock.now }).load()
  const server = await createGameServer(gameStore, { dashboardKey: KEY, membership, origins: [ORIGIN],
    footballAdmin: { read: async () => ({ available: false, stale: false, report: null }) } })
  const port = await server.listen(0, '127.0.0.1'), base = `http://127.0.0.1:${port}`
  t.after(async () => { await server.close(); await membership.close() })
  const call = (path: string, options: RequestInit = {}) => fetch(base + path, { redirect: 'error', ...options })
  const read = (path: string, token = TOKENS[0]) => call(path, { headers: { Authorization: `Bearer ${token}` } })
  const write = (path: string, body: unknown, token = TOKENS[0], extra: Record<string, string> = {}) => call(path, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Admin-Request': '1', Origin: ORIGIN, ...extra }, body: JSON.stringify(body) })
  return { call, read, write, membership, membershipStore, gameStore, server, clock }
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
  const listed: any = await (await h.read('/api/admin/accounts')).json()
  assert(listed.accounts.every((account: any) => !Object.hasOwn(account, 'isAdmin')), 'Role details are only for the authenticated account')
  assert.equal((await h.call('/api/membership/me')).status, 401)
})

test('every existing and new admin API rejects guests, ordinary users, forged flags and the master Bearer in account-only mode', async t => {
  const h = await harness(t)
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
  assert.equal(authorized.status, 200); assert.equal(authorized.headers.get('set-cookie'), null, 'No master-key cookie is issued in role mode')
  const clear = await h.call('/api/admin/session', { method: 'DELETE', headers: { Authorization: `Bearer ${TOKENS[0]}`, 'X-Admin-Request': '1', Origin: ORIGIN } })
  assert.equal(clear.status, 200)
  assert.equal((await h.read('/api/membership/me')).status, 200, 'Admin-cookie cleanup cannot log out the account')
})

test('role-authorized Plus changes require CSRF headers and a trusted origin', async t => {
  const h = await harness(t), body = JSON.stringify({ email: EMAILS[2], expiresAt: null })
  const post = (headers: Record<string, string>) => h.call('/api/admin/memberships/grant', { method: 'POST', headers: { Authorization: `Bearer ${TOKENS[0]}`, 'Content-Type': 'application/json', ...headers }, body })
  assert.equal((await post({})).status, 403)
  assert.equal((await post({ 'X-Admin-Request': '1', Origin: 'https://attacker.example.test' })).status, 403)
  assert.equal((await post({ 'X-Admin-Request': '1', Origin: ORIGIN })).status, 200)
  assert.equal(h.membership.authenticate(TOKENS[2])!.adFree, true)
  assert.equal(h.membership.authenticate(TOKENS[2])!.isAdmin, undefined, 'Plus does not grant administration')
})

test('revocation and expiry are enforced per request; storage failures return 503 before role rejection', async t => {
  const down = await harness(t)
  down.membershipStore.healthy = false
  for (const path of READS) assert.equal((await down.read(path, TOKENS[2])).status, 503, path)
  for (const [path, body] of WRITES) assert.equal((await down.write(path, body, TOKENS[2])).status, 503, path)
  const h = await harness(t)
  assert.equal((await h.call('/api/membership/logout', { method: 'POST', headers: { Authorization: `Bearer ${TOKENS[0]}` } })).status, 200)
  for (const path of READS) assert.equal((await h.read(path)).status, 401, path)
  h.clock.now += 60_000
  for (const path of READS) assert.equal((await h.read(path, TOKENS[1])).status, 401, path)
  assert.equal(h.membership.authenticate(TOKENS[1]), null)
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
