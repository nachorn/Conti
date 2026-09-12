import assert from 'node:assert/strict'
import test from 'node:test'
import { isStripeCheckoutUrl, MEMBERSHIP_STORAGE_KEY, readMembershipSession, saveMembershipSession, type MembershipStorage } from '../src/lib/membershipSession.ts'

function storage(): MembershipStorage {
  const data = new Map<string, string>()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}
const credentials = { token: 'private-session-token-at-least-32-characters', expiresAt: 2000 }

test('membership stores credentials and strips cached entitlement/account data', () => {
  const store = storage()
  saveMembershipSession(store, { ...credentials, account: { email: 'person@example.com', adFree: true } } as typeof credentials)
  assert.deepEqual(JSON.parse(store.getItem(MEMBERSHIP_STORAGE_KEY)!), credentials)
  assert.deepEqual(readMembershipSession(store, 1000), credentials)
  saveMembershipSession(store, null)
  assert.equal(readMembershipSession(store, 1000), null)
})

test('expired, corrupted, or short credentials are never restored', () => {
  const store = storage()
  for (const value of ['{broken', JSON.stringify({ ...credentials, token: 'short' }), JSON.stringify({ ...credentials, expiresAt: 999 }), JSON.stringify({ ...credentials, expiresAt: '2099' })]) {
    store.setItem(MEMBERSHIP_STORAGE_KEY, value)
    assert.equal(readMembershipSession(store, 1000), null)
  }
  assert.equal(saveMembershipSession(null, credentials), false)
  assert.equal(readMembershipSession(null), null)
})

test('checkout only navigates to authenticated Stripe checkout hosts', () => {
  assert.equal(isStripeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test'), true)
  for (const value of ['javascript:alert(1)', 'http://checkout.stripe.com/test', 'https://checkout.stripe.com.evil.example/', 'https://evil.example/?stripe=checkout.stripe.com', 'https://account@checkout.stripe.com/', null]) {
    assert.equal(isStripeCheckoutUrl(value), false)
  }
})
