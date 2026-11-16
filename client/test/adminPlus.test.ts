import test from 'node:test'
import assert from 'node:assert/strict'
import { plusRevokeCommand, readAdminPlus } from '../src/lib/adminPlus.ts'

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
