import type { MembershipAccount } from '@shared/membership'

export const TABLE_STYLES = ['classic', 'midnight', 'wine'] as const
export const CARD_BACK_STYLES = ['bull', 'linen', 'geometric'] as const
export type TableStyle = typeof TABLE_STYLES[number]
export type CardBackStyle = typeof CARD_BACK_STYLES[number]
export interface CosmeticSelection { table: TableStyle; cardBack: CardBackStyle }
export const DEFAULT_COSMETICS: Readonly<CosmeticSelection> = { table: 'classic', cardBack: 'bull' }
export const COSMETIC_STORAGE_PREFIX = 'nrn-cosmetics-v1:'
type CosmeticStorage = Pick<Storage, 'getItem' | 'setItem'>

export function hasCosmeticAccess(account: Pick<MembershipAccount, 'adFree' | 'expiresAt'> | null, now = Date.now()): boolean {
  return account?.adFree === true && (account.expiresAt === null || (Number.isSafeInteger(account.expiresAt) && account.expiresAt > now))
}
export function parseCosmetics(value: unknown): CosmeticSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_COSMETICS }
  const raw = value as Partial<CosmeticSelection>
  return { table: TABLE_STYLES.includes(raw.table as TableStyle) ? raw.table! : 'classic',
    cardBack: CARD_BACK_STYLES.includes(raw.cardBack as CardBackStyle) ? raw.cardBack! : 'bull' }
}
/** Stored preferences never grant an entitlement or affect game state. */
export function effectiveCosmetics(selection: CosmeticSelection, account: Pick<MembershipAccount, 'adFree' | 'expiresAt'> | null, now = Date.now()): CosmeticSelection {
  return hasCosmeticAccess(account, now) ? parseCosmetics(selection) : { ...DEFAULT_COSMETICS }
}
export function readCosmetics(storage: CosmeticStorage | null, accountId: string | null): CosmeticSelection {
  if (!accountId || !storage) return { ...DEFAULT_COSMETICS }
  try {
    const raw = storage.getItem(COSMETIC_STORAGE_PREFIX + accountId)
    return raw && raw.length <= 256 ? parseCosmetics(JSON.parse(raw)) : { ...DEFAULT_COSMETICS }
  } catch { return { ...DEFAULT_COSMETICS } }
}
export function saveCosmetics(storage: CosmeticStorage | null, accountId: string, selection: CosmeticSelection): boolean {
  try { if (!storage) return false; storage.setItem(COSMETIC_STORAGE_PREFIX + accountId, JSON.stringify(parseCosmetics(selection))); return true }
  catch { return false }
}
