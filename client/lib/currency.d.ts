export type MembershipCurrency = 'eur' | 'usd'
type CurrencyStorage = Pick<Storage, 'getItem' | 'setItem'>
export const CURRENCY_PREFERENCE_KEY: string
export function isMembershipCurrency(value: unknown): value is MembershipCurrency
export function currencyForCountry(country: unknown): MembershipCurrency
export function currencyForLocale(locale: string): MembershipCurrency
export function readCurrencyPreference(storage: CurrencyStorage | null): MembershipCurrency | null
export function saveCurrencyPreference(storage: CurrencyStorage | null, currency: unknown): boolean
export function preferredCurrency(manual: unknown, suggestion: unknown, locale: string): MembershipCurrency
