import assert from 'node:assert/strict'
import test from 'node:test'
import { readPlusOffer, safePlusProviderUrl } from '../src/lib/plusOffer.ts'

const offer = { enabled: true, purchaseEnabled: true, provider: 'buymeacoffee', annualAmount: 1000, billingInterval: 'year', currencies: ['usd'], prices: [{ amount: 1000, currency: 'usd' }], purchaseUrl: 'https://buymeacoffee.com/nrnplay/membership', manageUrl: 'https://www.buymeacoffee.com/dashboard/memberships', requiresMatchingEmail: true }
test('annual Plus offers expose only confirmed server currencies and never invent a euro equivalent', () => {
  assert.deepEqual(readPlusOffer(offer)?.prices, [{ amount: 1000, currency: 'usd' }])
  assert.equal(readPlusOffer(offer)?.purchaseEnabled, true)
  assert.equal(readPlusOffer({ ...offer, prices: [{ amount: 1000, currency: 'eur' }] })?.purchaseEnabled, false)
  assert.equal(readPlusOffer({ ...offer, prices: [{ amount: 499, currency: 'usd' }] })?.purchaseEnabled, false)
  assert.equal(readPlusOffer({ ...offer, billingInterval: 'month' }), null)
})
test('missing, disabled and malformed provider configuration cannot show a working purchase', () => {
  assert.equal(readPlusOffer(undefined), null)
  assert.equal(readPlusOffer({ ...offer, purchaseEnabled: false })?.purchaseEnabled, false)
  assert.equal(readPlusOffer({ ...offer, enabled: false })?.purchaseEnabled, false)
  assert.equal(readPlusOffer({ ...offer, purchaseUrl: null })?.purchaseEnabled, false)
  assert.equal(readPlusOffer({ ...offer, provider: 'unknown' })?.purchaseEnabled, false)
})
test('provider links reject untrusted hosts, credentials, ports and email in URLs', () => {
  for (const url of ['javascript:alert(1)', 'https://buymeacoffee.com.attacker.test/nrnplay', 'https://buymeacoffee.com@attacker.test/', 'https://buymeacoffee.com:8443/nrnplay', 'https://buymeacoffee.com/nrnplay?email=user@example.test']) {
    assert.equal(safePlusProviderUrl(url, 'buymeacoffee', 'purchase'), null)
  }
  assert.equal(safePlusProviderUrl('https://checkout.stripe.com/c/pay/example', 'stripe', 'purchase'), 'https://checkout.stripe.com/c/pay/example')
  assert.equal(safePlusProviderUrl('https://billing.stripe.com/p/session/example', 'stripe', 'manage'), 'https://billing.stripe.com/p/session/example')
  assert.equal(safePlusProviderUrl('https://checkout.stripe.com/c/pay/example', 'stripe', 'manage'), null)
})
