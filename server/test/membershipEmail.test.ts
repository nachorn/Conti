import assert from 'node:assert/strict'
import test from 'node:test'
import { createMembershipEmailSender } from '../src/membershipEmail.js'

const SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const ENV = {
  MEMBERSHIP_EMAIL_PROVIDER: 'gmail', GOOGLE_CLIENT_ID: 'test-client-id', GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REFRESH_TOKEN: 'test-refresh-token', GMAIL_SENDER: 'sender@example.com',
}
const token = (access_token = 'test-access-token') => Response.json({ access_token, expires_in: 3600, token_type: 'Bearer', scope: SCOPE })
const sent = () => Response.json({ id: 'gmail-message-id' })
type Call = { url: string; options: RequestInit }
function mockRequest(handle: (call: Call) => Response | Promise<Response> = call => call.url === TOKEN_URL ? token() : sent()) {
  const calls: Call[] = []
  const request: typeof fetch = async (input, options) => {
    const call = { url: String(input), options: options! }
    calls.push(call)
    return handle(call)
  }
  return { request, calls }
}

test('requires complete explicit Gmail config and never falls back to another provider', () => {
  const legacy = { RESEND_API_KEY: 'test-resend-key', MEMBERSHIP_EMAIL_FROM: 'Conti <sender@example.com>' }
  assert.equal(createMembershipEmailSender({}), undefined)
  assert.equal(createMembershipEmailSender({ ...ENV, MEMBERSHIP_EMAIL_PROVIDER: undefined }), undefined)
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GMAIL_SENDER']) {
    assert.equal(createMembershipEmailSender({ ...legacy, ...ENV, [key]: '' }), undefined)
  }
  for (const from of ['sender@example.com\r\nBcc: other@example.com', 'sender@example.com\n', 'Conti <sender@example.com>', 'a@example..com']) {
    assert.equal(createMembershipEmailSender({ ...ENV, GMAIL_SENDER: from }), undefined)
  }
  assert.equal(createMembershipEmailSender({ ...legacy, MEMBERSHIP_EMAIL_PROVIDER: 'unknown' }), undefined)
  assert.equal(createMembershipEmailSender({ ...legacy, MEMBERSHIP_EMAIL_FROM: 'sender@example.com\r\nBcc: other@example.com' }), undefined)
  assert.equal(typeof createMembershipEmailSender(ENV), 'function')
  assert.equal(typeof createMembershipEmailSender(legacy), 'function')
})

test('sends UTF-8 ES and EN MIME messages through Gmail with only the send scope', async () => {
  for (const lang of ['es', 'en'] as const) {
    const { request, calls } = mockRequest()
    const send = createMembershipEmailSender(ENV, request, () => Date.UTC(2026, 8, 12))!
    await send('player+login@example.com', '001234', lang)
    assert.equal(calls.length, 2)
    const refresh = calls[0]
    assert.equal(refresh.url, TOKEN_URL)
    assert.deepEqual(Object.fromEntries(refresh.options.body as URLSearchParams), {
      client_id: ENV.GOOGLE_CLIENT_ID, client_secret: ENV.GOOGLE_CLIENT_SECRET, refresh_token: ENV.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token',
    })
    const delivery = calls[1]
    assert.equal(delivery.url, SEND_URL)
    assert.equal(new Headers(delivery.options.headers).get('authorization'), 'Bearer test-access-token')
    for (const call of calls) {
      assert.equal(call.options.method, 'POST')
      assert.equal(call.options.redirect, 'error')
      assert.ok(call.options.signal instanceof AbortSignal)
      assert.equal(call.options.signal.aborted, false)
    }
    const { raw } = JSON.parse(delivery.options.body as string)
    assert.match(raw, /^[a-zA-Z0-9_-]+$/)
    const mime = Buffer.from(raw, 'base64url').toString('utf8')
    assert.doesNotMatch(mime.replace(/\r\n/g, ''), /[\r\n]/)
    const [headers, body] = mime.split('\r\n\r\n')
    assert.match(headers, /^From: sender@example.com\r\nTo: player\+login@example.com\r\n/)
    assert.match(headers, /Date: Sat, 12 Sep 2026 00:00:00 GMT/)
    assert.match(headers, /Message-ID: <[a-f0-9-]+@example.com>/)
    assert.match(headers, /MIME-Version: 1.0/)
    assert.match(headers, /Content-Type: text\/plain; charset=UTF-8/)
    assert.match(headers, /Content-Transfer-Encoding: base64/)
    const subjectMatch = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(headers)!
    const subject = Buffer.from(subjectMatch[1], 'base64').toString('utf8')
    assert.equal(subject, lang === 'es' ? 'Tu código de acceso · Continental y Pocha' : 'Your sign-in code · Continental & Pocha')
    assert.ok(body.trimEnd().split('\r\n').every(line => line.length <= 76))
    const plain = Buffer.from(body, 'base64').toString('utf8')
    assert.equal(plain, lang === 'es'
      ? 'Tu código de acceso es 001234. Caduca en 10 minutos y solo se puede usar una vez.\r\n\r\nSi no lo has solicitado, puedes ignorar este correo.'
      : 'Your sign-in code is 001234. It expires in 10 minutes and can only be used once.\r\n\r\nIf you did not request this, you can ignore this email.')
    assert.ok(!mime.includes(ENV.GOOGLE_REFRESH_TOKEN))
    assert.ok(!mime.includes(ENV.GOOGLE_CLIENT_SECRET))
  }
})

test('reuses tokens and refreshes one minute before expiry', async () => {
  let time = 0
  let refreshes = 0
  const { request, calls } = mockRequest(call => call.url === TOKEN_URL ? token(`access-token-${++refreshes}`) : sent())
  const send = createMembershipEmailSender(ENV, request, () => time)!
  await send('player@example.com', '123456', 'en')
  time = 3_539_999
  await send('player@example.com', '123456', 'en')
  assert.equal(refreshes, 1)
  time = 3_540_000
  await send('player@example.com', '123456', 'en')
  assert.equal(refreshes, 2)
  assert.deepEqual(calls.filter(call => call.url === SEND_URL).map(call => new Headers(call.options.headers).get('authorization')),
    ['Bearer access-token-1', 'Bearer access-token-1', 'Bearer access-token-2'])
})

test('shares a token refresh across simultaneous requests', async () => {
  let release!: (value: Response) => void
  const response = new Promise<Response>(resolve => { release = resolve })
  const { request, calls } = mockRequest(call => call.url === TOKEN_URL ? response : sent())
  const send = createMembershipEmailSender(ENV, request)!
  const pending = [send('one@example.com', '123456', 'es'), send('two@example.com', '654321', 'en')]
  assert.equal(calls.length, 1)
  release(token())
  await Promise.all(pending)
  assert.equal(calls.filter(call => call.url === TOKEN_URL).length, 1)
  assert.equal(calls.filter(call => call.url === SEND_URL).length, 2)
})

test('invalid recipients, codes and languages fail before any external request', async () => {
  const { request, calls } = mockRequest()
  const send = createMembershipEmailSender(ENV, request)!
  for (const email of ['player@example.com\r\nBcc: victim@example.com', 'player@example.com\n', 'x@example.com, y@example.com', '.player@example.com', 'player..a@example.com', 'player@-example.com']) {
    await assert.rejects(send(email, '123456', 'en'), { message: 'Email unavailable' })
  }
  for (const code of ['12345', '1234567', '12345\n', '１２３４５６']) {
    await assert.rejects(send('player@example.com', code, 'en'), { message: 'Email unavailable' })
  }
  await assert.rejects(send('player@example.com', '123456', 'xx' as 'en'), { message: 'Email unavailable' })
  assert.equal(calls.length, 0)
})

test('token failures never send email or expose provider errors, and a later request can recover', async () => {
  const badResponses = [
    () => Response.json({ error: 'invalid_grant', private: ENV.GOOGLE_REFRESH_TOKEN }, { status: 400 }),
    () => new Response('not-json'),
    () => Response.json({ access_token: 'private-access-token', token_type: 'Bearer', expires_in: 0 }),
    () => Response.json({ access_token: 'private-access-token', token_type: 'Bearer', expires_in: 3600, scope: 'https://mail.google.com/' }),
    () => Response.json({ access_token: 'private-access-token', token_type: 'Bearer', expires_in: 3600, scope: `${SCOPE} https://www.googleapis.com/auth/gmail.readonly` }),
    () => Response.json({ access_token: 'token\r\nX-Private: secret', token_type: 'Bearer', expires_in: 3600 }),
    () => Response.json({ access_token: 'private-access-token', token_type: 'invalid', expires_in: 3600 }),
    () => { throw new Error(`network error ${ENV.GOOGLE_REFRESH_TOKEN}`) },
  ]
  for (const badResponse of badResponses) {
    let failing = true
    const { request, calls } = mockRequest(call => call.url !== TOKEN_URL ? sent() : failing ? badResponse() : token())
    const send = createMembershipEmailSender(ENV, request)!
    await assert.rejects(send('private@example.com', '123456', 'es'), { message: 'Email unavailable' })
    assert.equal(calls.length, 1)
    failing = false
    await send('private@example.com', '654321', 'en')
    assert.equal(calls.length, 3)
  }
})

test('ambiguous or rejected sends are never retried and errors stay generic', async () => {
  for (const failSend of [
    () => Response.json({ error: 'private@example.com 123456' }, { status: 503 }),
    () => { throw new Error('connection closed: private@example.com 123456') },
    () => new Response('incomplete response'),
    () => Response.json({}),
  ]) {
    const { request, calls } = mockRequest(call => call.url === TOKEN_URL ? token() : failSend())
    const send = createMembershipEmailSender(ENV, request)!
    await assert.rejects(send('private@example.com', '123456', 'en'), { message: 'Email unavailable' })
    assert.equal(calls.length, 2)
  }
})

test('token and email requests abort at a 15-second deadline without a retry', async t => {
  const controllers = new Map<AbortSignal, AbortController>()
  const timeout = t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 15_000)
    const controller = new AbortController()
    controllers.set(controller.signal, controller)
    return controller.signal
  })
  for (const failedUrl of [TOKEN_URL, SEND_URL, 'https://api.resend.com/emails']) {
    const { request, calls } = mockRequest(call => {
      if (call.url !== failedUrl) return token()
      return new Promise((_resolve, reject) => {
        const signal = call.options.signal!
        signal.addEventListener('abort', () => reject(new Error('private provider timeout')), { once: true })
        queueMicrotask(() => controllers.get(signal)!.abort())
      })
    })
    const env = failedUrl.includes('resend')
      ? { RESEND_API_KEY: 'resend-test-key', MEMBERSHIP_EMAIL_FROM: 'sender@example.com' }
      : ENV
    const send = createMembershipEmailSender(env, request)!
    await assert.rejects(send('private@example.com', '123456', 'en'), { message: 'Email unavailable' })
    assert.equal(calls.filter(call => call.url === failedUrl).length, 1)
    assert.equal(calls.length, failedUrl === SEND_URL ? 2 : 1)
  }
  assert.equal(timeout.mock.callCount(), 4)
})

test('a rejected access token is refreshed on the next send without retrying the first', async () => {
  let deliveries = 0
  const { request, calls } = mockRequest(call => call.url === TOKEN_URL ? token() : ++deliveries === 1 ? new Response(null, { status: 401 }) : sent())
  const send = createMembershipEmailSender(ENV, request)!
  await assert.rejects(send('player@example.com', '123456', 'en'), { message: 'Email unavailable' })
  assert.equal(calls.length, 2)
  await send('player@example.com', '654321', 'en')
  assert.equal(calls.filter(call => call.url === TOKEN_URL).length, 2)
  assert.equal(deliveries, 2)
})

test('keeps explicit and legacy Resend configuration compatible with bilingual messages', async () => {
  for (const provider of [undefined, 'resend']) {
    const { request, calls } = mockRequest(() => new Response(null, { status: 202 }))
    const send = createMembershipEmailSender({ MEMBERSHIP_EMAIL_PROVIDER: provider, RESEND_API_KEY: 'resend-test-key', MEMBERSHIP_EMAIL_FROM: 'Conti <sender@example.com>' }, request)!
    await send('player@example.com', '123456', 'es')
    await send('player@example.com', '654321', 'en')
    assert.ok(calls.every(call => call.url === 'https://api.resend.com/emails'))
    const first = JSON.parse(calls[0].options.body as string)
    const second = JSON.parse(calls[1].options.body as string)
    assert.equal(first.from, 'Conti <sender@example.com>')
    assert.deepEqual(first.to, ['player@example.com'])
    assert.match(first.text, /Tu código de acceso es 123456/)
    assert.match(second.text, /Your sign-in code is 654321/)
    const keys = calls.map(call => new Headers(call.options.headers).get('idempotency-key'))
    assert.ok(keys.every(Boolean))
    assert.notEqual(keys[0], keys[1])
  }
})
