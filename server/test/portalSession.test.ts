import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import test, { type TestContext } from 'node:test'
import { io } from 'socket.io-client'
import { createGameServer } from '../src/app.js'
import { MembershipService } from '../src/membership.js'
import { PORTAL_ORIGIN, PORTAL_SESSION_COOKIE } from '../src/portalSession.js'
import { ADMIN_PROOF_COOKIE } from '../src/adminAuth.js'
import type { SnapshotStore } from '../src/storage.js'

const EMAIL = 'portal-fixture@example.test'
const TOKEN = 'A'.repeat(43), OTHER_TOKEN = 'B'.repeat(43), GAME_TOKEN = 'C'.repeat(43)
const expiry = 60 * 60_000
const DAY = 86_400_000
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const portalHeaders = { Origin: PORTAL_ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-NRN-Portal': '1' }
const gameAudiences = [
  ['conti', 'https://conti.nrnplay.com'],
  ['pocha', 'https://pocha.nrnplay.com'],
  ['football', 'https://football.nrnplay.com'],
] as const

class MemoryStore implements SnapshotStore {
  saves = 0
  constructor(private value: unknown = null) {}
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value); this.saves++ }
  async close() {}
}

async function fixture(t: TestContext) {
  const clock = { now: Date.now() }
  const account = { id: 'portal-fixture-account', email: EMAIL, name: 'Portal fixture', createdAt: clock.now }
  const sessions = [TOKEN, OTHER_TOKEN, GAME_TOKEN].map(token => ({
    accountId: account.id, tokenHash: hash(token), expiresAt: clock.now + expiry, ...(token === GAME_TOKEN ? { scope: 'game' } : {}),
  }))
  const codes = new Map<string, string>()
  const accountStore = new MemoryStore({ version: 1, accounts: [account], sessions, challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [] })
  const membership = await new MembershipService({
    store: accountStore,
    authSecret: 'synthetic-portal-session-fixture-secret-2026', adminEmails: [EMAIL], now: () => clock.now,
    sendCode: async (_email, code, _lang, purpose) => { codes.set(purpose ?? 'account', code) },
  }).load()
  const server = await createGameServer(new MemoryStore(), { membership, origins: [PORTAL_ORIGIN, ...gameAudiences.map(([, origin]) => origin)] })
  const port = await server.listen(0, '127.0.0.1')
  const base = `http://127.0.0.1:${port}`
  t.after(async () => { await server.close(); await membership.close() })
  const call = (path: string, headers: Record<string, string> = {}, body?: unknown) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  })
  const upgrade = async (token = TOKEN) => {
    const response = await call('/api/membership/session/upgrade', { ...portalHeaders, Authorization: `Bearer ${token}` }, {})
    assert.equal(response.status, 200)
    const cookie = response.headers.get('set-cookie')!
    assert(cookie.startsWith(PORTAL_SESSION_COOKIE + '='))
    for (const attribute of ['Path=/', 'HttpOnly', 'Secure', 'SameSite=Strict']) assert(cookie.includes(attribute))
    assert(!cookie.includes('Domain='))
    const result: any = await response.json()
    assert.equal(result.session, 'cookie')
    assert.equal(result.account.id, account.id)
    assert.equal(result.expiresAt, sessions[0].expiresAt)
    assert.equal(Object.hasOwn(result, 'token'), false)
    assert.match(result.sessionKey, /^[A-Za-z0-9_-]{22}$/)
    return cookie.split(';')[0]
  }
  return { account, accountStore, base, call, clock, codes, upgrade }
}

test('email-code sign-in renews an active cookie near expiry with a finite 90-day ceiling', async t => {
  const h = await fixture(t), start = h.clock.now
  assert.equal((await h.call('/api/membership/login', portalHeaders, { email: EMAIL, lang: 'es' })).status, 200)
  const proof = { email: EMAIL, code: h.codes.get('account') }
  const signedIn = await h.call('/api/membership/verify', portalHeaders, proof)
  assert.equal(signedIn.status, 200)
  const cookie = signedIn.headers.get('set-cookie')!.split(';')[0]
  const original = await signedIn.json() as { sessionKey: string; expiresAt: number }
  assert.equal(original.expiresAt, start + 30 * DAY)
  assert.equal((await h.call('/api/membership/verify', portalHeaders, proof)).status, 400, 'a used email proof cannot reopen the account')
  const headers = { ...portalHeaders, Cookie: cookie }
  const before = h.accountStore.saves
  h.clock.now = start + 5 * DAY
  const early = await h.call('/api/membership/me', headers)
  assert.equal(early.status, 200)
  assert.equal(early.headers.get('set-cookie'), null)
  assert.equal(h.accountStore.saves, before, 'ordinary account reads do not persist')
  h.clock.now = start + 25 * DAY
  const renewals = await Promise.all([h.call('/api/membership/me', headers), h.call('/api/membership/me', headers)])
  for (const response of renewals) {
    assert.equal(response.status, 200)
    const value = await response.json() as { expiresAt: number; sessionKey: string }
    assert.equal(value.expiresAt, start + 55 * DAY)
    assert.equal(value.sessionKey, original.sessionKey)
  }
  assert(renewals.some(response => response.headers.get('set-cookie')?.includes('Max-Age=2592000')))
  assert.equal(h.accountStore.saves, before + 1)
  for (const [day, expires] of [[50, 80], [75, 90]]) {
    h.clock.now = start + day * DAY
    const refreshed = await h.call('/api/membership/me', headers)
    assert.equal(refreshed.status, 200)
    assert.equal((await refreshed.json() as { expiresAt: number }).expiresAt, start + expires * DAY)
  }
  h.clock.now = start + 85 * DAY
  assert.equal((await h.call('/api/membership/me', headers)).headers.get('set-cookie'), null)
  h.clock.now = start + 90 * DAY
  assert.equal((await h.call('/api/membership/me', headers)).status, 401)
})

test('first-party sessions already present can renew while sign-out still revokes the same cookie', async t => {
  const h = await fixture(t), start = h.clock.now, cookie = await h.upgrade()
  const headers = { ...portalHeaders, Cookie: cookie }
  const migrated = await h.call('/api/membership/me', headers)
  assert.equal(migrated.status, 200)
  assert.equal((await migrated.json() as { expiresAt: number }).expiresAt, start + 30 * DAY)
  assert(migrated.headers.get('set-cookie')?.startsWith(cookie + ';'))
  assert.equal((await h.call('/api/membership/logout', headers, {})).status, 200)
  assert.equal((await h.call('/api/membership/me', headers)).status, 401)
  assert.equal((await h.call('/api/membership/me', { Authorization: `Bearer ${OTHER_TOKEN}` })).status, 200)
})

test('a linked game cookie cannot renew past its last authenticated portal grant', async t => {
  const h = await fixture(t), start = h.clock.now, [audience, origin] = gameAudiences[0]
  assert.equal((await h.call('/api/membership/login', portalHeaders, { email: EMAIL })).status, 200)
  const signedIn = await h.call('/api/membership/verify', portalHeaders, { email: EMAIL, code: h.codes.get('account') })
  assert.equal(signedIn.status, 200)
  const root = { ...portalHeaders, Cookie: signedIn.headers.get('set-cookie')!.split(';')[0] }
  const game = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-NRN-Portal': audience }
  const handoff = async (cookie?: string) => {
    const verifier = randomBytes(32).toString('base64url')
    const authorized = await h.call('/api/membership/game-authorize', root, { origin, challenge: createHash('sha256').update(verifier).digest('base64url') })
    assert.equal(authorized.status, 200)
    const exchange = await h.call('/api/membership/game-exchange', cookie ? { ...game, Cookie: cookie } : game, {
      verifier, code: (await authorized.json() as { code: string }).code,
    })
    assert.equal(exchange.status, 200)
    const session = await exchange.json() as { expiresAt: number; account: { isAdmin?: boolean } }
    assert.equal(session.account.isAdmin, undefined)
    return { expiresAt: session.expiresAt, cookie: exchange.headers.get('set-cookie')!.split(';')[0] }
  }
  const first = await handoff()
  assert.equal(first.expiresAt, start + 30 * DAY)
  const original = { ...game, Cookie: first.cookie }
  h.clock.now = start + 25 * DAY
  const resumedRoot = await h.call('/api/membership/me', root)
  assert.equal((await resumedRoot.json() as { expiresAt: number }).expiresAt, start + 55 * DAY)
  const beforeNewGrant = await h.call('/api/membership/me', original)
  assert.equal(beforeNewGrant.headers.get('set-cookie'), null)
  assert.equal((await beforeNewGrant.json() as { expiresAt: number }).expiresAt, first.expiresAt)
  const replacement = await handoff(first.cookie)
  assert.equal(replacement.expiresAt, start + 55 * DAY)
  assert.notEqual(replacement.cookie, first.cookie)
  assert.equal((await h.call('/api/membership/me', original)).status, 401)
  const renewed = { ...game, Cookie: replacement.cookie }
  h.clock.now = start + 50 * DAY
  const stillBound = await h.call('/api/membership/me', renewed)
  assert.equal((await stillBound.json() as { expiresAt: number }).expiresAt, replacement.expiresAt)
  h.clock.now = start + 55 * DAY
  assert.equal((await h.call('/api/membership/me', renewed)).status, 401)
})

test('portal upgrade rotates only the current credential and authenticates account, stats and league reads', async t => {
  const h = await fixture(t), cookie = await h.upgrade()
  const legacy = (token: string) => ({ Authorization: `Bearer ${token}` })
  const portal = { ...portalHeaders, Cookie: cookie }
  assert.equal((await h.call('/api/membership/me', legacy(TOKEN))).status, 401)
  for (const token of [OTHER_TOKEN, GAME_TOKEN]) assert.equal((await h.call('/api/membership/me', legacy(token))).status, 200)
  assert.equal((await h.call('/api/membership/me', { Cookie: cookie })).status, 401)
  assert.equal((await h.call('/api/membership/me', legacy(cookie.slice(cookie.indexOf('=') + 1)))).status, 401)
  for (const path of ['/api/membership/me', '/api/membership/stats', '/api/leagues']) {
    const response = await h.call(path, portal)
    assert.equal(response.status, 200, path)
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  const fallbackTab = await h.call('/api/membership/session/upgrade', { ...portal, ...legacy(TOKEN) }, {})
  assert.equal(fallbackTab.status, 200)
  assert.equal(fallbackTab.headers.get('set-cookie'), null)
  assert.equal((await h.call('/api/membership/me', { 'X-NRN-Portal': '1', 'Sec-Fetch-Site': 'same-origin', Cookie: cookie })).status, 200)
  assert.equal((await h.call('/api/membership/me', { 'X-NRN-Portal': '1', Cookie: cookie })).status, 403)
  assert.equal((await h.call('/api/membership/logout', { ...portal, Origin: 'https://conti.nrnplay.com', 'Sec-Fetch-Site': 'same-site' }, {})).status, 403)
  assert.equal((await h.call('/api/membership/me', portal)).status, 200)
})

test('normal portal login and device revocation return only the cookie session contract', async t => {
  const h = await fixture(t)
  assert.equal((await h.call('/api/membership/login', portalHeaders, { email: EMAIL })).status, 200)
  const verified = await h.call('/api/membership/verify', portalHeaders, { email: EMAIL, code: h.codes.get('account') })
  assert.equal(verified.status, 200)
  const body: any = await verified.json()
  assert.equal(body.session, 'cookie'); assert.equal(Object.hasOwn(body, 'token'), false)
  const cookie = verified.headers.get('set-cookie')!.split(';')[0]
  const before = await (await h.call('/api/membership/me', { ...portalHeaders, Cookie: cookie })).json() as { sessionKey: string }
  assert.equal(before.sessionKey, body.sessionKey)
  const revoke = await h.call('/api/membership/sessions/revoke-others', { ...portalHeaders, Cookie: cookie }, {})
  assert.equal(revoke.status, 200)
  const rotated: any = await revoke.json(), replacement = revoke.headers.get('set-cookie')!.split(';')[0]
  assert.equal(rotated.session, 'cookie'); assert.equal(Object.hasOwn(rotated, 'token'), false); assert.notEqual(replacement, cookie)
  assert.notEqual(rotated.sessionKey, body.sessionKey)
  assert.equal((await h.call('/api/membership/me', { ...portalHeaders, Cookie: cookie })).status, 401)
  const stillHere = await h.call('/api/membership/me', { ...portalHeaders, Cookie: replacement })
  assert.equal(stillHere.status, 200)
  assert.equal((await stillHere.json() as { sessionKey: string }).sessionKey, rotated.sessionKey)
  assert.equal((await h.call('/api/membership/me', { Authorization: `Bearer ${OTHER_TOKEN}` })).status, 401)
})

test('admin proof and socket tickets remain separate and are invalidated by portal logout', async t => {
  const h = await fixture(t), cookie = await h.upgrade()
  const portal = { ...portalHeaders, Cookie: cookie }
  assert.equal((await h.call('/api/admin/dashboard', portal)).status, 401)
  const adminWrite = { ...portal, 'X-Admin-Request': '1' }
  assert.equal((await h.call('/api/admin/session/challenge', adminWrite, { lang: 'es' })).status, 200)
  const confirmed = await h.call('/api/admin/session', adminWrite, { code: h.codes.get('admin') })
  assert.equal(confirmed.status, 200)
  const proof = confirmed.headers.get('set-cookie')!.split(';')[0]
  assert(proof.startsWith(ADMIN_PROOF_COOKIE + '='))
  const both = { ...portal, Cookie: `${cookie}; ${proof}` }
  assert.equal((await h.call('/api/admin/dashboard', both)).status, 200)

  const proofReply = await h.call('/api/membership/socket-ticket', portal, {})
  assert.equal(proofReply.status, 200)
  const ticket: any = await proofReply.json()
  assert.match(ticket.ticket, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(ticket.expiresAt, h.clock.now + 60_000)
  assert.equal((await h.call('/api/membership/me', { Authorization: `Bearer ${ticket.ticket}` })).status, 401)
  const socket = io(h.base, { autoConnect: false, reconnection: false, transports: ['websocket'],
    extraHeaders: { Origin: PORTAL_ORIGIN }, auth: { membershipTicket: ticket.ticket } })
  t.after(() => { socket.close() })
  const waiting = (signal: AbortSignal) => new Promise<any>((resolve, reject) => {
    socket.once('membership_state', resolve)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const signedIn = waiting(AbortSignal.timeout(2_000))
  socket.connect()
  assert.equal((await signedIn).account.id, h.account.id)
  const signedOut = waiting(AbortSignal.timeout(2_000))
  const logout = await h.call('/api/membership/logout', portal, {})
  assert.equal(logout.status, 200)
  assert(logout.headers.get('set-cookie')!.startsWith(`${PORTAL_SESSION_COOKIE}=;`))
  assert.equal((await signedOut).account, null)
  assert.equal((await h.call('/api/admin/dashboard', both)).status, 401)
  assert.equal((await h.call('/api/membership/me', { Authorization: `Bearer ${OTHER_TOKEN}` })).status, 200)
  socket.close()
})

test('portal and legacy game handoffs issue the destination transport without changing game scope', async t => {
  const h = await fixture(t), cookie = await h.upgrade()
  const gameOrigin = 'https://conti.nrnplay.com'
  const proof = () => {
    const verifier = randomBytes(32).toString('base64url')
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
  }
  const forGame = proof()
  const outbound = await h.call('/api/membership/game-authorize', { ...portalHeaders, Cookie: cookie }, { origin: gameOrigin, challenge: forGame.challenge })
  assert.equal(outbound.status, 200)
  const game = await h.call('/api/membership/game-exchange', { Origin: gameOrigin }, {
    code: (await outbound.json() as { code: string }).code, verifier: forGame.verifier,
  })
  assert.equal(game.status, 200)
  assert.equal(game.headers.get('set-cookie'), null)
  const gameSession: any = await game.json()
  assert.match(gameSession.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(gameSession.account.id, h.account.id)
  assert.equal(gameSession.account.isAdmin, undefined)
  const forPortal = proof()
  const inbound = await h.call('/api/membership/game-authorize', { Origin: gameOrigin, Authorization: `Bearer ${gameSession.token}` }, {
    origin: PORTAL_ORIGIN, challenge: forPortal.challenge,
  })
  assert.equal(inbound.status, 200)
  const body = { code: (await inbound.json() as { code: string }).code, verifier: forPortal.verifier }
  assert.equal((await h.call('/api/membership/game-exchange', { ...portalHeaders, Origin: gameOrigin, 'Sec-Fetch-Site': 'same-site' }, body)).status, 403)
  const returned = await h.call('/api/membership/game-exchange', portalHeaders, body)
  assert.equal(returned.status, 200)
  const returning: any = await returned.json()
  assert.equal(returning.session, 'cookie')
  assert.equal(Object.hasOwn(returning, 'token'), false)
  assert.equal(returning.account.isAdmin, undefined)
  const fresh = { ...portalHeaders, Cookie: returned.headers.get('set-cookie')!.split(';')[0] }
  assert.equal((await h.call('/api/membership/me', fresh)).status, 200)
  assert.equal((await h.call('/api/admin/dashboard', fresh)).status, 403)
})

test('portal password reset leaves only a cookie session and preserves that mode on password login', async t => {
  const h = await fixture(t), original = await h.upgrade()
  const password = 'Fixture-reset-password-2026!'
  assert.equal((await h.call('/api/membership/password-reset', portalHeaders, { email: EMAIL, lang: 'es' })).status, 200)
  const reset = await h.call('/api/membership/password-reset/confirm', portalHeaders, { email: EMAIL, code: h.codes.get('account'), password, lang: 'es' })
  assert.equal(reset.status, 200)
  for (const response of [reset, await h.call('/api/membership/password-login', portalHeaders, { email: EMAIL, password })]) {
    assert.equal(response.status, 200)
    const value: any = await response.json()
    assert.equal(value.session, 'cookie')
    assert.equal(Object.hasOwn(value, 'token'), false)
    assert.match(response.headers.get('set-cookie')!, /^__Host-nrnplay_session=/)
  }
  assert.equal((await h.call('/api/membership/me', { ...portalHeaders, Cookie: original })).status, 401)
  assert.equal((await h.call('/api/membership/me', { Authorization: `Bearer ${GAME_TOKEN}` })).status, 401)
})

test('canonical game handoffs and legacy upgrades are bound to the exact game audience', async t => {
  for (const [audience, origin] of gameAudiences) await t.test(audience, async scope => {
    const h = await fixture(scope), rootCookie = await h.upgrade()
    const game = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-NRN-Portal': audience }
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const outgoing = await h.call('/api/membership/game-authorize', { ...portalHeaders, Cookie: rootCookie }, { origin, challenge })
    assert.equal(outgoing.status, 200)
    const exchange = await h.call('/api/membership/game-exchange', game, { code: (await outgoing.json() as { code: string }).code, verifier })
    assert.equal(exchange.status, 200)
    const result: any = await exchange.json()
    assert.equal(result.session, 'cookie')
    assert.equal(Object.hasOwn(result, 'token'), false)
    assert.equal(result.account.isAdmin, undefined)
    const setter = exchange.headers.get('set-cookie')!
    assert.match(setter, /^__Host-nrnplay_session=/)
    assert(!setter.includes('Domain='))
    const auth = { ...game, Cookie: setter.split(';')[0] }
    assert.equal((await h.call('/api/membership/me', { 'X-NRN-Portal': audience, 'Sec-Fetch-Site': 'same-origin', Cookie: auth.Cookie })).status, 200)
    assert.equal((await h.call('/api/admin/dashboard', auth)).status, 403)
    const revoke = await h.call('/api/membership/sessions/revoke-others', auth, {})
    assert.equal(revoke.status, 403)
    assert.equal((await revoke.json() as { error: string }).error, 'primary_session_required')
    assert.equal((await h.call('/api/membership/logout', { 'X-NRN-Portal': audience, 'Sec-Fetch-Site': 'same-origin', Cookie: auth.Cookie }, {})).status, 403)
    assert.equal((await h.call('/api/membership/me', { ...auth, Origin: PORTAL_ORIGIN })).status, 403)
    assert.equal((await h.call('/api/membership/me', { ...portalHeaders, Cookie: auth.Cookie })).status, 401)
    assert.equal((await h.call('/api/membership/me', { ...portalHeaders, Cookie: rootCookie })).status, 200)

    // A pre-migration bearer may still be full-scope. The game upgrade
    // replaces only that session and gives the new cookie game privileges.
    const migrated = await h.call('/api/membership/session/upgrade', { ...game, Authorization: `Bearer ${OTHER_TOKEN}` }, {})
    assert.equal(migrated.status, 200)
    const migratedBody: any = await migrated.json()
    assert.equal(migratedBody.session, 'cookie')
    assert.equal(migratedBody.account.isAdmin, undefined)
    assert.equal((await h.call('/api/membership/me', { Authorization: `Bearer ${OTHER_TOKEN}` })).status, 401)
    assert.equal((await h.call('/api/membership/me', { Authorization: `Bearer ${GAME_TOKEN}` })).status, 200)
  })
})

test('a game socket ticket is accepted once on its issuing origin', async t => {
  const h = await fixture(t)
  const [audience, origin] = gameAudiences[0], [, otherOrigin] = gameAudiences[1]
  const game = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'X-NRN-Portal': audience }
  const migrated = await h.call('/api/membership/session/upgrade', { ...game, Authorization: `Bearer ${OTHER_TOKEN}` }, {})
  assert.equal(migrated.status, 200)
  const cookie = migrated.headers.get('set-cookie')!.split(';')[0]
  const ticketResponse = await h.call('/api/membership/socket-ticket', { ...game, Cookie: cookie }, {})
  assert.equal(ticketResponse.status, 200)
  const { ticket } = await ticketResponse.json() as { ticket: string }
  const handshake = async (selectedOrigin: string) => {
    const socket = io(h.base, { autoConnect: false, reconnection: false, transports: ['websocket'],
      extraHeaders: { Origin: selectedOrigin }, auth: { membershipTicket: ticket } })
    try {
      const state = new Promise<any>((resolve, reject) => {
        socket.once('membership_state', resolve)
        socket.once('connect_error', reject)
        const timeout = AbortSignal.timeout(2_000)
        timeout.addEventListener('abort', () => reject(timeout.reason), { once: true })
      })
      socket.connect()
      return await state
    } finally { socket.close() }
  }
  assert.equal((await handshake(otherOrigin)).account, null)
  assert.equal((await handshake(origin)).account.id, h.account.id)
  assert.equal((await handshake(origin)).account, null)
})
