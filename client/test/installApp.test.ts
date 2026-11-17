import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

async function worker() {
  const listeners = new Map<string, (event: any) => void>()
  const precached: string[][] = []
  const code = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
  vm.runInNewContext(code, {
    URL, Response,
    self: { location: { origin: 'https://nrnplay.com' }, addEventListener: (name: string, fn: (event: any) => void) => listeners.set(name, fn) },
    caches: { open: async () => ({ addAll: async (urls: string[]) => { precached.push(urls) } }), keys: async () => [], match: async () => new Response('public offline notice') },
    fetch: async () => { throw new Error('offline') },
  })
  return { listeners, precached }
}

test('install cache contains only the public offline notice and its presentation', async () => {
  const { listeners, precached } = await worker()
  let pending: Promise<void> | undefined
  listeners.get('install')!({ waitUntil: (value: Promise<void>) => { pending = value } })
  await pending
  assert.equal(JSON.stringify(precached), JSON.stringify([['/offline.html', '/offline.css', '/brand/nrn-play-selected-mark.svg']]))
})

test('worker never intercepts identity, API, handoff, admin, cross-origin or non-GET requests', async () => {
  const { listeners } = await worker()
  for (const [path, method, mode] of [
    ['/api/membership/me', 'GET', 'cors'], ['/api/membership/plus/checkout', 'POST', 'cors'],
    ['/connect?code=private', 'GET', 'navigate'], ['/dashboard', 'GET', 'navigate'],
    ['/admin', 'GET', 'navigate'], ['/admin/users', 'GET', 'navigate'], ['/api/admin/accounts', 'GET', 'navigate'],
    ['https://conti-server.onrender.com/socket.io/', 'GET', 'cors'], ['/assets/main-hash.js', 'GET', 'cors'],
  ]) {
    let intercepted = false
    listeners.get('fetch')!({ request: { url: new URL(path, 'https://nrnplay.com').href, method, mode }, respondWith: () => { intercepted = true } })
    assert.equal(intercepted, false, path)
  }
})

test('offline room navigation returns a public notice without caching the room or invitation', async () => {
  const { listeners } = await worker()
  let response: Promise<Response> | undefined
  listeners.get('fetch')!({ request: { url: 'https://nrnplay.com/room/1234?invite=private', method: 'GET', mode: 'navigate' }, respondWith: (value: Promise<Response>) => { response = value } })
  assert.equal(await (await response!).text(), 'public offline notice')
})
