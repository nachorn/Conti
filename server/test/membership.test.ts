import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import express from 'express'
import test, { type TestContext } from 'node:test'
import { MembershipService, verifyStripeEvent, adConfigFromEnvironment, createMembershipService } from '../src/membership.js'
import type { SnapshotStore } from '../src/storage.js'

const SECRET = 'membership-tests-auth-secret-not-a-real-key'
const ADMIN = 'owner-test-dashboard-key-not-a-real-key'
const SIGNING = 'whsec_local_test_only'
class MemoryStore implements SnapshotStore {
  value: any = null
  fail = false
  healthy = true
  saves = 0
  isHealthy() { return this.healthy }
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { if (this.fail) throw new Error('unavailable'); this.saves++; this.value = structuredClone(value) }
  async close() {}
}
async function harness(t: TestContext, dualCurrency = false) {
  const store = new MemoryStore()
  const clock = { now: Date.now() }
  const inbox = new Map<string, { code: string; lang: string }>()
  const checkouts: { id: string; params: URLSearchParams }[] = []
  const prices = new Map([['price_test', 'eur'], ['price_eur', 'eur'], ['price_usd', 'usd']].map(([id, currency]) =>
    [id, { id, type: 'one_time', unit_amount: 499, currency, active: true, recurring: null, livemode: false }]))
  const options = {
    store, authSecret: SECRET, dashboardKey: ADMIN, now: () => clock.now,
    sendCode: async (email: string, code: string, lang: 'en' | 'es') => { inbox.set(email, { code, lang }) },
    stripeSecret: 'sk_test_local', stripeWebhookSecret: SIGNING, stripePriceId: 'price_test', appUrl: 'https://games.example',
    stripePriceIdEur: dualCurrency ? 'price_eur' : undefined,
    stripePriceIdUsd: dualCurrency ? 'price_usd' : undefined,
    request: (async (input: string | URL | Request, init?: RequestInit) => {
      const price = prices.get(String(input).split('/').at(-1) ?? '')
      if (String(input).includes('/prices/') && price) return Response.json(price)
      if (String(input).endsWith('/checkout/sessions')) {
        const id = `cs_test_${checkouts.length + 1}`
        const params = new URLSearchParams(init?.body as URLSearchParams)
        checkouts.push({ id, params })
        return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` })
      }
      throw new Error('Unexpected external request')
    }) as typeof fetch,
  }
  const membership = await new MembershipService(options).load()
  const app = express(); membership.registerRoutes(app)
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const port = (http.address() as { port: number }).port
  t.after(async () => { await new Promise<void>(resolve => http.close(() => resolve())); await membership.close() })
  const call = (path: string, body?: unknown, token?: string) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  async function login(email = 'player@example.com', lang: 'en' | 'es' = 'en') {
    await membership.requestCode(email, lang, email)
    return membership.verifyCode(email, inbox.get(email.toLowerCase().trim())!.code, email)
  }
  function paidEvent(index = 0, eventId = 'evt_paid') {
    const checkout = checkouts[index]
    return { id: eventId, livemode: false, type: 'checkout.session.completed', data: { object: {
      id: checkout.id, mode: 'payment', payment_status: 'paid', amount_total: 499, currency: checkout.params.get('currency')!, payment_intent: `pi_test_${index}`,
      client_reference_id: checkout.params.get('client_reference_id'), metadata: { orderId: checkout.params.get('metadata[orderId]'), accountId: checkout.params.get('metadata[accountId]') },
    } } }
  }
  const sign = (event: unknown, timestamp = Math.floor(clock.now / 1000)) => {
    const body = Buffer.from(JSON.stringify(event))
    return { body, signature: `t=${timestamp},v1=${createHmac('sha256', SIGNING).update(`${timestamp}.`).update(body).digest('hex')}` }
  }
  const webhook = (body: Buffer, signature: string) => fetch(`http://127.0.0.1:${port}/api/membership/stripe-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature }, body })
  const rawRequest = (path: string, body: string) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  })
  return { membership, options, store, clock, inbox, checkouts, prices, call, login, paidEvent, sign, webhook, rawRequest }
}

test('malformed and oversized request bodies never echo private input or write account storage', async t => {
  const h = await harness(t)
  const saves = h.store.saves
  for (const path of ['/api/membership/login', '/api/membership/checkout', '/api/admin/memberships/grant']) {
    const malformed = await h.rawRequest(path, '{"email":"private@example.com",')
    assert.equal(malformed.status, 400)
    assert.equal(malformed.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await malformed.json(), { error: 'invalid_request' })
    const oversized = await h.rawRequest(path, JSON.stringify({ email: 'private@example.com', extra: 'x'.repeat(5000) }))
    assert.equal(oversized.status, 413)
    assert.deepEqual(await oversized.json(), { error: 'invalid_request' })
  }
  const oversizedWebhook = await h.rawRequest('/api/membership/stripe-webhook', 'x'.repeat(270_000))
  assert.equal(oversizedWebhook.status, 413)
  assert.deepEqual(await oversizedWebhook.json(), { error: 'invalid_request' })
  assert.equal(h.store.saves, saves)
})

test('email verification preserves the same account on other devices and stores only credential hashes', async t => {
  const h = await harness(t)
  const first = await h.login('player@example.com', 'es')
  assert.equal(h.inbox.get('player@example.com')!.lang, 'es')
  assert.equal(first.account.adFree, false)
  assert.equal(first.token.length, 43)
  assert.ok(!JSON.stringify(h.store.value).includes(first.token))
  await assert.rejects(h.membership.verifyCode('player@example.com', h.inbox.get('player@example.com')!.code, 'same-ip'), /invalid_code/)
  const second = await h.login(' PLAYER@EXAMPLE.COM ')
  assert.equal(first.account.id, second.account.id)
  assert.notEqual(first.token, second.token)
  assert.equal(h.membership.authenticate(first.token)?.id, first.account.id)
  const restored = await new MembershipService(h.options).load()
  assert.equal(restored.authenticate(second.token)?.id, first.account.id)
  h.clock.now += 31 * 86_400_000
  assert.equal(restored.authenticate(first.token), null)
})

test('gift can precede signup, expires, is revocable, and grants no access to an unverified email', async t => {
  const h = await harness(t)
  await h.membership.grant('Friend@example.com', h.clock.now + 60_000)
  assert.equal(h.membership.authenticate('friend@example.com'), null)
  const first = await h.login('friend@example.com')
  assert.equal(first.account.source, 'gift')
  h.clock.now += 60_001
  assert.equal(h.membership.authenticate(first.token)?.adFree, false)
  await h.membership.grant('friend@example.com', null)
  assert.equal(h.membership.authenticate(first.token)?.adFree, true)
  await h.membership.revokeGift('friend@example.com')
  assert.equal(h.membership.authenticate(first.token)?.adFree, false)
})

test('OTP has five tries, expires, and send limits survive restart', async t => {
  const h = await harness(t)
  await h.membership.requestCode('a@example.com', 'en', 'ip')
  const correct = h.inbox.get('a@example.com')!.code
  const incorrect = correct === '000000' ? '111111' : '000000'
  for (let i = 0; i < 5; i++) await assert.rejects(h.membership.verifyCode('a@example.com', incorrect, 'ip'), /invalid_code/)
  await assert.rejects(h.membership.verifyCode('a@example.com', correct, 'ip'), /invalid_code/)
  await h.membership.requestCode('b@example.com', 'en', 'ip')
  const expired = h.inbox.get('b@example.com')!.code
  h.clock.now += 10 * 60_000 + 1
  await assert.rejects(h.membership.verifyCode('b@example.com', expired, 'ip'), /invalid_code/)
  for (let i = 0; i < 3; i++) await h.membership.requestCode('c@example.com', 'en', 'ip')
  const restored = await new MembershipService(h.options).load()
  await assert.rejects(restored.requestCode('c@example.com', 'en', 'new-ip'), /rate_limited/)
  assert.ok(!JSON.stringify(h.store.value).includes(h.inbox.get('c@example.com')!.code))
})

test('owner endpoints require private header key; ordinary members cannot grant privileges', async t => {
  const h = await harness(t)
  const member = await h.login()
  for (const token of [undefined, 'bad-key', member.token]) {
    const response = await h.call('/api/admin/memberships/grant', { email: 'friend@example.com' }, token)
    assert.equal(response.status, 401)
  }
  assert.equal((await h.call(`/api/admin/memberships?key=${ADMIN}`)).status, 401)
  assert.equal((await h.call('/api/admin/memberships/grant', { email: 'friend@example.com', expiresAt: null }, ADMIN)).status, 200)
  const response = await h.call('/api/admin/memberships', undefined, ADMIN)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal((await response.json()).grants.length, 1)
  assert.equal((await h.call('/api/admin/memberships/grant', { email: 'bad', expiresAt: null }, ADMIN)).status, 400)
  assert.equal((await h.call('/api/admin/memberships/grant', { email: 'friend@example.com', expiresAt: h.clock.now - 1 }, ADMIN)).status, 400)
})

test('checkout is tied to the verified account, reused before payment, and activated only by signed paid event', async t => {
  const h = await harness(t)
  const member = await h.login()
  const config = await h.membership.config()
  assert.deepEqual(config.price, { amount: 499, currency: 'eur' })
  assert.deepEqual(config.prices, [{ amount: 499, currency: 'eur' }])
  assert.equal(config.checkoutEnabled, true)
  const url = await h.membership.checkout(member.token)
  assert.equal(url, await h.membership.checkout(member.token))
  assert.equal(h.checkouts.length, 1)
  assert.equal(h.checkouts[0].params.get('client_reference_id'), member.account.id)
  assert.equal(h.checkouts[0].params.get('mode'), 'payment')
  assert.equal(h.checkouts[0].params.get('payment_method_types[0]'), 'card')
  assert.equal(h.checkouts[0].params.get('adaptive_pricing[enabled]'), 'false')
  assert.equal(h.membership.authenticate(member.token)?.adFree, false)
  const event = h.paidEvent()
  const { body, signature } = h.sign(event)
  assert.equal((await h.webhook(body, signature)).status, 200)
  assert.equal((await h.webhook(body, signature)).status, 200)
  assert.equal(h.membership.authenticate(member.token)?.source, 'purchase')
  assert.equal(h.store.value.orders.length, 1)
  assert.equal(h.store.value.events.length, 1)
  const secondDevice = await h.login()
  assert.equal(secondDevice.account.source, 'purchase')
  await h.membership.grant(member.account.email, null)
  await h.membership.revokeGift(member.account.email)
  assert.equal(h.membership.authenticate(member.token)?.source, 'purchase')
  await assert.rejects(h.membership.checkout(member.token), /already_ad_free/)
})

test('fixed EUR and USD checkouts retain their chosen price, reuse only that choice, and ignore client amounts', async t => {
  const h = await harness(t, true)
  const member = await h.login()
  const config = await h.membership.config()
  assert.deepEqual(config.prices, [{ amount: 499, currency: 'eur' }, { amount: 499, currency: 'usd' }])
  assert.deepEqual(config.price, config.prices![0])
  assert.ok(!JSON.stringify(config).includes('price_eur'))
  const urls: string[] = []
  for (const currency of ['eur', 'usd']) {
    const response = await h.call('/api/membership/checkout', { currency, amount: 1, priceId: 'price_arbitrary' }, member.token)
    assert.equal(response.status, 200)
    const url = (await response.json()).url
    urls.push(url)
    assert.equal(await h.membership.checkout(member.token, currency), url)
    const checkout = h.checkouts.at(-1)!
    assert.equal(checkout.params.get('line_items[0][price]'), `price_${currency}`)
    assert.equal(checkout.params.get('currency'), currency)
    assert.equal(checkout.params.get('adaptive_pricing[enabled]'), 'false')
    assert.equal(checkout.params.get('line_items[0][price_data][unit_amount]'), null)
  }
  assert.notEqual(urls[0], urls[1])
  assert.equal(await h.membership.checkout(member.token, 'eur'), urls[0])
  assert.equal(await h.membership.checkout(member.token), urls[0])
  assert.equal(h.checkouts.length, 2)
  assert.deepEqual(h.store.value.orders.map((o: any) => ({ priceId: o.priceId, amount: o.amount, currency: o.currency })), [
    { priceId: 'price_eur', amount: 499, currency: 'eur' }, { priceId: 'price_usd', amount: 499, currency: 'usd' },
  ])
  const restored = await new MembershipService(h.options).load()
  assert.equal(await restored.checkout(member.token, 'usd'), urls[1])
})

test('each fixed currency activates only after its matching signed payment, rejecting cross-currency callbacks', async t => {
  const h = await harness(t, true)
  for (const [index, currency] of ['eur', 'usd'].entries()) {
    const member = await h.login(`${currency}@example.com`)
    await h.membership.checkout(member.token, currency)
    const paid = h.paidEvent(index, `evt_paid_${currency}`)
    for (const field of ['currency', 'amount_total'] as const) {
      const mismatch = structuredClone(paid)
      if (field === 'currency') mismatch.data.object.currency = currency === 'eur' ? 'usd' : 'eur'
      else mismatch.data.object.amount_total = 1
      const signed = h.sign(mismatch)
      assert.equal((await h.webhook(signed.body, signed.signature)).status, 400)
      assert.equal(h.membership.authenticate(member.token)?.adFree, false)
    }
    const signed = h.sign(paid)
    assert.equal((await h.webhook(signed.body, signed.signature)).status, 200)
    assert.equal(h.membership.authenticate(member.token)?.source, 'purchase')
  }
})

test('unknown and unconfigured currencies cannot create an order or silently choose another price', async t => {
  const h = await harness(t)
  const member = await h.login()
  const saves = h.store.saves
  for (const currency of ['gbp', 'EUR', '', null, 499, { currency: 'eur' }]) {
    const response = await h.call('/api/membership/checkout', { currency }, member.token)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_currency' })
  }
  assert.equal((await h.call('/api/membership/checkout', { currency: 'usd' }, member.token)).status, 503)
  assert.equal(h.checkouts.length, 0)
  assert.equal(h.store.saves, saves)
})

test('currency-specific configuration rejects wrong fixed amounts, currencies, IDs and payment mode', async t => {
  const h = await harness(t, true)
  h.prices.get('price_eur')!.unit_amount = 500
  h.prices.get('price_usd')!.currency = 'eur'
  const member = await h.login()
  assert.deepEqual((await h.membership.config()).prices, [])
  assert.equal((await h.membership.config()).checkoutEnabled, false)
  for (const currency of ['eur', 'usd']) await assert.rejects(h.membership.checkout(member.token, currency), /checkout_not_configured/)
  h.prices.get('price_eur')!.unit_amount = 499
  h.prices.get('price_eur')!.id = 'price_other'
  h.prices.get('price_usd')!.currency = 'usd'
  h.prices.get('price_usd')!.livemode = true
  assert.deepEqual((await h.membership.config()).prices, [])
  assert.equal(h.checkouts.length, 0)
  assert.equal(h.store.value.orders.length, 0)
})

test('unpaid, mismatched, forged and stale payment callbacks cannot grant access', async t => {
  const h = await harness(t)
  const member = await h.login()
  await h.membership.checkout(member.token)
  const paid = h.paidEvent()
  const unpaid = structuredClone(paid); unpaid.id = 'evt_unpaid'; unpaid.data.object.payment_status = 'unpaid'
  await h.membership.handleStripeEvent(unpaid)
  assert.equal(h.membership.authenticate(member.token)?.adFree, false)
  for (const field of ['amount_total', 'currency', 'client_reference_id', 'id'] as const) {
    const bad: any = structuredClone(paid); bad.data.object[field] = field === 'amount_total' ? 1 : 'wrong'
    await assert.rejects(h.membership.handleStripeEvent(bad), /payment_mismatch/)
  }
  const { body, signature } = h.sign(paid)
  assert.equal((await h.webhook(body, '')).status, 400)
  assert.equal((await h.webhook(Buffer.from(body.toString().replace('499', '999')), signature)).status, 400)
  const stale = h.sign(paid, Math.floor(h.clock.now / 1000) - 301)
  assert.equal((await h.webhook(stale.body, stale.signature)).status, 400)
  assert.equal(h.membership.authenticate(member.token)?.adFree, false)
})

test('full refund and refund-before-payment cannot be replayed into an active purchase', async t => {
  const h = await harness(t)
  const member = await h.login()
  await h.membership.checkout(member.token)
  await h.membership.handleStripeEvent(h.paidEvent())
  const refund = { id: 'evt_refund', livemode: false, type: 'charge.refunded', data: { object: { payment_intent: 'pi_test_0', refunded: true } } }
  await h.membership.handleStripeEvent(refund)
  assert.equal(h.membership.authenticate(member.token)?.adFree, false)
  await h.membership.handleStripeEvent(h.paidEvent(0, 'evt_paid_reordered'))
  assert.equal(h.membership.authenticate(member.token)?.adFree, false)
  const other = await h.login('other@example.com'); await h.membership.checkout(other.token)
  await h.membership.handleStripeEvent({ ...refund, id: 'evt_early_refund', data: { object: { payment_intent: 'pi_test_1', refunded: true } } })
  await h.membership.handleStripeEvent(h.paidEvent(1, 'evt_late_paid'))
  assert.equal(h.membership.authenticate(other.token)?.adFree, false)
})

test('logout revokes the server session and private status never appears in anonymous endpoints', async t => {
  const h = await harness(t)
  const member = await h.login()
  await h.membership.grant(member.account.email, null)
  assert.equal((await h.call('/api/membership/me')).status, 401)
  assert.equal((await h.call('/api/membership/me', undefined, member.token)).status, 200)
  const publicData = JSON.stringify(await (await h.call('/api/membership/config')).json())
  assert.ok(!publicData.includes(member.account.email)); assert.ok(!publicData.includes(member.token)); assert.ok(!publicData.includes(SECRET))
  assert.equal((await h.call('/api/membership/logout', {}, member.token)).status, 200)
  assert.equal(h.membership.authenticate(member.token), null)
  const saves = h.store.saves
  assert.equal((await h.call('/api/membership/logout', {}, 'unknown-token')).status, 200)
  assert.equal(h.store.saves, saves, 'anonymous logout must not write storage')
})

test('blocked email requests cannot grow durable counters or repeatedly write storage', async t => {
  const h = await harness(t)
  for (let i = 0; i < 15; i++) await h.membership.requestCode(`person${i}@example.com`, 'en', 'same-ip')
  const limits = h.store.value.limits.length
  const saves = h.store.saves
  for (let i = 15; i < 60; i++) await assert.rejects(h.membership.requestCode(`person${i}@example.com`, 'en', 'same-ip'), /rate_limited/)
  assert.equal(h.store.value.limits.length, limits)
  assert.equal(h.store.saves, saves)
})

test('storage failures do not grant gifts and corrupt account state is rejected', async t => {
  const h = await harness(t)
  const member = await h.login()
  h.store.fail = true
  await assert.rejects(h.membership.grant(member.account.email, null), /server_unavailable/)
  assert.equal(h.membership.isHealthy(), false)
  assert.equal(h.membership.hasFailedOperation(), true)
  assert.equal(h.membership.authenticate(member.token), null)
  h.store.fail = false
  const restored = await new MembershipService(h.options).load()
  assert.equal(restored.authenticate(member.token)?.adFree, false)
  h.store.value = { version: 1, accounts: [{ email: 'bad' }] }
  await assert.rejects(new MembershipService(h.options).load(), /Invalid membership storage/)
})

test('an idle membership store disconnect stays passive until a real request or mutation fails closed', async t => {
  for (const operation of ['request', 'mutation']) {
    const h = await harness(t)
    const member = await h.login()
    const saves = h.store.saves
    h.store.healthy = false
    assert.equal(h.membership.isHealthy(), false)
    assert.equal(h.membership.hasFailedOperation(), false)
    assert.equal(h.membership.authenticate(member.token), null)
    assert.equal((await h.membership.config()).checkoutEnabled, false)
    assert.equal(h.membership.hasFailedOperation(), false, 'passive status and socket checks must not wake an idle database')
    if (operation === 'request') {
      const response = await h.call('/api/membership/me', undefined, member.token)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { error: 'server_unavailable' })
    } else {
      await assert.rejects(h.membership.grant(member.account.email, null), /server_unavailable/)
    }
    assert.equal(h.membership.hasFailedOperation(), true, 'the first failed operation must trigger supervised recovery')
    assert.equal(h.store.saves, saves)
    assert.equal(h.store.value.grants.length, 0)
    h.store.healthy = true
    assert.equal(h.membership.isHealthy(), false, 'a failed operation remains latched until restart')
  }
})

test('disabled configuration never creates accounts, enables ads, or exposes a price', async t => {
  assert.equal(await createMembershipService({}), undefined)
  assert.deepEqual(adConfigFromEnvironment({}), { provider: 'disabled', publisherId: null })
  assert.deepEqual(adConfigFromEnvironment({ ADS_PROVIDER: 'google-h5' }), { provider: 'disabled', publisherId: null })
  const store = new MemoryStore()
  const membership = await new MembershipService({ store, authSecret: SECRET }).load()
  t.after(() => membership.close())
  assert.deepEqual(await membership.config(), { enabled: true, loginEnabled: false, checkoutEnabled: false, price: null, prices: [], ads: { provider: 'disabled', publisherId: null } })
  await assert.rejects(membership.requestCode('player@example.com', 'en', 'ip'), /email_not_configured/)
})

test('signature check permits rotation but rejects duplicate timestamps and malformed bodies', () => {
  const now = Date.now(); const timestamp = Math.floor(now / 1000)
  const body = Buffer.from(JSON.stringify({ id: 'evt_ok', type: 'unknown', livemode: false, data: { object: {} } }))
  const signature = createHmac('sha256', SIGNING).update(`${timestamp}.`).update(body).digest('hex')
  assert.equal(verifyStripeEvent(body, `t=${timestamp},v1=${'a'.repeat(64)},v1=${signature}`, SIGNING, now).id, 'evt_ok')
  assert.throws(() => verifyStripeEvent(body, `t=${timestamp},t=${timestamp},v1=${signature}`, SIGNING, now), /invalid_signature/)
  assert.throws(() => verifyStripeEvent(body, `t=${timestamp},v1=${signature}`, '', now), /invalid_signature/)
})
