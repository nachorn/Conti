import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adminFetch, AdminSession, configureAdminToken } from '../src/lib/adminApi.ts'

const first = 'A'.repeat(43), second = 'B'.repeat(43)
const json = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const snapshot = { generatedAt: 123, rooms: [], summary: { onlinePlayers: 0, activeRooms: 0, waitingRooms: 0, offlineRooms: 0 } }

test('account admin sends the current bearer and same-origin browser proof for reads and mutations', async () => {
  let token: string | null = first
  const calls: RequestInit[] = []
  const request: typeof fetch = async (_path, init) => { calls.push(init!); return json() }
  const release = configureAdminToken(() => token)
  try {
    await adminFetch('/api/admin/accounts', { headers: { Authorization: 'stale-value' } }, request)
    token = second
    await adminFetch('/api/admin/memberships/grant', { method: 'POST', body: '{}' }, request)
    assert.equal(calls.length, 2)
    assert.equal(new Headers(calls[0]!.headers).get('Authorization'), `Bearer ${first}`)
    assert.equal(new Headers(calls[1]!.headers).get('Authorization'), `Bearer ${second}`)
    assert.equal(new Headers(calls[1]!.headers).get('X-Admin-Request'), '1')
    for (const call of calls) { assert.equal(call.credentials, 'same-origin'); assert.equal(call.cache, 'no-store') }
    token = null
    await assert.rejects(adminFetch('/api/admin/accounts', {}, request), /authorization required/)
    assert.equal(calls.length, 2)
  } finally { release() }
  await assert.rejects(adminFetch('/api/admin/accounts', {}, request), /authorization required/)
  assert.equal(calls.length, 2)
})

test('a scope change aborts old requests and a late old-account response cannot restore dashboard data', async () => {
  let resolve!: (response: Response) => void
  const pending = new Promise<Response>(done => { resolve = done })
  let oldSignal: AbortSignal | undefined
  const request: typeof fetch = async (_path, init) => { oldSignal = init?.signal as AbortSignal; return pending }
  const release = configureAdminToken(() => first)
  const session = new AdminSession(request)
  const load = session.refresh()
  const releaseNext = configureAdminToken(() => second)
  release()
  assert.equal(oldSignal?.aborted, true)
  resolve(json(snapshot))
  await load
  assert.equal(session.getState().snapshot, null)
  releaseNext()
})

test('read 401 or 403 invalidates once, aborts sibling requests and prevents cookie fallback', async () => {
  for (const status of [401, 403]) {
    let invalidated = 0, siblingSignal: AbortSignal | undefined, resolve!: (response: Response) => void
    const pending = new Promise<Response>(done => { resolve = done })
    const release = configureAdminToken(() => first, () => { invalidated++ })
    const sibling = adminFetch('/api/admin/overview', {}, async (_url, init) => { siblingSignal = init?.signal as AbortSignal; return pending })
    await adminFetch('/api/admin/accounts', {}, async () => json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, status))
    assert.equal(invalidated, 1)
    assert.equal(siblingSignal?.aborted, true)
    resolve(json(snapshot))
    await assert.rejects(sibling, /authorization changed/)
    await assert.rejects(adminFetch('/api/admin/accounts', {}, async () => { throw new Error('Must not fetch') }), /authorization required/)
    release()
  }
})

test('a 403 CSRF write error remains an action error; a forbidden role write clears access', async () => {
  let invalidated = 0
  const release = configureAdminToken(() => first, () => { invalidated++ })
  try {
    const response = await adminFetch('/api/admin/memberships/grant', { method: 'POST', body: '{}' }, async () => json({ error: 'invalid_request' }, 403))
    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: 'invalid_request' })
    assert.equal(invalidated, 0)
    await adminFetch('/api/admin/memberships/grant', { method: 'POST', body: '{}' }, async () => json({ error: 'forbidden' }, 403))
    assert.equal(invalidated, 1)
  } finally { release() }
})

test('expired admin proof keeps the ordinary session and can request, confirm and revoke a second step', async () => {
  let invalidated = 0, proofNeeded = 0
  const release = configureAdminToken(() => first, () => { invalidated++ }, () => { proofNeeded++ })
  const requests: Array<{ path: string; method?: string; body?: unknown }> = []
  let open = false
  const session = new AdminSession(async (url, init) => {
    const path = String(url), method = init?.method
    requests.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path === '/api/admin/dashboard') return open ? json(snapshot) : json({ error: 'verification_required' }, 401)
    if (path === '/api/admin/session/challenge') return json({ ok: true })
    if (path === '/api/admin/session') { open = method !== 'DELETE'; return json({ ok: true }) }
    throw new Error('Unexpected request')
  })
  try {
    await session.refresh()
    assert.equal(session.getState().phase, 'locked')
    assert.equal(proofNeeded, 1)
    assert.equal(invalidated, 0)
    assert.equal(await session.sendCode('es'), true)
    assert.equal(session.getState().codeSent, true)
    assert.equal(await session.verifyCode('012345'), true)
    assert.equal(session.getState().phase, 'unlocked')
    await session.logout()
    assert.equal(session.getState().phase, 'locked')
    assert.equal(session.getState().codeSent, false)
    assert.deepEqual(requests[1], { path: '/api/admin/session/challenge', method: 'POST', body: { lang: 'es' } })
    assert.deepEqual(requests[2], { path: '/api/admin/session', method: 'POST', body: { code: '012345' } })
    assert.equal(requests.at(-1)?.method, 'DELETE')
    assert.equal(invalidated, 0)
  } finally { release() }
})
