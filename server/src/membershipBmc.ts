import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { PlusConfig, PlusEntitlement } from '../../shared/membership.js'

export interface BmcOptions {
  secret?: string
  levelId?: string
  currency?: 'usd' | 'eur'
  membershipUrl?: string
  managementUrl?: string
  amountUnits?: 'major' | 'minor'
  monthlyAmount?: number
  validationConfirmed?: boolean
  refundMode?: 'manual'
  durableStorage?: boolean
}
export interface BmcSubscription {
  id: string
  email: string
  accountId: string | null
  expiresAt: number
  periodStart: number
  interval: 'month' | 'year' | 'giveaway'
  eligible: boolean
  cancelAtPeriodEnd: boolean
  latestAt: number
  latestPriority: number
  latestFingerprint: string
  revokedAt: number | null
}
export interface PlusAudit {
  id: string
  at: number
  kind: 'webhook' | 'webhook_test' | 'owner_revoke' | 'owner_import'
  subscriptionId: string | null
  reason: string | null
}
export class BmcError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
const DAY = 86_400_000
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const stamp = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const numericId = (v: unknown): string | null => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? String(v) : null
export const normalizeBmcEmail = (v: unknown): string | null => typeof v === 'string' && v.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? v.trim().toLowerCase() : null
const hash = (v: string) => createHash('sha256').update(v).digest('hex')
export const isBmcSubscriptionId = (v: unknown): v is string => typeof v === 'string' && /^(?:\d{1,16}|giveaway:[1-9]\d{0,15})$/.test(v)
const fiveYearsAfter = (at: number): number => {
  const date = new Date(at)
  date.setUTCFullYear(date.getUTCFullYear() + 5)
  return date.getTime()
}
export function bmcUrl(value?: string): string | null {
  try {
    const url = new URL(value ?? '')
    return url.protocol === 'https:' && ['buymeacoffee.com', 'www.buymeacoffee.com'].includes(url.hostname) &&
      !url.username && !url.password && !url.port && !url.search && !url.hash && value!.length <= 500 ? url.href : null
  } catch { return null }
}
export function bmcReadiness(options: BmcOptions | undefined, healthy = true, emailEnabled = true) {
  const reasons: string[] = []
  if (!options) return { ready: false, reasons: ['provider_disabled'] }
  if (!options.secret || options.secret.length < 16) reasons.push('webhook_not_configured')
  if (!/^[1-9]\d{0,15}$/.test(options.levelId ?? '')) reasons.push('level_not_configured')
  if (!options.currency || !['eur', 'usd'].includes(options.currency)) reasons.push('currency_not_configured')
  if (!options.amountUnits || !['major', 'minor'].includes(options.amountUnits)) reasons.push('amount_units_unverified')
  if (options.monthlyAmount !== 100) reasons.push('monthly_price_unverified')
  if (!bmcUrl(options.membershipUrl)) reasons.push('purchase_url_not_configured')
  if (!bmcUrl(options.managementUrl)) reasons.push('management_url_not_configured')
  if (!options.validationConfirmed) reasons.push('signed_lifecycle_not_validated')
  if (options.refundMode !== 'manual') reasons.push('refund_procedure_not_confirmed')
  if (!options.durableStorage) reasons.push('durable_postgres_required')
  if (!healthy) reasons.push('storage_unavailable')
  if (!emailEnabled) reasons.push('verified_accounts_unavailable')
  return { ready: reasons.length === 0, reasons }
}
export function bmcPublicConfig(options: BmcOptions | undefined, healthy = true, emailEnabled = true): PlusConfig {
  const ready = bmcReadiness(options, healthy, emailEnabled).ready
  const currency = options?.currency
  const configured = !!currency && !!options?.levelId
  return { enabled: true, provider: options ? 'buymeacoffee' : 'disabled', purchaseEnabled: ready,
    annualAmount: 1000, billingInterval: 'year', currencies: configured ? [currency!] : [],
    prices: configured ? [{ amount: 1000, currency: currency! }] : [],
    ...(configured && options?.monthlyAmount === 100 ? { monthlyPrices: [{ amount: 100, currency: currency! }] } : {}),
    purchaseUrl: ready ? bmcUrl(options?.membershipUrl) : null,
    manageUrl: bmcUrl(options?.managementUrl), requiresMatchingEmail: true }
}
export function bmcFromEnvironment(env: NodeJS.ProcessEnv): BmcOptions | undefined {
  if (env.PLUS_PROVIDER !== 'buymeacoffee') return undefined
  const currency = env.BMC_MEMBERSHIP_CURRENCY?.trim().toLowerCase()
  return { secret: env.BMC_WEBHOOK_SECRET?.trim(), levelId: env.BMC_MEMBERSHIP_LEVEL_ID?.trim(),
    currency: currency === 'usd' ? 'usd' : currency === 'eur' ? 'eur' : undefined,
    membershipUrl: env.BMC_MEMBERSHIP_URL?.trim(), managementUrl: env.BMC_MANAGEMENT_URL?.trim(),
    amountUnits: env.BMC_AMOUNT_UNITS === 'major' ? 'major' : env.BMC_AMOUNT_UNITS === 'minor' ? 'minor' : undefined,
    monthlyAmount: env.BMC_MONTHLY_AMOUNT_MINOR === '100' ? 100 : undefined,
    validationConfirmed: env.BMC_VALIDATION_CONFIRMED === 'true', refundMode: env.BMC_REFUND_MODE === 'manual' ? 'manual' : undefined,
    durableStorage: !!env.DATABASE_URL?.trim() }
}
export interface BmcEvent { event_id: number; type: string; live_mode: boolean; created: number; attempt: number; data: Record<string, any> }
/** Structural validation only; caller must establish webhook or owner authority. */
export function validateBmcEvent(event: unknown, now = Date.now()): BmcEvent {
  if (!obj(event) || !numericId(event.event_id) || typeof event.type !== 'string' || event.type.length > 80 || typeof event.live_mode !== 'boolean' ||
      !stamp(event.created) || event.created < 1 || event.created * 1000 > now + 300_000 || !stamp(event.attempt) || event.attempt < 1 || !obj(event.data)) throw new BmcError('invalid_event')
  return event as BmcEvent
}
export function verifyBmcEvent(body: Buffer, signature: string, secret: string | undefined, now = Date.now()): BmcEvent {
  if (!secret || secret.length < 16) throw new BmcError('bmc_not_configured', 503)
  if (!Buffer.isBuffer(body) || body.length > 262_144 || !/^[a-f0-9]{64}$/i.test(signature)) throw new BmcError('invalid_signature')
  const expected = createHmac('sha256', secret).update(body).digest()
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) throw new BmcError('invalid_signature')
  let event: unknown
  try { event = JSON.parse(body.toString('utf8')) } catch { throw new BmcError('invalid_event') }
  return validateBmcEvent(event, now)
}
export function parseBmcSubscriptions(value: unknown, accountIds: Set<string>): BmcSubscription[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 100_000) throw new Error('Invalid Plus storage')
  const seen = new Set<string>()
  return value.map(raw => {
    if (!obj(raw) || !isBmcSubscriptionId(raw.id) || seen.has(raw.id) || normalizeBmcEmail(raw.email) !== raw.email ||
        !(raw.accountId === null || accountIds.has(raw.accountId)) || !stamp(raw.expiresAt) || !stamp(raw.periodStart) ||
        !['month', 'year', 'giveaway'].includes(raw.interval) || raw.id.startsWith('giveaway:') !== (raw.interval === 'giveaway') ||
        typeof raw.eligible !== 'boolean' || typeof raw.cancelAtPeriodEnd !== 'boolean' ||
        !stamp(raw.latestAt) || ![0, 1, 2].includes(raw.latestPriority) || !/^[a-f0-9]{64}$/.test(raw.latestFingerprint) ||
        !(raw.revokedAt === null || stamp(raw.revokedAt))) throw new Error('Invalid Plus storage')
    seen.add(raw.id)
    return { id: raw.id, email: raw.email, accountId: raw.accountId, expiresAt: raw.expiresAt, periodStart: raw.periodStart,
      interval: raw.interval, eligible: raw.eligible, cancelAtPeriodEnd: raw.cancelAtPeriodEnd, latestAt: raw.latestAt,
      latestPriority: raw.latestPriority, latestFingerprint: raw.latestFingerprint, revokedAt: raw.revokedAt }
  })
}
export function parsePlusAudit(value: unknown): PlusAudit[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 10_000 || !value.every(v => obj(v) && /^[a-f0-9]{64}$/.test(v.id) && stamp(v.at) &&
      ['webhook', 'webhook_test', 'owner_revoke', 'owner_import'].includes(v.kind) && (v.subscriptionId === null || isBmcSubscriptionId(v.subscriptionId)) &&
      (v.reason === null || (typeof v.reason === 'string' && v.reason.length >= 1 && v.reason.length <= 200)))) throw new Error('Invalid Plus audit storage')
  return value as PlusAudit[]
}

/** BMC is an authority of membership access, including its own payment grace.
 * An active update is not represented as an individual verified invoice receipt.
 */
export function applyBmcEvent(records: BmcSubscription[], event: BmcEvent, options: BmcOptions, accounts: { id: string; email: string }[], now: number) {
  if (!['membership.started', 'membership.updated', 'membership.cancelled', 'membership.paused'].includes(event.type)) return null
  const p = event.data, providerId = numericId(p.id)
  if (!providerId || p.object !== 'membership') throw new BmcError('invalid_membership')
  if (!['month', 'year', 'lifetime-giveaway'].includes(p.duration_type) && records.some(record => record.id === `giveaway:${providerId}`)) {
    throw new BmcError('ambiguous_membership', 409)
  }
  const giveaway = p.duration_type === 'lifetime-giveaway'
  // BMC giveaways and paid subscriptions can share a numeric provider ID.
  const subId = giveaway ? `giveaway:${providerId}` : providerId
  const old = records.find(record => record.id === subId)
  const explicitlyPaused = event.type === 'membership.paused' || p.status === 'paused' || p.paused === 'true'
  const atEnd = p.cancel_at_period_end === 'true' && !(giveaway && explicitlyPaused)
  const isTerminal = atEnd || ['membership.cancelled', 'membership.paused'].includes(event.type) || ['canceled', 'paused'].includes(p.status) || p.canceled === 'true' || p.paused === 'true'
  const priority = isTerminal ? atEnd ? 1 : 2 : 0
  const at = event.created * 1000
  const fingerprint = hash(JSON.stringify([event.type, event.created, subId, p.duration_type, p.status, p.canceled, p.paused, p.cancel_at_period_end,
    p.membership_level_id, p.amount, p.currency, p.current_period_start, p.current_period_end, p.canceled_at]))
  if (old && (old.revokedAt !== null || old.latestAt > at || (old.latestAt === at && old.latestPriority > priority) || old.latestFingerprint === fingerprint)) return null
  const supporterEmail = normalizeBmcEmail(p.supporter_email)
  if (!supporterEmail && !old) throw new BmcError('invalid_membership')
  const interval = giveaway ? 'giveaway' : p.duration_type === 'month' ? 'month' : 'year'
  const start = stamp(p.current_period_start) ? p.current_period_start * 1000 : -1
  const end = stamp(p.current_period_end) ? p.current_period_end * 1000 : -1
  const maxDays = interval === 'month' ? 32 : 367, minDays = interval === 'month' ? 27 : 364
  // The signed level and access period are authoritative. BMC permits localized
  // currencies and higher contributions, and documents no canonical base amount
  // in this payload. Amount units and configured base prices are readiness/display
  // checks, not an exchange-rate calculation or an independent invoice receipt.
  // Zero is valid only for BMC's explicit signed giveaway marker. Ordinary
  // month/year zero-price trials never become complimentary access by inference.
  const validAmount = typeof p.amount === 'number' && Number.isFinite(p.amount) && (giveaway ? p.amount === 0 : p.amount > 0)
  const validCurrency = typeof p.currency === 'string' && /^[a-z]{3}$/i.test(p.currency)
  const validPeriod = giveaway
    ? end > start && end <= fiveYearsAfter(start) && end <= fiveYearsAfter(now) + 300_000
    : end - start >= minDays * DAY && end - start <= maxDays * DAY && end <= now + maxDays * DAY + 300_000
  const qualified = numericId(p.membership_level_id) === options.levelId && validCurrency && validAmount &&
    ['month', 'year', 'lifetime-giveaway'].includes(p.duration_type) &&
    start >= 0 && start <= at + 300_000 && validPeriod
  if (!old && !qualified) return null
  const boundEmail = old?.email ?? supporterEmail!
  const record: BmcSubscription = { id: subId, email: boundEmail, accountId: old?.accountId ?? accounts.find(a => a.email === boundEmail)?.id ?? null,
    expiresAt: old?.expiresAt ?? 0, periodStart: old?.periodStart ?? Math.max(0, start), interval: old?.interval ?? interval,
    eligible: old?.eligible ?? false, cancelAtPeriodEnd: old?.cancelAtPeriodEnd ?? false,
    latestAt: at, latestPriority: priority, latestFingerprint: fingerprint, revokedAt: null }
  if (isTerminal) {
    record.cancelAtPeriodEnd = atEnd
    if (atEnd) {
      // Cancellation cannot manufacture a new longer period. If delivered first,
      // its fully qualified current period can establish the remaining access.
      record.expiresAt = old ? old.expiresAt : qualified ? end : 0
      record.eligible = old ? old.eligible : qualified
    } else {
      const canceledAt = stamp(p.canceled_at) && p.canceled_at * 1000 <= at + 300_000 ? p.canceled_at * 1000 : at
      record.expiresAt = Math.min(old?.expiresAt ?? at, canceledAt, at, now)
      record.eligible = false
    }
  } else if (qualified && p.status === 'active' && p.canceled === 'false' && p.paused === 'false') {
    // A newer but regressive provider snapshot must never extend or resurrect
    // a membership through an older billing period.
    if (!old || start > old.periodStart || end >= old.expiresAt) {
      record.expiresAt = end; record.periodStart = start; record.interval = interval
      record.eligible = true; record.cancelAtPeriodEnd = atEnd
    }
  } else { record.eligible = false; record.latestPriority = 2 }
  return { record, audit: { id: fingerprint, at: now, kind: 'webhook' as const, subscriptionId: subId, reason: null } }
}

export function bmcEntitlement(records: BmcSubscription[], account: { id: string; email: string }, now: number): PlusEntitlement {
  const own = records.filter(r => r.accountId === account.id || (r.accountId === null && r.email === account.email))
  const active = own.filter(r => r.revokedAt === null && r.eligible && r.periodStart <= now && r.expiresAt > now).sort((a, b) => b.expiresAt - a.expiresAt)[0]
  const last = active ?? own.sort((a, b) => b.latestAt - a.latestAt)[0]
  return { active: !!active, expiresAt: last?.expiresAt ?? null, provider: last ? 'buymeacoffee' : null,
    status: active ? active.cancelAtPeriodEnd ? 'cancelling' : 'active' : last ? last.revokedAt !== null || !last.eligible ? 'revoked' : 'expired' : 'none',
    cancelAtPeriodEnd: !!active?.cancelAtPeriodEnd,
    ...(last?.interval === 'giveaway' ? { complimentary: true } : last ? { billingInterval: last.interval } : {}) }
}
