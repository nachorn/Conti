import assert from 'node:assert/strict'
import { createHash, createHmac, randomBytes, scrypt } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { connect } from 'node:net'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import test, { type TestContext } from 'node:test'
import { createPasswordWorkClient, createPasswordWorkHandler, derivePasswordWorkerSigningKey, PASSWORD_WORK_PATH, PasswordWorkerUnavailable, type PasswordWorkHandler } from '../src/passwordWorker.js'

const SECRET = 'local-test-worker-secret-not-a-real-credential'
const PASSWORD = 'test-only phrase for password worker'
const SALT = Buffer.alloc(16, 7)
const CONTEXT = 'nrnplay:password-worker:v1'
const sha = (body: Buffer) => createHash('sha256').update(body).digest('hex')
const signingKey = createHmac('sha256', SECRET).update(CONTEXT).digest()
function signed(body: Buffer, now = Date.now(), nonce = randomBytes(16).toString('base64url')) {
  const timestamp = String(now)
  return { 'content-type': 'application/json', 'content-length': String(body.length), 'x-nrn-password-timestamp': timestamp,
    'x-nrn-password-nonce': nonce, 'x-nrn-password-signature': createHmac('sha256', signingKey)
      .update(`${timestamp}\n${nonce}\nPOST\n${PASSWORD_WORK_PATH}\n${sha(body)}`).digest('base64url') }
}
const payload = () => Buffer.from(JSON.stringify({ password: PASSWORD, salt: SALT.toString('base64url') }))
class ResponseFixture extends EventEmitter {
  statusCode = 200
  destroyed = false
  writableEnded = false
  body = Buffer.alloc(0)
  headers = new Map<string, unknown>()
  complete!: () => void
  done = new Promise<void>(resolve => { this.complete = resolve })
  setHeader(name: string, value: unknown) { this.headers.set(name.toLowerCase(), value) }
  end(body: Buffer) { this.body = Buffer.from(body); this.writableEnded = true; this.complete(); this.emit('close') }
}
function invoke(handler: PasswordWorkHandler, body = payload(), options: { headers?: Record<string, string>; method?: string; path?: string } = {}) {
  const req = new EventEmitter() as EventEmitter & Record<string, any>
  req.url = options.path ?? PASSWORD_WORK_PATH; req.method = options.method ?? 'POST'; req.headers = options.headers ?? signed(body)
  req.resume = () => {}; req.destroy = () => { req.emit('aborted') }
  const res = new ResponseFixture()
  const handled = handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
  if (handled) queueMicrotask(() => { req.emit('data', Buffer.from(body)); req.emit('end') })
  return { req, res, handled, done: res.done.then(() => res) }
}
async function worker(t: TestContext, credentials: { authSecret?: string; signingKey?: string } = { authSecret: SECRET }) {
  const handler = createPasswordWorkHandler(credentials)
  const server = createServer((req, res) => { if (!handler(req, res)) { res.statusCode = 404; res.end() } })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  t.after(async () => { await handler.close(); await new Promise<void>(resolve => server.close(() => resolve())) })
  return { handler, base }
}

test('client uses one exact HTTPS origin, signed request and response, with unchanged scrypt strength', async t => {
  const h = await worker(t), seen: { url: string; headers: Headers; body: any }[] = []
  const client = createPasswordWorkClient({ origin: 'https://conti-server.onrender.com', authSecret: ` ${SECRET} `,
    request: (async (url, init) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(Buffer.from(init?.body as Uint8Array).toString()) })
      assert.equal(init?.redirect, 'manual'); assert.equal(init?.credentials, 'omit')
      return fetch(h.base + PASSWORD_WORK_PATH, init)
    }) as typeof fetch,
  })
  const key = await client.derive(PASSWORD, SALT)
  const expected = await new Promise<Buffer>((resolve, reject) => scrypt(PASSWORD, SALT, 32, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)))
  assert.deepEqual(key, expected)
  assert.equal(seen.length, 1); assert.equal(seen[0].url, 'https://conti-server.onrender.com' + PASSWORD_WORK_PATH)
  assert.deepEqual(Object.keys(seen[0].body).sort(), ['password', 'salt'])
  assert.equal(seen[0].headers.get('authorization'), null); assert.equal(seen[0].headers.get('cookie'), null)
  assert.equal(SALT.toString('hex'), '07'.repeat(16), 'caller salt is never mutated')
})

test('worker authenticates exact bytes, timestamp window and nonce before spending KDF resources', async () => {
  const clock = { now: Date.now() }, handler = createPasswordWorkHandler({ authSecret: SECRET, now: () => clock.now })
  const body = Buffer.from('{}'), headers = signed(body, clock.now)
  assert.equal(invoke(handler, body, { path: '/other' }).handled, false)
  assert.equal((await invoke(handler, body, { method: 'GET' }).done).statusCode, 405)
  assert.equal((await invoke(handler, body, { headers: {} }).done).statusCode, 401)
  assert.equal((await invoke(handler, Buffer.from('{ }'), { headers }).done).statusCode, 401)
  assert.equal((await invoke(handler, body, { headers: signed(body, clock.now - 30_001) }).done).statusCode, 401)
  assert.equal((await invoke(handler, body, { headers: signed(body, clock.now + 30_001) }).done).statusCode, 401)
  assert.equal((await invoke(handler, body, { headers }).done).statusCode, 400)
  assert.equal((await invoke(handler, body, { headers }).done).statusCode, 409)
  assert.deepEqual(handler.status(), { active: 0, queued: 0 })
  await handler.close()
})

test('malformed, oversized and compressed inputs cannot change scrypt parameters or include account fields', async () => {
  const handler = createPasswordWorkHandler({ authSecret: SECRET })
  for (const value of [null, [], {}, { password: 1, salt: SALT.toString('base64url') }, { password: PASSWORD, salt: 'short' },
    { password: PASSWORD, salt: Buffer.alloc(17).toString('base64url') }, { password: 'x'.repeat(513), salt: SALT.toString('base64url') },
    { password: PASSWORD, salt: SALT.toString('base64url'), N: 1024 }, { password: PASSWORD, salt: SALT.toString('base64url'), email: 'unused@example.test' }]) {
    assert.equal((await invoke(handler, Buffer.from(JSON.stringify(value))).done).statusCode, 400)
  }
  const body = payload()
  assert.equal((await invoke(handler, body, { headers: { ...signed(body), 'content-encoding': 'gzip' } }).done).statusCode, 415)
  assert.equal((await invoke(handler, Buffer.alloc(4097)).done).statusCode, 413)
  assert.equal((await invoke(handler, Buffer.alloc(4097), { headers: { ...signed(Buffer.alloc(4097)), 'content-length': '1' } }).done).statusCode, 413)
  assert.deepEqual(handler.status(), { active: 0, queued: 0 })
  await handler.close()
})

test('replay cache is bounded without evicting live nonces, and expiry frees capacity', async () => {
  const clock = { now: Date.now() }, handler = createPasswordWorkHandler({ authSecret: SECRET, now: () => clock.now })
  const body = Buffer.from('{}')
  for (let i = 0; i < 4096; i++) {
    const nonce = Buffer.alloc(16); nonce.writeUInt32BE(i)
    assert.equal((await invoke(handler, body, { headers: signed(body, clock.now, nonce.toString('base64url')) }).done).statusCode, 400)
  }
  assert.equal((await invoke(handler, body, { headers: signed(body, clock.now) }).done).statusCode, 503)
  assert.equal((await invoke(handler, body, { headers: signed(body, clock.now, Buffer.alloc(16).toString('base64url')) }).done).statusCode, 409)
  clock.now += 30_002
  assert.equal((await invoke(handler, body, { headers: signed(body, clock.now) }).done).statusCode, 400)
  await handler.close()
})

test('worker admits only one KDF plus eight queued jobs; close rejects the queue and waits for active work', async () => {
  const handler = createPasswordWorkHandler({ authSecret: SECRET })
  const jobs = Array.from({ length: 10 }, () => invoke(handler))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(handler.status(), { active: 1, queued: 8 })
  const closing = handler.close(), results = await Promise.all(jobs.map(job => job.done))
  await closing
  assert.equal(results.filter(result => result.statusCode === 200).length, 1)
  assert.equal(results.filter(result => result.statusCode === 503).length, 9)
  assert.deepEqual(handler.status(), { active: 0, queued: 0 })
  assert.equal((await invoke(handler).done).statusCode, 503)
})

test('unsigned slow request bodies have a bounded admission budget and shutdown cancels their readers', async () => {
  const handler = createPasswordWorkHandler({ authSecret: SECRET })
  const requests = Array.from({ length: 40 }, () => {
    const req = new EventEmitter() as EventEmitter & Record<string, any>
    req.url = PASSWORD_WORK_PATH; req.method = 'POST'
    // Syntactically valid headers are forgeable without the signing key. Never finish the body.
    req.headers = { 'content-type': 'application/json', 'content-length': '4096', 'x-nrn-password-timestamp': String(Date.now()),
      'x-nrn-password-nonce': 'A'.repeat(22), 'x-nrn-password-signature': 'A'.repeat(43) }
    req.resume = () => {}; req.destroy = () => { req.emit('aborted') }
    const res = new ResponseFixture()
    assert.equal(handler(req as unknown as IncomingMessage, res as unknown as ServerResponse), true)
    return { req, res }
  })
  let cancelledOnClose = false
  try {
    assert.equal(requests.filter(({ req }) => req.listenerCount('data') > 0).length, 32, 'Unauthenticated body readers must be capped')
    assert.equal(requests.filter(({ res }) => res.statusCode === 503 && res.writableEnded).length, 8, 'Overflow requests fail before buffering a body')
    assert.deepEqual(handler.status(), { active: 0, queued: 0 }, 'Unproven requests can never occupy a KDF slot')
    requests[0].req.emit('aborted')
    assert.equal(requests.filter(({ req }) => req.listenerCount('data') > 0).length, 31, 'A disconnected body releases its admission slot')
    const replacement = invoke(handler, Buffer.from('{}'))
    assert.equal((await replacement.done).statusCode, 400, 'A new signed request can use the released reader slot')
  } finally {
    await handler.close()
    cancelledOnClose = requests.every(({ req }) => req.listenerCount('data') === 0)
    // Ensure this regression cleans up even against the vulnerable implementation.
    for (const { req } of requests) req.emit('aborted')
  }
  await new Promise(resolve => setImmediate(resolve))
  assert(cancelledOnClose, 'Shutdown removes every body listener and deadline')
})

test('shutdown closes a real localhost request that never finishes its unauthenticated body', { timeout: 3000 }, async t => {
  const handler = createPasswordWorkHandler({ authSecret: SECRET })
  let received!: () => void
  const reading = new Promise<void>(resolve => { received = resolve })
  const server = createServer((req, res) => { handler(req, res); received() })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const socket = connect((server.address() as { port: number }).port, '127.0.0.1')
  const closed = new Promise<void>(resolve => socket.once('close', () => resolve()))
  const response: Buffer[] = []
  socket.on('data', chunk => { response.push(chunk) })
  socket.on('error', () => { /* A cancelled test connection contains no credentials. */ })
  t.after(async () => { socket.destroy(); await handler.close(); await new Promise<void>(resolve => server.close(() => resolve())) })
  await new Promise<void>(resolve => socket.once('connect', resolve))
  socket.write(`POST ${PASSWORD_WORK_PATH} HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 4096\r\nx-nrn-password-timestamp: ${Date.now()}\r\nx-nrn-password-nonce: ${'A'.repeat(22)}\r\nx-nrn-password-signature: ${'A'.repeat(43)}\r\n\r\n{`)
  await reading
  await handler.close()
  await closed
  assert.match(Buffer.concat(response).toString('utf8'), /^HTTP\/1\.1 503 /)
  assert.deepEqual(handler.status(), { active: 0, queued: 0 })
})

test('worker drains real queued derivations in order and removes disconnected queued clients', async () => {
  const handler = createPasswordWorkHandler({ authSecret: SECRET })
  const first = invoke(handler), disconnected = invoke(handler), second = invoke(handler)
  await new Promise(resolve => setImmediate(resolve))
  disconnected.res.destroyed = true; disconnected.res.emit('close')
  assert.deepEqual(handler.status(), { active: 1, queued: 1 })
  assert.equal((await first.done).statusCode, 200); assert.equal((await second.done).statusCode, 200)
  assert.deepEqual(handler.status(), { active: 0, queued: 0 })
  await handler.close()
})

test('client refuses insecure origins, unsigned/invalid results, redirects and deadlines without retrying', async () => {
  for (const origin of ['http://conti-server.onrender.com', 'https://conti-server.onrender.com/', 'https://user:secret@conti-server.onrender.com', 'https://conti-server.onrender.com:8443', 'https://conti-server.onrender.com/path']) {
    assert.throws(() => createPasswordWorkClient({ origin, authSecret: SECRET }))
  }
  assert.throws(() => createPasswordWorkHandler({ authSecret: 'short' }))
  for (const response of [Response.json({ key: 'k'.repeat(43) }), new Response('x'.repeat(257)), new Response('', { status: 503 }),
    new Response('', { status: 302, headers: { Location: 'https://evil.test' } })]) {
    let calls = 0
    const client = createPasswordWorkClient({ origin: 'https://worker.example.test', authSecret: SECRET, request: (async () => { calls++; return response }) as typeof fetch })
    await assert.rejects(client.derive(PASSWORD, SALT), PasswordWorkerUnavailable); assert.equal(calls, 1)
  }
  let aborted = false
  const client = createPasswordWorkClient({ origin: 'https://worker.example.test', authSecret: SECRET, timeoutMs: 10,
    request: ((_url, init) => { init?.signal?.addEventListener('abort', () => { aborted = true }); return new Promise(() => {}) }) as typeof fetch })
  await assert.rejects(client.derive(PASSWORD, SALT), { message: 'Password worker unavailable' }); assert.equal(aborted, true)
})

test('client rejects a correctly shaped key signed for another request nonce', async () => {
  const body = Buffer.from(JSON.stringify({ key: Buffer.alloc(32, 1).toString('base64url') }))
  const client = createPasswordWorkClient({ origin: 'https://worker.example.test', authSecret: SECRET,
    request: (async (_url, init) => {
      const timestamp = new Headers(init?.headers).get('x-nrn-password-timestamp')!
      const proof = createHmac('sha256', signingKey).update(`response\n${timestamp}\n${'n'.repeat(22)}\n200\n${sha(body)}`).digest('base64url')
      return new Response(body, { headers: { 'x-nrn-password-response': proof } })
    }) as typeof fetch,
  })
  await assert.rejects(client.derive(PASSWORD, SALT), PasswordWorkerUnavailable)
})

test('derived-only and legacy credentials have byte-identical request and response authentication', async t => {
  const scoped = derivePasswordWorkerSigningKey(` ${SECRET} `)
  assert.equal(scoped, signingKey.toString('base64url'))
  const derivedWorker = await worker(t, { signingKey: scoped, authSecret: 'not-needed-in-derived-mode' })
  const legacyWorker = await worker(t)
  for (const [base, credentials] of [[derivedWorker.base, { authSecret: SECRET }], [legacyWorker.base, { signingKey: scoped }]] as const) {
    const client = createPasswordWorkClient({ origin: 'https://worker.example.test', ...credentials,
      request: (async (_url, init) => {
        const headers = new Headers(init?.headers), body = Buffer.from(init?.body as Uint8Array)
        const expected = createHmac('sha256', signingKey).update(`${headers.get('x-nrn-password-timestamp')}\n${headers.get('x-nrn-password-nonce')}\nPOST\n${PASSWORD_WORK_PATH}\n${sha(body)}`).digest('base64url')
        assert.equal(headers.get('x-nrn-password-signature'), expected)
        return fetch(base + PASSWORD_WORK_PATH, init)
      }) as typeof fetch })
    const result = await client.derive(PASSWORD, SALT)
    assert.equal(result.length, 32)
  }
})

test('an explicitly invalid derived key fails closed instead of falling back to the principal secret', () => {
  for (const key of ['', 'x', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(42) + 'B', ' ' + signingKey.toString('base64url')]) {
    assert.throws(() => createPasswordWorkHandler({ signingKey: key, authSecret: SECRET }), /canonical/)
    assert.throws(() => createPasswordWorkClient({ origin: 'https://worker.example.test', signingKey: key, authSecret: SECRET }), /canonical/)
  }
})
