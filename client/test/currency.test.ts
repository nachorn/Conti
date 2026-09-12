import assert from 'node:assert/strict'
import test from 'node:test'
import currencyHandler from '../api/currency.js'
import { CURRENCY_PREFERENCE_KEY, currencyForCountry, currencyForLocale, preferredCurrency, readCurrencyPreference, saveCurrencyPreference } from '../lib/currency.js'

test('country suggestion includes all 21 euro members, including Bulgaria in 2026', () => {
  const countries = ['AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES']
  for (const country of countries) assert.equal(currencyForCountry(country), 'eur')
  for (const country of ['US', 'GB', 'CH', 'SE', 'PL', 'RO', 'DK', 'CZ', 'HU', 'MX', undefined, ['ES'], 'EU']) assert.equal(currencyForCountry(country), 'usd')
})

test('geography endpoint returns currency only, never location, and prevents shared caching', () => {
  const headers: Record<string, string> = {}
  let output: unknown
  const response = { setHeader: (key: string, value: string) => { headers[key] = value }, status: (status: number) => { assert.equal(status, 200); return response }, json: (value: unknown) => { output = value } }
  currencyHandler({ headers: { 'x-vercel-ip-country': 'BG', 'x-forwarded-for': '192.0.2.1' }, query: { country: 'US' } }, response)
  assert.deepEqual(output, { currency: 'eur' })
  assert.equal(headers['Cache-Control'], 'private, no-store')
  assert.equal(headers['Vercel-CDN-Cache-Control'], 'no-store')
  currencyHandler({ headers: {}, query: { country: 'ES' } }, response)
  assert.deepEqual(output, { currency: 'usd' })
})

test('locale fallback does not confuse Spanish language with euro-area location', () => {
  assert.equal(currencyForLocale('es-ES'), 'eur')
  assert.equal(currencyForLocale('es-MX'), 'usd')
  assert.equal(currencyForLocale('en-IE'), 'eur')
  assert.equal(currencyForLocale('en-GB'), 'usd')
  assert.equal(currencyForLocale('es'), 'usd')
  assert.equal(currencyForLocale('invalid_locale'), 'usd')
})

test('manual currency persists alone and wins over delayed geography suggestions', () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  assert.equal(saveCurrencyPreference(storage, 'usd'), true)
  assert.deepEqual([...values.entries()], [[CURRENCY_PREFERENCE_KEY, 'usd']])
  assert.equal(preferredCurrency(readCurrencyPreference(storage), 'eur', 'es-ES'), 'usd')
  assert.equal(preferredCurrency(null, 'eur', 'en-US'), 'eur')
  assert.equal(preferredCurrency(null, 'invalid', 'en-US'), 'usd')
  assert.equal(saveCurrencyPreference(storage, 'gbp'), false)
  assert.equal(saveCurrencyPreference(null, 'eur'), false)
  assert.equal(readCurrencyPreference(null), null)
  const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(readCurrencyPreference(blocked), null)
  assert.equal(saveCurrencyPreference(blocked, 'eur'), false)
})
