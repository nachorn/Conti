// Euro-area membership as of 2026-01-01, including Bulgaria.
// https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260101~c830245e42.en.html
const EURO_AREA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES'])
export const CURRENCY_PREFERENCE_KEY = 'conti-payment-currency'

export function isMembershipCurrency(value) { return value === 'eur' || value === 'usd' }

export function currencyForCountry(country) {
  return typeof country === 'string' && EURO_AREA.has(country.trim().toUpperCase()) ? 'eur' : 'usd'
}

/** A browser locale is only a fallback preference, never evidence of location. */
export function currencyForLocale(locale) {
  try { return currencyForCountry(new Intl.Locale(locale).region) }
  catch { return 'usd' }
}

export function readCurrencyPreference(storage) {
  try {
    const value = storage?.getItem(CURRENCY_PREFERENCE_KEY)
    return isMembershipCurrency(value) ? value : null
  } catch { return null }
}

export function saveCurrencyPreference(storage, currency) {
  if (!isMembershipCurrency(currency) || !storage) return false
  try { storage.setItem(CURRENCY_PREFERENCE_KEY, currency); return true }
  catch { return false }
}

/** Manual choices also win over a suggestion that arrives after a click. */
export function preferredCurrency(manual, suggestion, locale) {
  if (isMembershipCurrency(manual)) return manual
  if (isMembershipCurrency(suggestion)) return suggestion
  return currencyForLocale(locale)
}
