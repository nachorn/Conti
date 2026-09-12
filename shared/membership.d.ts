/** Public account data only. Payment secrets and login codes never belong here. */
export interface MembershipAccount {
  id: string
  email: string
  adFree: boolean
  source: 'purchase' | 'gift' | null
  expiresAt: number | null
}

export interface MembershipConfig {
  enabled: boolean
  loginEnabled: boolean
  checkoutEnabled: boolean
  price: { amount: number; currency: string } | null
  prices?: { amount: number; currency: string }[]
  ads: { provider: 'disabled' | 'google-h5'; publisherId: string | null }
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
