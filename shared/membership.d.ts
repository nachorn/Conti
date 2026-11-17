/** Public account data only. Payment secrets and login codes never belong here. */
export interface MembershipAccount {
  id: string
  email: string
  name?: string
  hasPassword?: boolean
  /** Server-verified role, supplied only for the authenticated account. */
  isAdmin?: boolean
  adFree: boolean
  source: 'purchase' | 'gift' | null
  expiresAt: number | null
  plus?: PlusEntitlement
}

export interface PlusEntitlement {
  active: boolean
  expiresAt: number | null
  provider: 'buymeacoffee' | 'stripe' | 'gift' | 'legacy' | null
  status: 'active' | 'cancelling' | 'expired' | 'revoked' | 'none'
  cancelAtPeriodEnd: boolean
  billingInterval?: 'month' | 'year'
  /** Provider-issued complimentary access has no recurring billing interval. */
  complimentary?: boolean
}

export interface PlusConfig {
  enabled: boolean
  purchaseEnabled: boolean
  provider: 'buymeacoffee' | 'stripe' | 'disabled'
  annualAmount: number
  billingInterval: 'year'
  currencies: ('eur' | 'usd')[]
  prices: { amount: number; currency: string }[]
  monthlyPrices?: { amount: number; currency: string }[]
  purchaseUrl: string | null
  manageUrl: string | null
  requiresMatchingEmail: boolean
}

export interface MembershipConfig {
  enabled: boolean
  loginEnabled: boolean
  passwordLoginEnabled?: boolean
  checkoutEnabled: boolean
  price: { amount: number; currency: string } | null
  prices?: { amount: number; currency: string }[]
  ads: { provider: 'disabled' | 'google-h5'; publisherId: string | null; consentReady?: boolean }
  plus?: PlusConfig
}

export interface MembershipSession {
  token: string
  expiresAt: number
  account: MembershipAccount
}

export interface MembershipGrant {
  email: string
  active: boolean
  expiresAt: number | null
  grantedAt: number
}
