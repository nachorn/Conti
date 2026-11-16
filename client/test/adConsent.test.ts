import assert from 'node:assert/strict'
import test from 'node:test'
import { acquireAdConsent, adConsentConfigured, consentAllowsAds, type AdConsentData, type AdTcfApi } from '../src/lib/adConsent.ts'
import { playStartAd } from '../src/lib/adProvider.ts'
const noChanges = (_listener: () => void) => () => {}

test('advertising consent integration stays disabled unless both deployment flags opt in', () => {
  assert.equal(adConsentConfigured({}), false)
  assert.equal(adConsentConfigured({ VITE_ADS_CONSENT_READY: 'true', VITE_ADS_CMP: 'disabled' }), false)
  assert.equal(adConsentConfigured({ VITE_ADS_CONSENT_READY: 'false', VITE_ADS_CMP: 'external' }), false)
  assert.equal(adConsentConfigured({ VITE_ADS_CONSENT_READY: 'true', VITE_ADS_CMP: 'external' }), true)
})

test('TCF permission fails closed for absent, pending, denied or incomplete signals', () => {
  const allowed = { cmpStatus: 'loaded', eventStatus: 'useractioncomplete', gdprApplies: true, tcString: 'valid-cmp-string', vendor: { consents: { 755: true } }, purpose: { consents: { 1: true, 3: true, 4: true } } }
  assert.equal(consentAllowsAds(allowed, true), true)
  assert.equal(consentAllowsAds(allowed, false), false)
  assert.equal(consentAllowsAds({}, true), false)
  assert.equal(consentAllowsAds({ ...allowed, cmpStatus: 'loading' }, true), false)
  assert.equal(consentAllowsAds({ ...allowed, eventStatus: 'cmpuishown' }, true), false)
  assert.equal(consentAllowsAds({ ...allowed, gdprApplies: undefined }, true), false)
  assert.equal(consentAllowsAds({ ...allowed, tcString: '' }, true), false)
  assert.equal(consentAllowsAds({ ...allowed, vendor: { consents: { 755: false } } }, true), false)
  for (const id of [1, 3, 4]) assert.equal(consentAllowsAds({ ...allowed, purpose: { consents: { ...allowed.purpose.consents, [id]: false } } }, true), false)
  assert.equal(consentAllowsAds({ cmpStatus: 'loaded', eventStatus: 'tcloaded', gdprApplies: false }, true), true)
  assert.equal(consentAllowsAds({ ...allowed, gdprApplies: false, vendor: { consents: { 755: false } } }, true), false)
})

test('an unconfigured CMP skips advertising without creating a browser or loading an SDK', async () => {
  assert.equal(await playStartAd('ca-pub-1234567890123456', () => {}), 'privacy')
})

test('a CMP listener retains revocation through playback and is removed after closing', async () => {
  let listener: ((data: AdConsentData, success: boolean) => void) | undefined
  const removed: number[] = []
  const states: boolean[] = []
  const api = ((command: string, _version: number, callback: typeof listener, id?: number) => {
    if (command === 'addEventListener') {
      listener = callback
      listener!({ listenerId: 17, cmpStatus: 'loaded', eventStatus: 'tcloaded', gdprApplies: false }, true)
    } else removed.push(id!)
  }) as AdTcfApi
  const session = await acquireAdConsent(allowed => states.push(allowed), undefined, { configured: true, api, preferencesAvailable: true, siteAllowsAds: () => true, subscribeChanges: noChanges })
  assert.equal(session?.allowed(), true)
  listener!({ listenerId: 17, cmpStatus: 'loaded', eventStatus: 'useractioncomplete', gdprApplies: true, tcString: 'denied' }, true)
  assert.equal(session?.allowed(), false)
  assert.deepEqual(states, [true, false])
  session?.close()
  assert.deepEqual(removed, [17])
})

test('declining consent closes the listener; missing preferences cannot start any consent or ad request', async () => {
  let subscriptions = 0
  let removals = 0
  const api = ((command: string, _version: number, callback: (data: AdConsentData, success: boolean) => void) => {
    if (command === 'addEventListener') { ++subscriptions; callback({ listenerId: 9, cmpStatus: 'loaded', eventStatus: 'useractioncomplete', gdprApplies: true }, true) }
    else ++removals
  }) as AdTcfApi
  assert.equal(await acquireAdConsent(() => {}, undefined, { configured: true, api, preferencesAvailable: false, siteAllowsAds: () => true, subscribeChanges: noChanges }), null)
  assert.equal(subscriptions, 0)
  assert.equal(await acquireAdConsent(() => {}, undefined, { configured: true, api, preferencesAvailable: true, siteAllowsAds: () => true, subscribeChanges: noChanges }), null)
  assert.equal(subscriptions, 1)
  assert.equal(removals, 1)
})

test('a non-GDPR TCF result cannot bypass the CMP regional privacy decision or its failure', async () => {
  const api = ((command: string, _version: number, callback: (data: AdConsentData, success: boolean) => void) => {
    if (command === 'addEventListener') callback({ listenerId: 11, cmpStatus: 'loaded', eventStatus: 'tcloaded', gdprApplies: false }, true)
  }) as AdTcfApi
  for (const siteAllowsAds of [() => false, () => { throw new Error('CMP unavailable') }]) {
    assert.equal(await acquireAdConsent(() => {}, undefined, { configured: true, api, preferencesAvailable: true, siteAllowsAds, subscribeChanges: noChanges }), null)
  }
})


test('regional withdrawal is rechecked without TCF events and its subscription pauses active requests', async () => {
  let permitted = true
  let changed: (() => void) | undefined
  let unsubscribed = 0
  const states: boolean[] = []
  const api = ((command: string, _version: number, callback: (data: AdConsentData, success: boolean) => void) => {
    if (command === 'addEventListener') callback({ listenerId: 31, cmpStatus: 'loaded', eventStatus: 'tcloaded', gdprApplies: false }, true)
  }) as AdTcfApi
  const session = await acquireAdConsent(value => states.push(value), undefined, {
    configured: true, api, preferencesAvailable: true, siteAllowsAds: () => permitted,
    subscribeChanges: listener => { changed = listener; return () => { ++unsubscribed } },
  })
  assert.equal(session?.allowed(), true)
  permitted = false
  assert.equal(session?.allowed(), false)
  changed!()
  assert.deepEqual(states, [true, false])
  session?.close()
  assert.equal(unsubscribed, 1)
})
