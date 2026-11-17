import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AdminAccountsController, quickGiftCommand, readAdminAccounts } from '../src/lib/adminAccounts.ts'

const now = 1_800_000_000_000
const totals = { played: 3, wins: 1, draws: 1, losses: 1, winRate: 33.3 }
const account = { id: 'synthetic-account', name: 'Prueba', email: 'prueba@example.test', createdAt: now - 86_400_000,
  plus: { active: false, source: null, expiresAt: null }, stats: { continental: totals, pocha: totals } }
const page = (accounts: unknown[] = [account]) => ({ generatedAt: now, total: 1, filtered: 1, offset: 0, limit: 50, accounts })
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
function requests(...responses: (Response | Error | Promise<Response>)[]) {
  const calls: { url: string; init?: RequestInit }[] = []
  const request: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const response = responses.shift()
    assert.ok(response, 'Unexpected extra request')
    if (response instanceof Error) throw response
    return response
  }
  return { calls, request }
}
function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(done => { resolve = done })
  return { promise, resolve }
}

test('account reader strips private fields, rejects duplicate accounts and inconsistent statistics', () => {
  const value = readAdminAccounts(page([{ ...account, passwordHash: 'synthetic-private', token: 'synthetic-token', stats: { continental: { ...totals, private: 'hidden' }, pocha: totals } }]))
  assert.ok(value)
  assert.deepEqual(value.accounts, [account])
  assert.equal(JSON.stringify(value).includes('synthetic-private'), false)
  assert.equal(JSON.stringify(value).includes('synthetic-token'), false)
  assert.equal(readAdminAccounts({ ...page([account, account]), limit: 50 }), null)
  assert.equal(readAdminAccounts(page([{ ...account, stats: { continental: { ...totals, wins: 9 }, pocha: totals } }])), null)
})

test('quick gift uses the selected duration and rejects active permanent or yearly Plus', () => {
  const parsed = readAdminAccounts(page())!.accounts[0]!
  assert.deepEqual(quickGiftCommand(parsed, '30d', now), { email: account.email, expiresAt: now + 30 * 86_400_000 })
  assert.equal(quickGiftCommand(parsed, 'year', now).expiresAt, now + 365 * 86_400_000)
  assert.equal(quickGiftCommand(parsed, 'permanent', now).expiresAt, null)
  for (const expiresAt of [null, now + 365 * 86_400_000]) {
    assert.throws(() => quickGiftCommand({ ...parsed, plus: { active: true, source: 'gift', expiresAt } }, '30d', now), /active/)
  }
})

test('search encodes plain query text and fixed page size without URL credentials', async () => {
  const { request, calls } = requests(json(page()))
  const controller = new AdminAccountsController({ request, onSessionExpired() {} })
  const query = 'á & ? # / email@example.test'
  await controller.load(` ${query} `, 50)
  const url = new URL(calls[0]!.url, 'https://nrnplay.com')
  assert.equal(url.pathname, '/api/admin/accounts')
  assert.equal(url.searchParams.get('q'), query)
  assert.equal(url.searchParams.get('offset'), '50')
  assert.equal(url.searchParams.get('limit'), '50')
  assert.equal(calls[0]!.init?.credentials, 'same-origin')
  assert.equal(calls[0]!.init?.cache, 'no-store')
  assert.equal(new Headers(calls[0]!.init?.headers).has('Authorization'), false)
})

test('an older search cannot overwrite the current result even if fetch ignores cancellation', async () => {
  const slow = deferred(), fast = deferred()
  const { request, calls } = requests(slow.promise, fast.promise)
  const controller = new AdminAccountsController({ request, onSessionExpired() {} })
  const oldLoad = controller.load('first'), newLoad = controller.load('second')
  fast.resolve(json(page([{ ...account, name: 'Actual' }])))
  await newLoad
  slow.resolve(json(page([{ ...account, name: 'Antiguo' }])))
  await oldLoad
  assert.equal(calls[0]!.init?.signal?.aborted, true)
  assert.equal(controller.getState().data?.accounts[0]?.name, 'Actual')
})

test('confirmed gift sends one CSRF-protected POST and exactly one list GET; simultaneous submits are ignored', async () => {
  const saving = deferred()
  const gifted = { ...account, plus: { active: true, source: 'gift', expiresAt: now + 30 * 86_400_000 } }
  const { request, calls } = requests(json(page()), saving.promise, json(page([gifted])))
  let refreshed = 0
  const controller = new AdminAccountsController({ request, now: () => now, onSessionExpired() {}, onSaved() { refreshed++ } })
  await controller.load()
  const grant = controller.grant(account.id, '30d')
  assert.equal(await controller.grant(account.id, 'permanent'), false)
  assert.equal(controller.getState().saved, false)
  saving.resolve(json({ ok: true }))
  assert.equal(await grant, true)
  assert.equal(calls.length, 3)
  assert.equal(calls[1]!.url, '/api/admin/memberships/grant')
  assert.equal(calls[1]!.init?.method, 'POST')
  assert.equal(new Headers(calls[1]!.init?.headers).get('X-Admin-Request'), '1')
  assert.deepEqual(JSON.parse(calls[1]!.init?.body as string), { email: account.email, expiresAt: now + 30 * 86_400_000 })
  assert.equal(calls[2]!.init?.method, undefined)
  assert.equal(refreshed, 1)
  assert.equal(controller.getState().saved, true)
  assert.equal(controller.getState().data?.accounts[0]?.plus.active, true)
  // A newly active grant cannot be overwritten with the quick action.
  assert.equal(await controller.grant(account.id, '30d'), false)
  assert.equal(calls.length, 3)
})

test('uncertain mutation is not retried and requires a fresh list before another grant', async () => {
  const { request, calls } = requests(json(page()), new Error('Connection lost'))
  const controller = new AdminAccountsController({ request, onSessionExpired() {} })
  await controller.load()
  assert.equal(await controller.grant(account.id, '30d'), false)
  assert.equal(controller.getState().saved, false)
  assert.equal(controller.getState().error, 'save')
  assert.equal(controller.getState().data, null)
  assert.equal(await controller.grant(account.id, '30d'), false)
  assert.equal(calls.length, 2)
})

test('401 expires administration and a cancelled late search cannot reopen account data', async () => {
  const pending = deferred()
  const { request } = requests(pending.promise, json({}, 401))
  let expired = 0
  const controller = new AdminAccountsController({ request, onSessionExpired() { expired++ } })
  const late = controller.load('late')
  await controller.load('current')
  assert.equal(expired, 1)
  pending.resolve(json(page()))
  await late
  assert.equal(controller.getState().data, null)
  assert.equal(controller.getState().loading, false)
})

test('unmount/logout cancellation prevents late successful mutation from refreshing or publishing success', async () => {
  const pending = deferred()
  const { request, calls } = requests(json(page()), pending.promise)
  let saved = 0
  const controller = new AdminAccountsController({ request, onSessionExpired() {}, onSaved() { saved++ } })
  await controller.load()
  const grant = controller.grant(account.id, '30d')
  controller.cancel()
  pending.resolve(json({ ok: true }))
  assert.equal(await grant, false)
  assert.equal(saved, 0)
  assert.equal(controller.getState().saved, false)
  assert.equal(calls.length, 2)
})
