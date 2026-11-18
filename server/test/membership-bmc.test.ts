import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import test, { type TestContext } from 'node:test'
import express from 'express'
import { MembershipService } from '../src/membership.js'
import { bmcFromEnvironment, bmcReadiness, verifyBmcEvent, type BmcOptions } from '../src/membershipBmc.js'
import type { SnapshotStore } from '../src/storage.js'

const DAY = 86_400_000
const SIGNING = 'local-bmc-test-signing-secret-not-production'
const ADMIN = 'local-bmc-owner-test-key-not-production'
class MemoryStore implements SnapshotStore {
  value: any = null
  fail = false
  ambiguous = false
  saves = 0
  async load() { return structuredClone(this.value) }
  async save(value: unknown) {
    this.saves++
    if (this.fail) throw new Error('local save failed')
    this.value = structuredClone(value)
    if (this.ambiguous) throw new Error('local acknowledgement lost')
  }
  async close() {}
}
async function harness(t: TestContext, bmcOverrides: Partial<BmcOptions> = {}) {
  const store = new MemoryStore(), clock = { now: Date.UTC(2026, 10, 16) }, inbox = new Map<string, string>()
  const bmc: BmcOptions = { secret: SIGNING, levelId: '77', currency: 'usd', amountUnits: 'major', monthlyAmount: 100,
    membershipUrl: 'https://buymeacoffee.com/nrnplay/membership', managementUrl: 'https://buymeacoffee.com/my-account',
    validationConfirmed: true, refundMode: 'manual', durableStorage: true, ...bmcOverrides }
  const options = { store, authSecret: 'local-bmc-auth-test-secret-not-production', dashboardKey: ADMIN, now: () => clock.now,
    sendCode: async (email: string, code: string) => { inbox.set(email, code) }, bmc }
  const service = await new MembershipService(options).load()
  const app = express(); service.registerRoutes(app)
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  t.after(async () => { await new Promise<void>(resolve => http.close(() => resolve())); await service.close() })
  const call = (path: string, body?: unknown, token?: string, adminWrite = false) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(adminWrite ? { 'X-Admin-Request': '1' } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const login = async (email = 'ana@example.test') => {
    await service.requestCode(email, 'es', email)
    return service.verifyCode(email, inbox.get(email)!, email)
  }
  const event = (type = 'membership.started', fields: Record<string, unknown> = {}, created = Math.floor(clock.now / 1000)) => ({
    event_id: 1001, type, live_mode: true, created, attempt: 1, data: {
      object: 'membership', id: 501, membership_level_id: 77, supporter_email: 'ana@example.test',
      duration_type: 'year', status: 'active', canceled: 'false', paused: 'false', cancel_at_period_end: 'false',
      amount: 10, currency: 'USD', current_period_start: Math.floor(clock.now / 1000),
      current_period_end: Math.floor((clock.now + 365 * DAY) / 1000), canceled_at: null, ...fields,
    },
  })
  const sign = (payload: unknown) => {
    const body = Buffer.from(JSON.stringify(payload))
    return { body, signature: createHmac('sha256', SIGNING).update(body).digest('hex') }
  }
  const deliver = (payload: unknown) => {
    const { body, signature } = sign(payload)
    return service.handleBmcWebhook(body, signature)
  }
  const webhook = (payload: unknown, signatureOverride?: string, compressed = false) => {
    const { body, signature } = sign(payload)
    return fetch(base + '/api/membership/bmc-webhook', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-signature-sha256': signatureOverride ?? signature, ...(compressed ? { 'Content-Encoding': 'gzip' } : {}) },
      body: compressed ? gzipSync(body) : body })
  }
  return { store, clock, inbox, options, service, call, login, event, sign, deliver, webhook }
}

test('BMC readiness fails closed for missing configuration, durable storage or the manual-refund acknowledgement', async t => {
  assert.equal(bmcFromEnvironment({}), undefined)
  const h = await harness(t, { validationConfirmed: false })
  assert.equal(h.service.plusReadiness().ready, false)
  const config = await h.service.config()
  assert.equal(config.plus?.purchaseEnabled, false)
  assert.equal(config.plus?.purchaseUrl, null)
  assert.deepEqual(config.plus?.prices, [{ amount: 1000, currency: 'usd' }])
  assert.deepEqual(config.plus?.monthlyPrices, [{ amount: 100, currency: 'usd' }])
  assert.ok(!JSON.stringify(config).includes(SIGNING))
  for (const change of [{ durableStorage: false }, { refundMode: undefined }, { amountUnits: undefined }, { secret: undefined }]) {
    assert.equal(bmcReadiness({ ...h.options.bmc, ...change }).ready, false)
  }
  await assert.rejects(h.deliver(h.event()), /plus_not_configured/)
  assert.deepEqual(await h.deliver({ ...h.event(), live_mode: false }), { received: true, test: true })
  assert.equal(h.service.plusReadiness().lastSignedTestAt, h.clock.now)
  assert.equal(h.store.value.bmcSubscriptions.length, 0)
})

test('checkout requires a verified session, valid configured price and never grants rights or sends the email in a URL', async t => {
  const h = await harness(t), session = await h.login()
  assert.equal((await h.call('/api/membership/plus/checkout', { currency: 'usd' })).status, 401)
  for (const interval of ['year', 'month']) {
    const response = await h.call('/api/membership/plus/checkout', { currency: 'usd', interval }, session.token)
    assert.equal(response.status, 200)
    const { url } = await response.json() as any
    assert.equal(url, h.options.bmc.membershipUrl)
    assert.equal(new URL(url).search, '')
  }
  assert.equal((await h.call('/api/membership/plus/checkout', { currency: 'eur' }, session.token)).status, 400)
  assert.equal((await h.call('/api/membership/plus/checkout', { currency: 'usd', interval: 'lifetime' }, session.token)).status, 400)
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  assert.equal((await h.service.config()).checkoutEnabled, false)
  assert.deepEqual((await h.service.config()).prices, [])
  assert.equal((await h.call('/api/membership/checkout', { currency: 'usd' }, session.token)).status, 409)
  assert.equal((await h.call('/api/membership/me?payment=success', undefined, session.token)).status, 200)
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
})

test('raw HMAC verification rejects forged, tampered, oversized, future and compressed payloads without storage changes', async t => {
  const h = await harness(t)
  const good = h.event(), { body, signature } = h.sign(good)
  for (const supplied of ['', '0'.repeat(64), signature.slice(1), 'invalid']) {
    assert.throws(() => verifyBmcEvent(body, supplied, SIGNING, h.clock.now), /invalid_signature/)
  }
  assert.throws(() => verifyBmcEvent(Buffer.concat([body, Buffer.from(' ')]), signature, SIGNING, h.clock.now), /invalid_signature/)
  assert.throws(() => verifyBmcEvent(body, signature, undefined, h.clock.now), /bmc_not_configured/)
  const future = h.sign({ ...good, created: Math.floor(h.clock.now / 1000) + 301 })
  assert.throws(() => verifyBmcEvent(future.body, future.signature, SIGNING, h.clock.now), /invalid_event/)
  assert.equal((await h.webhook(good, '0'.repeat(64))).status, 400)
  assert.equal((await h.webhook(good, undefined, true)).status, 415)
  const huge = { ...good, padding: 'x'.repeat(270_000) }
  assert.equal((await h.webhook(huge)).status, 413)
  assert.equal(h.store.saves, 0)
})

test('a signed provider annual access period binds the verified account and survives retries, restart and renewal', async t => {
  const h = await harness(t), session = await h.login()
  const first = h.event()
  await h.deliver(first)
  const account = h.service.authenticate(session.token)!
  assert.equal(account.adFree, true)
  assert.equal(account.source, 'purchase')
  assert.equal(account.expiresAt, first.data.current_period_end * 1000)
  assert.equal(account.plus?.provider, 'buymeacoffee')
  assert.equal(account.plus?.billingInterval, 'year')
  assert.equal(h.store.value.version, 2)
  assert.equal(h.store.value.bmcSubscriptions[0].accountId, account.id)
  await h.deliver({ ...first, event_id: 1002, attempt: 2 })
  assert.equal(h.store.value.plusAudit.length, 1, 'delivery retries deduplicate by the normalized event, not delivery attempt ID')
  const restarted = await new MembershipService(h.options).load()
  assert.equal(restarted.authenticate(session.token)?.expiresAt, account.expiresAt)
  await restarted.close()
  h.clock.now += 365 * DAY
  const renewal = h.event('membership.updated')
  await h.deliver(renewal)
  const renewed = await h.login()
  assert.equal(renewed.account.adFree, true)
  assert.equal(renewed.account.expiresAt, renewal.data.current_period_end * 1000)
  await h.deliver(first)
  assert.equal(h.service.authenticate(renewed.token)?.expiresAt, renewed.account.expiresAt)
})

test('one-dollar monthly access expires at its provider boundary and monthly periods cannot masquerade as annual', async t => {
  const h = await harness(t), session = await h.login()
  const monthly = h.event('membership.started', { duration_type: 'month', amount: 1, current_period_end: Math.floor((h.clock.now + 30 * DAY) / 1000) })
  await h.deliver(monthly)
  assert.equal(h.service.authenticate(session.token)?.plus?.billingInterval, 'month')
  assert.equal(h.service.authenticate(session.token)?.expiresAt, h.clock.now + 30 * DAY)
  h.clock.now += 30 * DAY
  const expired = await h.login()
  assert.equal(expired.account.adFree, false)
  assert.equal(expired.account.plus?.status, 'expired')
  for (const fields of [
    { id: 502, duration_type: 'year', current_period_end: Math.floor((h.clock.now + 30 * DAY) / 1000) },
    { id: 503, duration_type: 'month', current_period_end: Math.floor((h.clock.now + 365 * DAY) / 1000) },
  ]) {
    await h.deliver(h.event('membership.started', fields))
  }
  assert.equal(h.service.authenticate(expired.token)?.adFree, false)
})

test('period-end cancellation retains the current access only; older and equal-time active deliveries cannot undo it', async t => {
  const h = await harness(t), session = await h.login(), first = h.event()
  await h.deliver(first)
  h.clock.now += 1_000
  await h.deliver(h.event('membership.cancelled', { ...first.data, status: 'canceled', canceled: 'true', cancel_at_period_end: 'true' }))
  assert.equal(h.service.authenticate(session.token)?.plus?.status, 'cancelling')
  assert.equal(h.service.authenticate(session.token)?.expiresAt, first.data.current_period_end * 1000)
  await h.deliver(first)
  await h.deliver(h.event('membership.updated', { ...first.data }))
  assert.equal(h.service.authenticate(session.token)?.plus?.status, 'cancelling')
  h.clock.now = first.data.current_period_end * 1000
  assert.equal((await h.login()).account.adFree, false)
})

test('immediate cancellation or pause cuts access rather than keeping a newly advanced unpaid-looking annual period', async t => {
  for (const type of ['membership.cancelled', 'membership.paused']) {
    const h = await harness(t), session = await h.login(), first = h.event()
    await h.deliver(first)
    h.clock.now += 1_000
    const changed = h.event(type, { status: type.endsWith('paused') ? 'paused' : 'canceled', canceled: 'true', paused: type.endsWith('paused') ? 'true' : 'false',
      canceled_at: Math.floor(h.clock.now / 1000), cancel_at_period_end: 'false' })
    await h.deliver(changed)
    assert.equal(h.service.authenticate(session.token)?.adFree, false)
    assert.ok(h.service.authenticate(session.token)!.expiresAt! <= h.clock.now)
    await h.deliver(first)
    assert.equal(h.service.authenticate(session.token)?.adFree, false)
  }
})

test('signed configured-level access supports localized currency, higher contributions and provider price adjustments', async t => {
  const h = await harness(t), session = await h.login()
  const variants = [{ currency: 'EUR', amount: 9.4 }, { currency: 'GBP', amount: 7.8 },
    { currency: 'JPY', amount: 1500 }, { currency: 'USD', amount: 20 }, { currency: 'USD', amount: 9.99 }]
  for (const [index, fields] of variants.entries()) {
    const event = h.event('membership.started', { ...fields, id: 600 + index })
    await h.deliver(event)
    const receipt = h.store.value.bmcSubscriptions.find((record: { id: string }) => record.id === String(600 + index))
    assert.equal(receipt?.eligible, true, `${fields.currency} ${fields.amount} belongs to the approved provider level`)
    assert.equal(receipt?.expiresAt, event.data.current_period_end * 1000)
  }
  assert.equal(h.service.authenticate(session.token)?.adFree, true)
  assert.equal(h.store.value.bmcSubscriptions.length, variants.length)
})

test('an explicit signed BMC giveaway grants its exact five-year expiry only after matching email proof and survives restart', async t => {
  const h = await harness(t)
  // Synthetic identity with the timing and explicit duration observed in the
  // provider's real giveaway envelope; no live receipt or signing key is replayed.
  h.clock.now = 1_794_796_996_000
  const giveaway = h.event('membership.started', { duration_type: 'lifetime-giveaway', amount: 0,
    current_period_start: 1_794_796_994, current_period_end: 1_952_563_394 })
  await h.deliver({ ...giveaway, live_mode: false })
  assert.equal(h.store.value.bmcSubscriptions.length, 0)
  await h.deliver(giveaway)
  assert.equal(h.store.value.bmcSubscriptions[0].id, 'giveaway:501')
  assert.equal(h.store.value.bmcSubscriptions[0].accountId, null)
  const other = await h.login('other@example.test')
  assert.equal(other.account.adFree, false)
  const session = await h.login()
  const response = await h.call('/api/membership/me', undefined, session.token)
  assert.equal(response.status, 200)
  const { account } = await response.json() as any
  assert.equal(account.adFree, true)
  assert.equal(account.source, 'gift')
  assert.equal(account.expiresAt, 1_952_563_394_000)
  assert.equal(account.plus.provider, 'buymeacoffee')
  assert.equal(account.plus.complimentary, true)
  assert.equal(account.plus.billingInterval, undefined)
  await h.deliver({ ...giveaway, event_id: 1002, attempt: 2 })
  assert.equal(h.store.value.bmcSubscriptions.length, 1)
  const restarted = await new MembershipService(h.options).load()
  assert.equal(restarted.authenticate(session.token)?.expiresAt, account.expiresAt)
  assert.equal(restarted.authenticate(session.token)?.source, 'gift')
  await restarted.close()
  h.clock.now = account.expiresAt
  assert.equal((await h.login()).account.adFree, false)
})

test('giveaways require the explicit marker, zero amount, configured level and positive period of at most five calendar years', async t => {
  const h = await harness(t), session = await h.login()
  const end = new Date(h.clock.now); end.setUTCFullYear(end.getUTCFullYear() + 5)
  const base = { duration_type: 'lifetime-giveaway', amount: 0, current_period_end: Math.floor(end.getTime() / 1000) }
  const invalid = [{ amount: 1 }, { amount: -1 }, { amount: '0' }, { amount: null }, { membership_level_id: 78 },
    { duration_type: 'year' }, { duration_type: 'month' }, { duration_type: 'giveaway' }, { currency: 'EURO' },
    { current_period_end: base.current_period_end + 1 }, { current_period_end: Math.floor(h.clock.now / 1000) },
    { current_period_start: Math.floor(h.clock.now / 1000) + 301 }]
  for (const fields of invalid) await h.deliver(h.event('membership.started', { ...base, ...fields }))
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  assert.equal(h.store.value.bmcSubscriptions.length, 0)
  await h.deliver(h.event('membership.started', base))
  assert.equal(h.service.authenticate(session.token)?.adFree, true)
})

test('giveaway and paid numeric IDs cannot collide; owner revocation stays separate and cannot remove a manual courtesy grant', async t => {
  const h = await harness(t), session = await h.login(), paid = h.event()
  await h.deliver(paid)
  const end = new Date(h.clock.now); end.setUTCFullYear(end.getUTCFullYear() + 5)
  const gift = h.event('membership.started', { duration_type: 'lifetime-giveaway', amount: 0, current_period_end: Math.floor(end.getTime() / 1000) })
  await h.deliver(gift)
  assert.deepEqual(h.store.value.bmcSubscriptions.map((record: { id: string }) => record.id).sort(), ['501', 'giveaway:501'])
  assert.equal(h.service.authenticate(session.token)?.source, 'gift')
  const revoke = await h.call('/api/admin/plus/revoke', { subscriptionId: 'giveaway:501', reason: 'provider_correction' }, ADMIN, true)
  assert.equal(revoke.status, 200)
  assert.equal(h.service.authenticate(session.token)?.source, 'purchase')
  assert.equal(h.service.authenticate(session.token)?.expiresAt, paid.data.current_period_end * 1000)
  h.clock.now += 1_000
  await h.deliver(h.event('membership.updated', { ...gift.data }))
  assert.equal(h.service.authenticate(session.token)?.source, 'purchase')
  await h.service.grant('ana@example.test', null)
  await h.service.revokePlus('501', 'refund')
  assert.equal(h.service.authenticate(session.token)?.adFree, true)
  assert.equal(h.service.authenticate(session.token)?.plus?.provider, 'gift')
  assert.equal(h.service.authenticate(session.token)?.expiresAt, null)
  assert.ok(h.store.value.plusAudit.some((entry: { kind: string; subscriptionId: string }) => entry.kind === 'owner_revoke' && entry.subscriptionId === 'giveaway:501'))
  const restarted = await new MembershipService(h.options).load()
  assert.equal(restarted.authenticate(session.token)?.plus?.provider, 'gift')
  await restarted.close()
})

test('giveaway cancellation preserves event ordering and cannot extend its accepted expiry or transfer ownership', async t => {
  const h = await harness(t), session = await h.login(), other = await h.login('other@example.test')
  const end = new Date(h.clock.now); end.setUTCFullYear(end.getUTCFullYear() + 5)
  const gift = h.event('membership.started', { duration_type: 'lifetime-giveaway', amount: 0, current_period_end: Math.floor(end.getTime() / 1000) })
  await h.deliver(gift)
  h.clock.now += 1_000
  await h.deliver(h.event('membership.updated', { ...gift.data, supporter_email: 'other@example.test' }))
  assert.equal(h.service.authenticate(other.token)?.adFree, false)
  h.clock.now += 1_000
  await h.deliver(h.event('membership.cancelled', { ...gift.data, status: 'canceled', canceled: 'true', cancel_at_period_end: 'true', current_period_end: gift.data.current_period_end + DAY / 1000 }))
  assert.equal(h.service.authenticate(session.token)?.expiresAt, gift.data.current_period_end * 1000)
  await h.deliver(h.event('membership.updated', { ...gift.data }))
  assert.equal(h.service.authenticate(session.token)?.plus?.status, 'cancelling')
  h.clock.now += 1_000
  await h.deliver(h.event('membership.cancelled', { ...gift.data, status: 'canceled', canceled: 'true', cancel_at_period_end: 'false', canceled_at: Math.floor(h.clock.now / 1000) }))
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  await h.deliver(gift)
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
})

test('an ambiguous duration cannot cancel or modify a giveaway or a paid record with the same provider ID', async t => {
  for (const withPaid of [false, true]) {
    const h = await harness(t); await h.login()
    const end = new Date(h.clock.now); end.setUTCFullYear(end.getUTCFullYear() + 5)
    await h.deliver(h.event('membership.started', { duration_type: 'lifetime-giveaway', amount: 0, current_period_end: Math.floor(end.getTime() / 1000) }))
    if (withPaid) await h.deliver(h.event())
    const before = structuredClone(h.store.value), saves = h.store.saves
    h.clock.now += 1_000
    for (const duration_type of [undefined, 'unknown-giveaway']) {
      const response = await h.webhook(h.event('membership.cancelled', { duration_type, canceled: 'true', status: 'canceled' }))
      assert.equal(response.status, 409)
      assert.deepEqual(await response.json(), { error: 'ambiguous_membership' })
      assert.equal(h.store.saves, saves)
      assert.deepEqual(h.store.value, before)
    }
  }
})

test('an explicit giveaway pause cuts access immediately even at period end while paid cancellation policy stays unchanged', async t => {
  for (const giveaway of [false, true]) {
    const h = await harness(t), session = await h.login()
    const end = new Date(h.clock.now); end.setUTCFullYear(end.getUTCFullYear() + 5)
    const first = h.event('membership.started', giveaway ? { duration_type: 'lifetime-giveaway', amount: 0, current_period_end: Math.floor(end.getTime() / 1000) } : {})
    await h.deliver(first)
    h.clock.now += 1_000
    await h.deliver(h.event('membership.paused', { ...first.data, paused: 'true', status: 'paused', cancel_at_period_end: 'true' }))
    assert.equal(h.service.authenticate(session.token)?.adFree, !giveaway)
    assert.equal(h.service.authenticate(session.token)?.expiresAt, giveaway ? h.clock.now : first.data.current_period_end * 1000)
    await h.deliver(first)
    assert.equal(h.service.authenticate(session.token)?.adFree, !giveaway)
  }
})

test('owner recovery imports only an attested giveaway into the same provider record with a distinct audit and no manual grant', async t => {
  const h = await harness(t), session = await h.login()
  const end = new Date(h.clock.now); end.setUTCFullYear(end.getUTCFullYear() + 5)
  const event = h.event('membership.started', { duration_type: 'lifetime-giveaway', amount: 0, current_period_end: Math.floor(end.getTime() / 1000), support_note: 'private-note-not-retained' })
  h.clock.now += DAY
  const payload = { event, reason: 'provider_delivery_recovery' }
  const path = '/api/admin/plus/giveaways/import'
  for (const token of [undefined, session.token]) assert.equal((await h.call(path, payload, token, true)).status, 401)
  assert.equal((await h.call(path, payload, ADMIN)).status, 403)
  assert.equal(h.store.value.bmcSubscriptions.length, 0)
  const response = await h.call(path, payload, ADMIN, true)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { ok: true, subscriptionId: 'giveaway:501', imported: true })
  assert.equal(h.service.authenticate(session.token)?.source, 'gift')
  assert.equal(h.service.authenticate(session.token)?.expiresAt, event.data.current_period_end * 1000)
  assert.equal(h.store.value.grants.length, 0)
  assert.deepEqual(h.store.value.plusAudit.map((entry: { kind: string; reason: string }) => [entry.kind, entry.reason]), [['owner_import', 'provider_delivery_recovery']])
  assert.deepEqual(h.store.value.manualPlusAudit.map(({ id, ...entry }: { id: string }) => entry), [
    { actorAccountId: null, at: h.clock.now, action: 'giveaway_imported', email: session.account.email, subscriptionId: 'giveaway:501',
      reason: 'provider_delivery_recovery', before: null, after: { active: true, expiresAt: event.data.current_period_end * 1000 } },
  ])
  assert.ok(!JSON.stringify(h.store.value).includes('private-note-not-retained'))
  const duplicate = await h.call(path, payload, ADMIN, true)
  assert.deepEqual(await duplicate.json(), { ok: true, subscriptionId: 'giveaway:501', imported: false })
  await h.deliver(event)
  assert.equal(h.store.value.plusAudit.length, 1)
  assert.equal(h.store.value.manualPlusAudit.length, 1, 'provider retries and updates never create extra manual history')
  h.clock.now += 1_000
  await h.deliver(h.event('membership.cancelled', { ...event.data, canceled: 'true', status: 'canceled', canceled_at: Math.floor(h.clock.now / 1000) }))
  assert.equal(h.service.authenticate(session.token)?.adFree, false, 'real provider cancellation affects the imported record')
  const stale = await h.call(path, payload, ADMIN, true)
  assert.deepEqual(await stale.json(), { ok: true, subscriptionId: 'giveaway:501', imported: false })
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  const restarted = await new MembershipService(h.options).load()
  assert.equal(restarted.authenticate(session.token)?.adFree, false)
  await restarted.close()
})

test('owner giveaway recovery rejects payments, test events, invalid or expired gifts, wrong reasons and unconfigured storage', async t => {
  const h = await harness(t), session = await h.login()
  const event = h.event('membership.started', { duration_type: 'lifetime-giveaway', amount: 0 })
  const path = '/api/admin/plus/giveaways/import', saves = h.store.saves
  const historicalStart = Math.floor((h.clock.now - 366 * DAY) / 1000)
  const expiredPeriod = { ...event, created: historicalStart + 1, data: { ...event.data,
    current_period_start: historicalStart, current_period_end: Math.floor((h.clock.now - DAY) / 1000) } }
  const invalid = [null, h.event(), { ...event, live_mode: false }, { ...event, type: 'membership.updated' },
    { ...event, data: { ...event.data, amount: 1 } }, { ...event, data: { ...event.data, membership_level_id: 78 } },
    { ...event, data: { ...event.data, paused: 'true' } }, { ...event, data: { ...event.data, cancel_at_period_end: 'true' } },
    { ...event, data: { ...event.data, current_period_end: Math.floor((h.clock.now - DAY) / 1000) } }, expiredPeriod,
    { ...event, data: { ...event.data, current_period_start: Math.floor(h.clock.now / 1000) + 1 } }]
  for (const value of invalid) {
    const response = await h.call(path, { event: value, reason: 'provider_delivery_recovery' }, ADMIN, true)
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_giveaway' })
  }
  assert.equal((await h.call(path, { event, reason: 'refund' }, ADMIN, true)).status, 400)
  assert.equal(h.store.saves, saves)
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  const unavailable = await harness(t, { durableStorage: false })
  assert.equal((await unavailable.call(path, { event, reason: 'provider_delivery_recovery' }, ADMIN, true)).status, 503)
  assert.equal(unavailable.store.saves, 0)
})

test('owner recovery cannot resurrect a giveaway tombstone or publish an unconfirmed durable import', async t => {
  const h = await harness(t), session = await h.login()
  const event = h.event('membership.started', { duration_type: 'lifetime-giveaway', amount: 0 })
  const path = '/api/admin/plus/giveaways/import', payload = { event, reason: 'provider_delivery_recovery' }
  await h.deliver(event)
  await h.service.revokePlus('giveaway:501', 'provider_correction')
  const response = await h.call(path, payload, ADMIN, true)
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: 'giveaway_revoked' })
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  const failing = await harness(t), other = await failing.login()
  failing.store.fail = true
  const failed = await failing.call(path, payload, ADMIN, true)
  assert.equal(failed.status, 503)
  assert.equal(failing.service.authenticate(other.token), null)
  assert.equal(failing.store.value.bmcSubscriptions.length, 0)
  assert.equal(failing.store.value.plusAudit.length, 0)
})

test('invalid tier, malformed currency, nonpositive amount, trial-length or overlong periods cannot grant access; email updates cannot transfer ownership', async t => {
  const h = await harness(t), ana = await h.login(), other = await h.login('other@example.test')
  const invalid = [{ membership_level_id: 78 }, { currency: 'EURO' }, { currency: 'US1' }, { currency: ' US' }, { currency: 123 },
    { amount: -1 }, { amount: 0 }, { amount: '10' }, { amount: null }, { amount: Number.POSITIVE_INFINITY }, { amount: Number.NaN }, { duration_type: 'week' },
    { current_period_end: Math.floor((h.clock.now + 7 * DAY) / 1000) }, { current_period_end: Math.floor((h.clock.now + 368 * DAY) / 1000) }]
  for (const fields of invalid) await h.deliver(h.event('membership.started', fields))
  assert.equal(h.service.authenticate(ana.token)?.adFree, false)
  const first = h.event(); await h.deliver(first)
  h.clock.now += 1_000
  await h.deliver(h.event('membership.updated', { ...first.data, supporter_email: 'other@example.test' }))
  assert.equal(h.service.authenticate(ana.token)?.adFree, true)
  assert.equal(h.service.authenticate(other.token)?.adFree, false)
  assert.equal(h.store.value.bmcSubscriptions[0].email, 'ana@example.test')
  h.clock.now += 1_000
  await h.deliver(h.event('membership.updated', { ...first.data, membership_level_id: 78 }))
  assert.equal(h.service.authenticate(ana.token)?.adFree, false)
})

test('receipts before signup remain unclaimed until the matching email is verified; donations and test events never grant Plus', async t => {
  const h = await harness(t)
  await h.deliver({ ...h.event(), live_mode: false })
  await h.deliver(h.event('donation.created', { object: 'donation' }))
  assert.equal(h.store.value.bmcSubscriptions.length, 0)
  await h.deliver(h.event())
  assert.equal(h.store.value.accounts.length, 0)
  assert.equal(h.store.value.bmcSubscriptions[0].accountId, null)
  const other = await h.login('other@example.test')
  assert.equal(other.account.adFree, false)
  await h.service.requestCode('ana@example.test', 'es', 'proof')
  assert.equal(h.store.value.bmcSubscriptions[0].accountId, null)
  const matching = await h.service.verifyCode('ana@example.test', h.inbox.get('ana@example.test')!, 'proof')
  assert.equal(matching.account.adFree, true)
  assert.equal(h.store.value.bmcSubscriptions[0].accountId, matching.account.id)
})

test('owner refund revocation is authenticated, audited and irreversible for that subscription even after future valid updates', async t => {
  const h = await harness(t), session = await h.login()
  await h.deliver(h.event())
  const expiresAt = h.service.authenticate(session.token)!.expiresAt
  const payload = { subscriptionId: '501', reason: 'refund' }
  assert.equal((await h.call('/api/admin/plus/subscriptions')).status, 401)
  assert.equal((await h.call('/api/admin/plus/revoke', payload, session.token, true)).status, 401)
  assert.equal((await h.call('/api/admin/plus/revoke', payload, ADMIN)).status, 403)
  assert.equal((await h.call('/api/admin/plus/revoke', payload, ADMIN, true)).status, 200)
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  const [change] = h.store.value.manualPlusAudit
  assert.equal(change.action, 'subscription_revoked')
  assert.deepEqual(change.before, { active: true, expiresAt })
  assert.deepEqual(change.after, { active: false, expiresAt: h.clock.now })
  const tombstone = h.store.value.bmcSubscriptions[0].revokedAt
  h.clock.now += 1_000
  await h.deliver(h.event('membership.updated'))
  assert.equal(h.service.authenticate(session.token)?.adFree, false)
  assert.equal(h.store.value.bmcSubscriptions[0].revokedAt, tombstone)
  const restarted = await new MembershipService(h.options).load()
  assert.equal(restarted.authenticate(session.token)?.adFree, false)
  await restarted.close()
  assert.equal(h.store.value.plusAudit.filter((a: any) => a.kind === 'owner_revoke').length, 1)
  await h.deliver(h.event('membership.started', { id: 502 }))
  assert.equal(h.service.authenticate(session.token)?.adFree, true, 'a separate new subscription may qualify without erasing the old tombstone')
})

test('gifts and legacy permanent purchases keep their rights independently of BMC cancellation or refund', async t => {
  const h = await harness(t), session = await h.login()
  await h.service.grant('ana@example.test', null)
  await h.deliver(h.event())
  assert.equal(h.service.authenticate(session.token)?.source, 'gift')
  assert.equal(h.service.authenticate(session.token)?.expiresAt, null)
  await h.service.revokePlus('501', 'refund')
  assert.equal(h.service.authenticate(session.token)?.adFree, true)
  assert.equal(h.service.authenticate(session.token)?.plus?.provider, 'gift')
  const saved = structuredClone(h.store.value)
  saved.orders.push({ id: 'legacy-order', accountId: session.account.id, priceId: 'price_legacy', amount: 499, currency: 'usd', createdAt: h.clock.now,
    sessionId: null, paymentIntentId: null, url: null, state: 'paid' })
  h.store.value = saved
  const restarted = await new MembershipService(h.options).load()
  assert.equal(restarted.authenticate(session.token)?.plus?.provider, 'legacy')
  assert.equal(restarted.authenticate(session.token)?.expiresAt, null)
  await restarted.close()
})

test('failed and ambiguous durable webhook saves never acknowledge or publish uncertain rights', async t => {
  for (const ambiguous of [false, true]) {
    const h = await harness(t), session = await h.login()
    h.store.fail = !ambiguous; h.store.ambiguous = ambiguous
    await assert.rejects(h.deliver(h.event()), /server_unavailable/)
    assert.equal(h.service.hasFailedOperation(), true)
    assert.equal(h.service.authenticate(session.token), null)
    h.store.fail = false; h.store.ambiguous = false
    const restarted = await new MembershipService(h.options).load()
    assert.equal(restarted.authenticate(session.token)?.adFree, ambiguous)
    await restarted.close()
  }
})

test('an unconfigured webhook and a non-durable store return 503 rather than acknowledging a lost live or test event', async t => {
  for (const missing of [{ secret: undefined }, { durableStorage: false }]) {
    const h = await harness(t, missing)
    for (const live_mode of [true, false]) {
      const response = await h.webhook({ ...h.event(), live_mode })
      assert.equal(response.status, 503)
      assert.ok(!JSON.stringify(await response.json()).includes(SIGNING))
    }
    assert.equal(h.store.saves, 0)
  }
})

test('minor amount units and a newer genuine interval switch preserve only the current provider period', async t => {
  const h = await harness(t, { amountUnits: 'minor' }), session = await h.login()
  await h.deliver(h.event('membership.started', { amount: 1000 }))
  assert.equal(h.service.authenticate(session.token)?.adFree, true)
  h.clock.now += DAY
  const monthly = h.event('membership.updated', { amount: 100, duration_type: 'month', current_period_end: Math.floor((h.clock.now + 30 * DAY) / 1000) })
  await h.deliver(monthly)
  assert.equal(h.service.authenticate(session.token)?.expiresAt, monthly.data.current_period_end * 1000)
  assert.equal(h.service.authenticate(session.token)?.plus?.billingInterval, 'month')
})

test('a qualified period-end cancellation delivered before start keeps remaining access and cannot be extended by cancellation', async t => {
  const h = await harness(t), session = await h.login(), first = h.event()
  await h.deliver(h.event('membership.cancelled', { ...first.data, canceled: 'true', status: 'canceled', cancel_at_period_end: 'true' }))
  assert.equal(h.service.authenticate(session.token)?.adFree, true)
  assert.equal(h.service.authenticate(session.token)?.plus?.status, 'cancelling')
  h.clock.now += 1_000
  await h.deliver(h.event('membership.cancelled', { canceled: 'true', status: 'canceled', cancel_at_period_end: 'true' }))
  assert.equal(h.service.authenticate(session.token)?.expiresAt, first.data.current_period_end * 1000)
})

test('corrupt Plus records and incomplete v2 snapshots refuse startup without overwriting legacy accounts', async t => {
  const h = await harness(t); await h.login(); await h.deliver(h.event())
  const valid = structuredClone(h.store.value)
  for (const corrupt of [
    { ...valid, bmcSubscriptions: undefined },
    { ...valid, bmcSubscriptions: [valid.bmcSubscriptions[0], valid.bmcSubscriptions[0]] },
    { ...valid, bmcSubscriptions: [{ ...valid.bmcSubscriptions[0], accountId: 'foreign-account' }] },
    { ...valid, bmcSubscriptions: [{ ...valid.bmcSubscriptions[0], revokedAt: -1 }] },
    { ...valid, bmcSubscriptions: [{ ...valid.bmcSubscriptions[0], interval: 'giveaway' }] },
    { ...valid, bmcSubscriptions: [{ ...valid.bmcSubscriptions[0], id: 'giveaway:501' }] },
  ]) {
    h.store.value = corrupt
    const before = h.store.saves
    await assert.rejects(new MembershipService(h.options).load(), /storage|Plus/)
    assert.equal(h.store.saves, before)
  }
  h.store.value = valid
})
