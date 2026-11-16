import { isMembershipCurrency, type MembershipCurrency } from '../../lib/currency.js'

export type PlusProvider = 'buymeacoffee' | 'stripe' | 'disabled'
export interface PlusOffer {
  enabled: boolean; purchaseEnabled: boolean; provider: PlusProvider
  prices: { amount: number; currency: MembershipCurrency }[]
  monthlyPrices: { amount: number; currency: MembershipCurrency }[]
  purchaseUrl: string | null; manageUrl: string | null; requiresMatchingEmail: boolean
}
export function safePlusProviderUrl(value: unknown, provider: PlusProvider, kind: 'purchase' | 'manage'): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const hosts = provider === 'buymeacoffee' ? ['buymeacoffee.com', 'www.buymeacoffee.com']
      : provider === 'stripe' ? kind === 'manage' ? ['billing.stripe.com'] : ['checkout.stripe.com'] : []
    if (!hosts.includes(url.hostname)) return null
    // Account email is shown to the player; it never travels in payment URLs.
    if ([...url.searchParams].some(([key, val]) => /email/i.test(key) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val))) return null
    return url.href
  } catch { return null }
}
export function readPlusOffer(raw: unknown): PlusOffer | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const value = raw as Record<string, unknown>
  const provider = value.provider === 'buymeacoffee' || value.provider === 'stripe' ? value.provider : 'disabled'
  if (value.billingInterval !== 'year' || value.annualAmount !== 1000) return null
  const currencies = Array.isArray(value.currencies) ? value.currencies.filter(isMembershipCurrency) : []
  const prices = Array.isArray(value.prices) ? value.prices.flatMap(price => {
    if (!price || typeof price !== 'object') return []
    const item = price as { amount?: unknown; currency?: unknown }
    return item.amount === 1000 && isMembershipCurrency(item.currency) && currencies.includes(item.currency)
      ? [{ amount: 1000, currency: item.currency }] : []
  }).filter((item, index, all) => all.findIndex(other => other.currency === item.currency) === index) : []
  const purchaseUrl = safePlusProviderUrl(value.purchaseUrl, provider, 'purchase')
  const monthlyPrices = Array.isArray(value.monthlyPrices) ? value.monthlyPrices.flatMap(price => {
    if (!price || typeof price !== 'object') return []
    const item = price as { amount?: unknown; currency?: unknown }
    return typeof item.amount === 'number' && Number.isSafeInteger(item.amount) && item.amount > 0 && isMembershipCurrency(item.currency) && currencies.includes(item.currency)
      ? [{ amount: item.amount, currency: item.currency }] : []
  }) : []
  return { enabled: value.enabled === true, provider, prices, monthlyPrices, purchaseUrl,
    manageUrl: safePlusProviderUrl(value.manageUrl, provider, 'manage'), requiresMatchingEmail: value.requiresMatchingEmail === true,
    purchaseEnabled: value.enabled === true && value.purchaseEnabled === true && provider !== 'disabled' && prices.length > 0 &&
      (provider === 'stripe' || purchaseUrl !== null) }
}
