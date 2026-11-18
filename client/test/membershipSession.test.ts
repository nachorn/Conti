import assert from 'node:assert/strict'
import test from 'node:test'
import { isMembershipSession, isPortalMembershipSession, isStripeCheckoutUrl, MEMBERSHIP_STORAGE_KEY, readMembershipSession, saveMembershipSession, type MembershipStorage } from '../src/lib/membershipSession.ts'
import { accountCookieHeader, accountHeaders, cookieAccountKey } from '../src/lib/accountTransport.ts'

function storage(): MembershipStorage {
  const data = new Map<string, string>()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value) }, removeItem: key => { data.delete(key) } }
}
const credentials = { token: 'private-session-token-at-least-32-characters', expiresAt: 2000 }

test('only complete, unexpired sign-in responses can become account sessions', () => {
  const valid = { token: 'a'.repeat(43), expiresAt: 2000, account: { id: 'account-1', email: 'ana@example.com', name: 'Ana', hasPassword: true, adFree: false, source: null, expiresAt: null } }
  assert.equal(isMembershipSession(valid, 1000), true)
  assert.equal(isMembershipSession({ ...valid, account: { ...valid.account, name: undefined, hasPassword: undefined } }, 1000), true, 'legacy email-code accounts remain valid')
  for (const invalid of [null, {}, { ...valid, token: 'short' }, { ...valid, expiresAt: 999 }, { ...valid, account: null },
    { ...valid, account: { ...valid.account, email: '' } }, { ...valid, account: { ...valid.account, adFree: 'yes' } },
    { ...valid, account: { ...valid.account, name: ' ' } }, { ...valid, account: { ...valid.account, hasPassword: 'yes' } }]) {
    assert.equal(isMembershipSession(invalid, 1000), false)
  }
})

test('membership stores credentials and strips cached entitlement/account data', () => {
  const store = storage()
  saveMembershipSession(store, { ...credentials, account: { email: 'person@example.com', adFree: true } } as typeof credentials)
  assert.deepEqual(JSON.parse(store.getItem(MEMBERSHIP_STORAGE_KEY)!), credentials)
  assert.deepEqual(readMembershipSession(store, 1000), credentials)
  saveMembershipSession(store, null)
  assert.equal(readMembershipSession(store, 1000), null)
})

test('an HttpOnly session response has a view key and never passes a bearer token to JS', () => {
  const valid = { session: 'cookie', sessionKey: 's'.repeat(22), expiresAt: 2000,
    account: { id: '1', email: 'ana@example.com', adFree: true, source: 'gift', expiresAt: null } }
  assert.equal(isPortalMembershipSession(valid, 1000), true)
  assert.equal(isMembershipSession(valid, 1000), false)
  assert.equal(isPortalMembershipSession({ ...valid, token: 't'.repeat(43) }, 1000), false)
  assert.equal(isPortalMembershipSession({ ...valid, sessionKey: 'short' }, 1000), false)
  assert.deepEqual(accountHeaders(cookieAccountKey(valid.sessionKey), true), { 'X-NRN-Portal': '1' })
  assert.deepEqual(accountHeaders(cookieAccountKey(valid.sessionKey), false), {})
  assert.equal(accountCookieHeader('https://nrnplay.com'), '1')
  assert.equal(accountCookieHeader('https://conti.nrnplay.com'), 'conti')
  assert.equal(accountCookieHeader('https://pocha.nrnplay.com'), 'pocha')
  assert.equal(accountCookieHeader('https://football.nrnplay.com'), null)
  assert.equal(accountCookieHeader('https://nrnplay.com.invalid'), null)
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
