import test from 'node:test'
import assert from 'node:assert/strict'
import { confirmedGiveawayImport, giveawayImportCommand, plusRevokeCommand, readAdminPlus } from '../src/lib/adminPlus.ts'

const subscription = { id: '123456', email: 'member@example.test', accountId: null, expiresAt: 1_900_000_000_000, interval: 'year' as const, eligible: true, cancelAtPeriodEnd: false, revokedAt: null }
test('owner Plus list distinguishes valid empty history from malformed or duplicate records', () => {
  assert.deepEqual(readAdminPlus({ subscriptions: [], audit: [] }), { subscriptions: [], audit: [] })
  const snapshot = { subscriptions: [subscription], audit: [{ id: 'audit-1', at: 1_800_000_000_000, kind: 'owner_revoke', subscriptionId: '123456', reason: 'refund' }] }
  assert.deepEqual(readAdminPlus(snapshot), snapshot)
  assert.equal(readAdminPlus({ subscriptions: [subscription, subscription], audit: [] }), null)
  assert.equal(readAdminPlus({ subscriptions: [{ ...subscription, expiresAt: Infinity }], audit: [] }), null)
  assert.equal(readAdminPlus({ subscriptions: [], audit: [{ ...snapshot.audit[0], reason: 'unknown' }] }), null)
  assert.equal(readAdminPlus({ subscriptions: null, audit: [] }), null)
})
test('irreversible Plus revocation requires the selected subscription ID and a known reason', () => {
  assert.equal(plusRevokeCommand(subscription, '', 'refund'), null)
  assert.equal(plusRevokeCommand(subscription, '654321', 'refund'), null)
  assert.equal(plusRevokeCommand(subscription, subscription.id, 'other'), null)
  assert.equal(plusRevokeCommand({ ...subscription, revokedAt: 1 }, subscription.id, 'refund'), null)
  assert.deepEqual(plusRevokeCommand(subscription, ' 123456 ', 'refund'), { subscriptionId: '123456', reason: 'refund' })
  assert.deepEqual(plusRevokeCommand(subscription, subscription.id, 'dispute'), { subscriptionId: '123456', reason: 'dispute' })
})

test('provider giveaway namespaces remain separate from paid IDs and retain exact expiry and owner audit', () => {
  const gift = { ...subscription, id: 'giveaway:123456', interval: 'giveaway' as const, expiresAt: 1_952_569_394_000 }
  const snapshot = { subscriptions: [subscription, gift], audit: [{ id: 'recovery-1', at: 1_800_000_000_000, kind: 'owner_import', subscriptionId: gift.id, reason: 'provider_delivery_recovery' }] }
  assert.deepEqual(readAdminPlus(snapshot), snapshot)
  assert.equal(plusRevokeCommand(gift, '123456', 'provider_correction'), null)
  assert.deepEqual(plusRevokeCommand(gift, gift.id, 'provider_correction'), { subscriptionId: gift.id, reason: 'provider_correction' })
  for (const invalid of [{ ...gift, id: 'giveaway:0' }, { ...gift, interval: 'year' }, { ...subscription, interval: 'giveaway' }, { ...gift, id: 'giveaway:12345678901234567' }]) {
    assert.equal(readAdminPlus({ subscriptions: [invalid], audit: [] }), null)
  }
})

test('giveaway recovery prepares only valid JSON objects and accepts only explicit confirmed giveaway responses', () => {
  const event = { event_id: 123, type: 'membership.started', live_mode: true, data: { id: 456, duration_type: 'lifetime-giveaway', amount: 0 } }
  assert.deepEqual(giveawayImportCommand(JSON.stringify(event)), { event, reason: 'provider_delivery_recovery' })
  for (const raw of ['', '{broken', '[]', 'null', '12', 'x'.repeat(262_145)]) assert.equal(giveawayImportCommand(raw), null)
  assert.deepEqual(confirmedGiveawayImport({ ok: true, subscriptionId: 'giveaway:456', imported: true }), { subscriptionId: 'giveaway:456', imported: true })
  assert.deepEqual(confirmedGiveawayImport({ ok: true, subscriptionId: 'giveaway:456', imported: false }), { subscriptionId: 'giveaway:456', imported: false })
  for (const response of [{ ok: false, subscriptionId: 'giveaway:456', imported: true }, { ok: true, subscriptionId: '456', imported: true }, { ok: true, subscriptionId: 'giveaway:456' }, null]) assert.equal(confirmedGiveawayImport(response), null)
})
