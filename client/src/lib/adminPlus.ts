export type RevokeReason = 'refund' | 'dispute' | 'provider_correction'
export type PlusAuditReason = RevokeReason | 'provider_delivery_recovery'
export interface AdminPlusSubscription {
  id: string; email: string; accountId: string | null; expiresAt: number; interval: 'month' | 'year' | 'giveaway'
  eligible: boolean; cancelAtPeriodEnd: boolean; revokedAt: number | null
}
export interface AdminPlusAudit {
  id: string; at: number; kind: 'webhook' | 'webhook_test' | 'owner_revoke' | 'owner_import'
  subscriptionId: string | null; reason: PlusAuditReason | null
}
export interface AdminPlusSnapshot { subscriptions: AdminPlusSubscription[]; audit: AdminPlusAudit[] }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
const id = (value: unknown): value is string => typeof value === 'string' && /^(?:\d{1,16}|giveaway:[1-9]\d{0,15})$/.test(value)
export const isRevokeReason = (value: unknown): value is RevokeReason => value === 'refund' || value === 'dispute' || value === 'provider_correction'

/** A malformed owner response must never look like an empty successful list. */
export function readAdminPlus(value: unknown): AdminPlusSnapshot | null {
  if (!object(value) || !Array.isArray(value.subscriptions) || !Array.isArray(value.audit) || value.subscriptions.length > 20_000 || value.audit.length > 100) return null
  const subscriptions: AdminPlusSubscription[] = []
  const audit: AdminPlusAudit[] = []
  const seen = new Set<string>()
  for (const item of value.subscriptions) {
    if (!object(item) || !id(item.id) || typeof item.email !== 'string' || item.email.length > 254 || !item.email.includes('@') ||
      !(item.accountId === null || typeof item.accountId === 'string' && item.accountId.length > 0 && item.accountId.length <= 128) ||
      !timestamp(item.expiresAt) || !['month', 'year', 'giveaway'].includes(String(item.interval)) ||
      item.id.startsWith('giveaway:') !== (item.interval === 'giveaway') || typeof item.eligible !== 'boolean' ||
      typeof item.cancelAtPeriodEnd !== 'boolean' || !(item.revokedAt === null || timestamp(item.revokedAt)) || seen.has(item.id)) return null
    seen.add(item.id)
    subscriptions.push(item as unknown as AdminPlusSubscription)
  }
  for (const item of value.audit) {
    if (!object(item) || typeof item.id !== 'string' || !item.id || item.id.length > 128 || !timestamp(item.at) ||
      !['webhook', 'webhook_test', 'owner_revoke', 'owner_import'].includes(String(item.kind)) || !(item.subscriptionId === null || id(item.subscriptionId)) ||
      !(item.reason === null || isRevokeReason(item.reason) || item.reason === 'provider_delivery_recovery')) return null
    audit.push(item as unknown as AdminPlusAudit)
  }
  return { subscriptions, audit }
}

/** Confirmation binds the irreversible revocation to one displayed subscription. */
export function plusRevokeCommand(subscription: AdminPlusSubscription, confirmation: string, reason: unknown) {
  if (subscription.revokedAt !== null || confirmation.trim() !== subscription.id || !isRevokeReason(reason)) return null
  return { subscriptionId: subscription.id, reason }
}

/** Only prepare the pasted provider Request. The owner endpoint validates the invitation. */
export function giveawayImportCommand(raw: string): { event: Record<string, unknown>; reason: 'provider_delivery_recovery' } | null {
  if (!raw.trim() || raw.length > 262_144) return null
  try {
    const event: unknown = JSON.parse(raw)
    return object(event) ? { event, reason: 'provider_delivery_recovery' } : null
  } catch { return null }
}
export function confirmedGiveawayImport(value: unknown): { subscriptionId: string; imported: boolean } | null {
  if (!object(value) || value.ok !== true || !id(value.subscriptionId) || !value.subscriptionId.startsWith('giveaway:') || typeof value.imported !== 'boolean') return null
  return { subscriptionId: value.subscriptionId, imported: value.imported }
}
