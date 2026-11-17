import assert from 'node:assert/strict'
import { test } from 'node:test'
import { adminFetch, AdminSession, configureAdminToken } from '../src/lib/adminApi.ts'

const first = 'A'.repeat(43), second = 'B'.repeat(43)
const json = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const snapshot = { generatedAt: 123, rooms: [], summary: { onlinePlayers: 0, activeRooms: 0, waitingRooms: 0, offlineRooms: 0 } }

test('account admin always uses the current bearer and omits legacy cookies, including mutations', async () => {
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
    for (const call of calls) { assert.equal(call.credentials, 'omit'); assert.equal(call.cache, 'no-store') }
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

test('account administration never sends a master-session login or logout request', async () => {
  const release = configureAdminToken(() => first)
  let calls = 0
  try {
    for (const method of ['POST', 'DELETE']) await assert.rejects(adminFetch('/api/admin/session', { method }, async () => { calls++; return json({ ok: true }) }), /disabled/)
    assert.equal(calls, 0)
  } finally { release() }
})
