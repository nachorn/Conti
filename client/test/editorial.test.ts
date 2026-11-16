import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { BASELINE_EDITORIAL_CSP, createEditorialHandler, editorialAdConfig } from '../api/editorial.js'
import { consentAllowsAds } from '../src/lib/adConsent.ts'
import { GUIDE_MEMBERSHIP_KEY, guideConsentAllowsAds, startGuideAdvertising, verifyGuideVisitor } from '../public/ads/guide.js'

const publicRoot = fileURLToPath(new URL('../public/learn/', import.meta.url))
const approved = { EDITORIAL_ADS_ENABLED: 'true', EDITORIAL_ADS_APPROVED: 'true', EDITORIAL_ADS_CONSENT_READY: 'true', EDITORIAL_ADS_CSP_REVIEWED: 'true', EDITORIAL_ADS_CMP: 'external', EDITORIAL_ADS_CLIENT: 'ca-pub-1234567890123456', EDITORIAL_ADS_SLOT: '1234567890', EDITORIAL_ADS_CMP_SCRIPT_URL: 'https://cmp.example.test/loader.js', EDITORIAL_ADS_ALLOWED_HOSTS: 'nrnplay.com', EDITORIAL_ADS_RESOURCE_ORIGINS: 'https://pagead2.googlesyndication.com,https://googleads.g.doubleclick.net' }
function output() {
  const result = { status: 0, headers: {} as Record<string, string>, body: '' }
  const res = { setHeader: (key: string, value: string) => { result.headers[key] = value }, status: (value: number) => { result.status = value; return res }, end: (body = '') => { result.body = body } }
  return { res, result }
}
const request = (query = { lang: 'es', game: 'continental' }) => ({ method: 'GET', headers: { host: 'nrnplay.com' }, query })

test('editorial routes are exact and leave the restrictive private/global policy intact', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'))
  const route = config.routes[0]
  assert.equal(route.src, '^/learn/(es|en)/(continental|pocha)/?$')
  assert.equal(route.dest, '/api/editorial?lang=$1&game=$2')
  assert.equal(route.continue, undefined)
  const regex = new RegExp(route.src)
  for (const lang of ['es', 'en']) for (const game of ['continental', 'pocha']) assert.equal(regex.test(`/learn/${lang}/${game}/`), true)
  for (const path of ['/account', '/dashboard', '/connect', '/game', '/room/1234', '/learn/en/about/', '/learn/en/help/', '/learn/en/continental/../../dashboard', '/learn/en/continental/index.html']) assert.equal(regex.test(path), false)
  const global = config.routes.find((entry: { src: string }) => entry.src === '/(.*)')
  assert.equal(global.headers['Content-Security-Policy'], BASELINE_EDITORIAL_CSP)
  assert.equal(global.continue, true)
  assert.equal(config.functions['api/editorial.js'].includeFiles, 'public/learn/**')
})

test('all four static guides have a single hidden unit after the worked example, outside navigation', async () => {
  const handler = createEditorialHandler({ env: {}, publicRoot })
  for (const lang of ['es', 'en']) for (const game of ['continental', 'pocha']) {
    const { res, result } = output()
    await handler(request({ lang, game }), res)
    assert.equal(result.status, 200)
    assert.equal(result.headers['Content-Security-Policy'], BASELINE_EDITORIAL_CSP)
    assert.equal(result.headers['X-Frame-Options'], 'DENY')
    assert.equal(result.headers['Vercel-CDN-Cache-Control'], 'no-store')
    assert.equal((result.body.match(/data-nrn-guide-ad/g) || []).length, 1)
    assert.match(result.body, /<aside class="nrn-guide-ad" data-nrn-guide-ad hidden/)
    assert.match(result.body, new RegExp(`id="${lang === 'es' ? 'ejemplo' : 'example'}" class="example">[\\s\\S]*?</section>\\s*<aside class="nrn-guide-ad"`))
    assert.match(result.body, lang === 'es' ? /aria-label="Publicidad"/ : /aria-label="Advertisement"/)
    assert.doesNotMatch(result.body, /nrn-guide-ad-enabled|googlesyndication|nonce=/)
  }
})

test('traversal, arrays, unknown files and write requests never reach the filesystem', async () => {
  let reads = 0
  const handler = createEditorialHandler({ env: approved, load: async () => { reads++; return '' } })
  for (const query of [{ lang: '..', game: 'continental' }, { lang: 'en', game: '../../.env' }, { lang: 'en', game: 'help' }, { lang: ['en', 'es'], game: 'pocha' }, { lang: 'en%2f..', game: 'pocha' }]) {
    const { res, result } = output(); await handler({ ...request(), query }, res); assert.equal(result.status, 404)
  }
  const { res, result } = output(); await handler({ ...request(), method: 'POST' }, res); assert.equal(result.status, 405)
  assert.equal(reads, 0)
})

test('query flags cannot activate ads and every pilot prerequisite fails closed', async () => {
  for (const key of Object.keys(approved)) assert.equal(editorialAdConfig({ ...approved, [key]: '' }, 'nrnplay.com'), null, key)
  assert.equal(editorialAdConfig(approved, 'unapproved.invalid'), null)
  assert.equal(editorialAdConfig({ ...approved, EDITORIAL_ADS_RESOURCE_ORIGINS: 'https:' }, 'nrnplay.com'), null)
  assert.equal(editorialAdConfig({ ...approved, EDITORIAL_ADS_CMP_SCRIPT_URL: 'javascript:bad()' }, 'nrnplay.com'), null)
  const { res, result } = output()
  await createEditorialHandler({ env: {}, publicRoot })({ ...request(), query: { ...request().query, enabled: 'true', ...approved } }, res)
  assert.doesNotMatch(result.body, /nrn-guide-ad-enabled|nonce=/)
})

test('approved pilot generates fresh matching script nonces and never permits inline scripts or shared caching', async () => {
  const handler = createEditorialHandler({ env: approved, publicRoot })
  const values: string[] = []
  for (let index = 0; index < 2; index++) {
    const { res, result } = output(); await handler(request(), res)
    assert.equal(result.status, 200)
    const nonce = /name="nrn-guide-ad-nonce" content="([^"]+)"/.exec(result.body)![1]
    values.push(nonce)
    assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/)
    const scripts = [...result.body.matchAll(/<script\b([^>]*)>/g)]
    assert.equal(scripts.length, 2)
    for (const script of scripts) assert.ok(script[1].includes(`nonce="${nonce}"`))
    assert.ok(result.body.indexOf('https://cmp.example.test/loader.js') < result.body.indexOf('src="/ads/guide.js"'))
    const scriptPolicy = result.headers['Content-Security-Policy'].split(';').find(value => value.trim().startsWith('script-src '))!
    assert.ok(scriptPolicy.includes(`'nonce-${nonce}'`)); assert.ok(scriptPolicy.includes("'strict-dynamic'"))
    assert.doesNotMatch(scriptPolicy, /unsafe-inline|https:|http:/)
    assert.equal(result.headers['Cache-Control'], 'private, no-store')
  }
  assert.notEqual(values[0], values[1])
})

test('guide consent matches the existing conservative TCF gate and independently requires the regional bridge', () => {
  const valid = { cmpStatus: 'loaded', eventStatus: 'useractioncomplete', gdprApplies: true, tcString: 'real-cmp-value', vendor: { consents: { 755: true } }, purpose: { consents: { 1: true, 3: true, 4: true } } }
  for (const data of [valid, { ...valid, gdprApplies: false }, { ...valid, cmpStatus: 'loading' }, { ...valid, tcString: '' }, { ...valid, gdprApplies: undefined }, { ...valid, purpose: { consents: { 1: true, 3: false, 4: true } } }, { ...valid, gdprApplies: false, vendor: { consents: { 755: false } } }]) {
    assert.equal(guideConsentAllowsAds(data, true, true), consentAllowsAds(data, true))
    assert.equal(guideConsentAllowsAds(data, true, false), false)
  }
})

test('guide account checks suppress verified Plus, forged local entitlements and network/storage uncertainty', async () => {
  const now = Date.now(); let raw: string | null = null
  const storage = { getItem: (key: string) => { assert.equal(key, GUIDE_MEMBERSHIP_KEY); return raw } }
  const headers: unknown[] = []
  const fetch = async (_url: string, options: unknown) => { headers.push(options); return new Response(JSON.stringify({ account: { id: 'server-account', adFree: false }, expiresAt: now + 1000 })) }
  assert.equal(await verifyGuideVisitor({ storage, fetch }), true); assert.equal(headers.length, 0)
  raw = JSON.stringify({ token: 't'.repeat(43), expiresAt: now + 100000, account: { adFree: true } })
  assert.equal(await verifyGuideVisitor({ storage, fetch }), true)
  assert.match(JSON.stringify(headers[0]), /Bearer/); assert.doesNotMatch(JSON.stringify(headers[0]), /account|adFree/)
  assert.equal(await verifyGuideVisitor({ storage, fetch: async () => new Response(JSON.stringify({ account: { id: 'server-account', adFree: true }, expiresAt: now + 1000 })) }), false)
  assert.equal(await verifyGuideVisitor({ storage, fetch: async () => { throw new Error('offline') } }), false)
  assert.equal(await verifyGuideVisitor({ storage: { getItem: () => { throw new Error('blocked') } }, fetch }), false)
  assert.equal(await verifyGuideVisitor({ storage, fetch: async () => { raw = null; return new Response(JSON.stringify({ account: { id: 'other-account', adFree: false }, expiresAt: now + 1000 })) } }), false)
})

test('default-off guide controller reads no storage, CMP or network', () => {
  const win = new Proxy({}, { get() { throw new Error('Unexpected browser access while off') } })
  let reads = 0
  const doc = { querySelector: () => { reads++; return null } }
  assert.equal(typeof startGuideAdvertising(win, doc), 'function')
  assert.equal(reads, 1)
})
