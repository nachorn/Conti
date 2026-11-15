/** Persist credentials only; an entitlement is always read from the server. */
import type { MembershipSession } from '@shared/membership'
export const MEMBERSHIP_STORAGE_KEY = 'conti-membership-session'
export interface SavedMembershipSession { token: string; expiresAt: number }
export type MembershipStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Reject malformed successful sign-in responses before remembering credentials. */
export function isMembershipSession(value: unknown, now = Date.now()): value is MembershipSession {
  if (!value || typeof value !== 'object') return false
  const session = value as Partial<MembershipSession>
  const account = session.account
  return typeof session.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(session.token) &&
    typeof session.expiresAt === 'number' && Number.isSafeInteger(session.expiresAt) && session.expiresAt > now &&
    !!account && typeof account.id === 'string' && !!account.id && account.id.length <= 200 && typeof account.email === 'string' && account.email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email) &&
    typeof account.adFree === 'boolean' && (account.source === null || account.source === 'purchase' || account.source === 'gift') &&
    (account.expiresAt === null || (typeof account.expiresAt === 'number' && Number.isSafeInteger(account.expiresAt) && account.expiresAt >= 0)) &&
    (account.name === undefined || (typeof account.name === 'string' && account.name.trim().length > 0 && account.name.length <= 24)) &&
    (account.hasPassword === undefined || typeof account.hasPassword === 'boolean')
}

export function readMembershipSession(storage: MembershipStorage | null, now = Date.now()): SavedMembershipSession | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(MEMBERSHIP_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return null
    const saved = value as Partial<SavedMembershipSession>
    if (typeof saved.token !== 'string' || saved.token.length < 32 || saved.token.length > 512
      || typeof saved.expiresAt !== 'number' || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= now) {
      storage?.removeItem(MEMBERSHIP_STORAGE_KEY)
      return null
    }
    return { token: saved.token, expiresAt: saved.expiresAt }
  } catch { return null }
}

export function saveMembershipSession(storage: MembershipStorage | null, session: SavedMembershipSession | null): boolean {
  try {
    if (!storage) return false
    if (session) storage.setItem(MEMBERSHIP_STORAGE_KEY, JSON.stringify({ token: session.token, expiresAt: session.expiresAt }))
    else storage.removeItem(MEMBERSHIP_STORAGE_KEY)
    return true
  } catch { return false }
}

export function isStripeCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password
  } catch { return false }
}
