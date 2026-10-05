import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AdminSession, adminFetch, adminLoginFields } from '../src/lib/adminApi.ts'

const snapshot = { generatedAt: 123, rooms: [], summary: { onlinePlayers: 0, activeRooms: 0, waitingRooms: 0, offlineRooms: 0 } }
const json = (body: unknown = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function queue(...responses: (Response | Error | Promise<Response>)[]) {
  const calls: { url: RequestInfo | URL; init?: RequestInit }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url, init })
    const response = responses.shift()
    assert.ok(response, `Unexpected request: ${String(url)}`)
    if (response instanceof Error) throw response
    return response
  }
  return { calls, fetcher }
}

test('admin requests use same-origin cookies and mutation CSRF header, never URL credentials', async () => {
  const { fetcher, calls } = queue(json(), json(), json())
  await adminFetch('/api/admin/dashboard', {}, fetcher)
  await adminFetch('/api/admin/memberships/grant', { method: 'POST', body: JSON.stringify({ email: 'owner@example.test' }) }, fetcher)
  await adminFetch('/api/admin/session', { method: 'DELETE' }, fetcher)
  for (const { init } of calls) {
    assert.equal(init?.credentials, 'same-origin')
    assert.equal(init?.cache, 'no-store')
    assert.equal(new Headers(init?.headers).get('Authorization'), null)
  }
  assert.equal(new Headers(calls[0].init?.headers).get('X-Admin-Request'), null)
  for (const { init } of calls.slice(1)) {
    assert.equal(new Headers(init?.headers).get('X-Admin-Request'), '1')
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json')
  }
  assert.throws(() => adminFetch('https://other.example/api/admin/session', {}, fetcher))
})

test('autofill submission reads actual form values without React events and preserves spaces', () => {
  const data = new FormData()
  data.set('password', ' autofilled secret ')
  data.set('username', 'any saved username')
  data.set('remember', 'on')
  assert.deepEqual(adminLoginFields(data), { password: ' autofilled secret ', remember: true })
  data.delete('remember')
  assert.deepEqual(adminLoginFields(data), { password: ' autofilled secret ', remember: false })
})

test('initial session check has a loading state and missing cookie opens login without wrong-password error', async () => {
  const session = new AdminSession(queue(json({}, 401)).fetcher)
  assert.equal(session.getState().phase, 'checking')
  await session.refresh()
  assert.equal(session.getState().phase, 'locked')
  assert.equal(session.getState().error, null)
})

test('remembered session restores the dashboard directly', async () => {
  const { fetcher, calls } = queue(json(snapshot))
  const session = new AdminSession(fetcher)
  await session.refresh()
  assert.equal(session.getState().phase, 'unlocked')
  assert.deepEqual(session.getState().snapshot, snapshot)
  assert.equal(calls.length, 1)
})

test('offline restore remains retryable without asking for the saved password', async () => {
  const session = new AdminSession(queue(new Error('Offline'), json(snapshot)).fetcher)
  await session.refresh()
  assert.equal(session.getState().phase, 'unavailable')
  await session.refresh()
  assert.equal(session.getState().phase, 'unlocked')
})

test('invalid dashboard response stays retryable instead of showing an unusable login screen', async () => {
  const session = new AdminSession(queue(json({ ok: true }), json(snapshot)).fetcher)
  await session.refresh()
  assert.equal(session.getState().phase, 'unavailable')
  await session.refresh()
  assert.equal(session.getState().phase, 'unlocked')
})

test('login sends only form credentials and remember choice, then uses cookie for dashboard', async () => {
  const { fetcher, calls } = queue(json({}, 401), json({ ok: true }), json(snapshot))
  const session = new AdminSession(fetcher)
  await session.refresh()
  assert.equal(await session.login({ password: 'test secret', remember: false }), true)
  assert.equal(calls[1].url, '/api/admin/session')
  assert.deepEqual(JSON.parse(calls[1].init?.body as string), { password: 'test secret', remember: false })
  assert.equal(calls[2].init?.body, undefined)
  assert.equal(session.getState().phase, 'unlocked')
  assert.equal(JSON.stringify(session.getState()).includes('test secret'), false)
})

test('incorrect credentials remain on the login screen and report failure', async () => {
  const session = new AdminSession(queue(json({}, 401), json({}, 401)).fetcher)
  await session.refresh()
  assert.equal(await session.login({ password: 'wrong', remember: true }), false)
  assert.equal(session.getState().phase, 'locked')
  assert.equal(session.getState().error, 'unauthorized')
})

test('malformed successful login responses cannot confirm authentication or clear the form', async () => {
  for (const response of [new Response('<!doctype html><title>App</title>'), json({}), json({ ok: false }), json({ ok: 'true' }), json(null)]) {
    const { fetcher, calls } = queue(json({}, 401), response)
    const session = new AdminSession(fetcher)
    await session.refresh()
    assert.equal(await session.login({ password: 'test', remember: true }), false)
    assert.equal(session.getState().phase, 'locked')
    assert.equal(session.getState().error, 'unavailable')
    assert.equal(calls.length, 2)
  }
})

test('login can succeed while subsequent dashboard load is offline; cookie remains retryable', async () => {
  const session = new AdminSession(queue(json({}, 401), json({ ok: true }), new Error('Offline'), json(snapshot)).fetcher)
  await session.refresh()
  assert.equal(await session.login({ password: 'test', remember: true }), true)
  assert.equal(session.getState().phase, 'unavailable')
  await session.refresh()
  assert.equal(session.getState().phase, 'unlocked')
})

test('polling network failures retain the last snapshot; expired cookie clears it and returns login', async () => {
  const session = new AdminSession(queue(json(snapshot), new Error('Offline'), json({}, 401)).fetcher)
  await session.refresh()
  await session.refresh()
  assert.equal(session.getState().phase, 'unlocked')
  assert.deepEqual(session.getState().snapshot, snapshot)
  assert.equal(session.getState().error, 'unavailable')
  await session.refresh()
  assert.equal(session.getState().phase, 'locked')
  assert.equal(session.getState().snapshot, null)
  assert.equal(session.getState().error, 'expired')
})

test('late dashboard poll cannot reopen the dashboard after successful logout', async () => {
  let finishPoll!: (response: Response) => void
  const poll = new Promise<Response>(resolve => { finishPoll = resolve })
  const session = new AdminSession(queue(json(snapshot), poll, json({ ok: true })).fetcher)
  await session.refresh()
  const pending = session.refresh()
  await session.logout()
  finishPoll(json(snapshot))
  await pending
  assert.equal(session.getState().phase, 'locked')
  assert.equal(session.getState().snapshot, null)
  assert.equal(session.getState().error, null)
})

test('failed logout hides private data, stops polling, and offers a real cookie-clear retry', async () => {
  const { fetcher, calls } = queue(json(snapshot), new Error('Offline'), json({ ok: true }))
  const session = new AdminSession(fetcher)
  await session.refresh()
  await session.logout()
  assert.equal(session.getState().phase, 'logout-error')
  assert.equal(session.getState().snapshot, null)
  await session.refresh()
  assert.equal(calls.length, 2)
  await session.logout()
  assert.equal(session.getState().phase, 'locked')
  assert.equal(calls[2].init?.method, 'DELETE')
})

test('malformed successful logout responses retain a retry until the server confirms cookie removal', async () => {
  for (const response of [new Response('<!doctype html><title>App</title>'), json({}), json({ ok: false }), json({ ok: 'true' }), json(null)]) {
    const { fetcher, calls } = queue(json(snapshot), response, json({ ok: true }))
    const session = new AdminSession(fetcher)
    await session.refresh()
    await session.logout()
    assert.equal(session.getState().phase, 'logout-error')
    assert.equal(session.getState().snapshot, null)
    await session.refresh()
    assert.equal(calls.length, 2)
    await session.logout()
    assert.equal(session.getState().phase, 'locked')
    assert.equal(calls[2].init?.method, 'DELETE')
  }
})

test('late membership expiry cannot interrupt an in-flight cookie-clear request', async () => {
  let finishLogout!: (response: Response) => void
  const logout = new Promise<Response>(resolve => { finishLogout = resolve })
  const session = new AdminSession(queue(json(snapshot), logout).fetcher)
  await session.refresh()
  const pending = session.logout()
  session.expire()
  assert.equal(session.getState().phase, 'logging-out')
  finishLogout(json({}, 503))
  await pending
  assert.equal(session.getState().phase, 'logout-error')
})

test('session expiration from another admin panel cancels pending dashboard responses', async () => {
  let finishPoll!: (response: Response) => void
  const poll = new Promise<Response>(resolve => { finishPoll = resolve })
  const session = new AdminSession(queue(json(snapshot), poll).fetcher)
  await session.refresh()
  const pending = session.refresh()
  session.expire()
  finishPoll(json(snapshot))
  await pending
  assert.equal(session.getState().phase, 'locked')
  assert.equal(session.getState().snapshot, null)
  assert.equal(session.getState().error, 'expired')
})
