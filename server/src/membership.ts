import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { FileSnapshotStore, PostgresSnapshotStore, MAX_SNAPSHOT_BYTES, SnapshotCapacityError, snapshotCapacity, localSnapshotPaths, requireInstalledLocalSnapshots, snapshotStorageMode, type SnapshotStore } from './storage.js'
import { createMembershipEmailSender, type EmailSender } from './membershipEmail.js'
import { SecurityNotices, type SecurityNoticeSender } from './securityNotices.js'
import { AdminAuth, type AdminAccountVerifier } from './adminAuth.js'
import { AdminStepUp } from './adminStepUp.js'
import { accountCredential, allowedPortalOrigin, bearerCredential, clearPortalCookie, cookieAudience, cookieRequested, cookieRequestOrigin,
  isCookieAudience, setPortalCookie, type CookieAudience } from './portalSession.js'
import { RateLimiter } from './security.js'
import { hashPassword, verifyPassword, isStoredPasswordHash, passwordIsAcceptable, PasswordWorkBusy } from './passwordAuth.js'
import { DEFAULT_GAME_ORIGINS, GameSignInBroker, GameSignInError, gameOriginsFromEnvironment, validateGameOrigins } from './gameSignIn.js'
import { applyBmcEvent, bmcEntitlement, bmcFromEnvironment, bmcPublicConfig, bmcReadiness, bmcUrl, BmcError, isBmcSubscriptionId, normalizeBmcEmail, parseBmcSubscriptions, parsePlusAudit, validateBmcEvent, verifyBmcEvent, type BmcEvent, type BmcOptions, type BmcSubscription, type PlusAudit } from './membershipBmc.js'
import type { MembershipAccount, MembershipConfig, MembershipGrant, MembershipSession } from '../../shared/membership.js'
import type { AdminAccount } from '../../shared/platformAdmin.js'
import type { ManualPlusAudit, ManualPlusReason, PlusAccessState } from '../../shared/plusAdminAudit.js'

export type { MembershipAccount } from '../../shared/membership.js'
type Language = 'en' | 'es'
type Account = { id: string; email: string; createdAt: number; name?: string; passwordHash?: string }
type Session = { accountId: string; tokenHash: string; expiresAt: number; scope?: 'game'; transport?: CookieAudience }
type SocketCookieProof = { tokenHash: string; audience: CookieAudience; origin: string; expiresAt: number }
type ChallengePurpose = 'login' | 'register' | 'reset'
type Challenge = { email: string; salt: string; codeHash: string; expiresAt: number; attempts: number; purpose?: ChallengePurpose; name?: string; passwordHash?: string; registrationTokenHash?: string }
type Limit = { key: string; count: number; until: number }
type Order = { id: string; accountId: string; priceId: string; amount: number; currency: string; createdAt: number; sessionId: string | null; paymentIntentId: string | null; url: string | null; state: 'pending' | 'paid' | 'revoked' }
type StoredManualPlusAudit = Omit<ManualPlusAudit, 'actorEmail'> & { actorAccountId: string | null }
type Data = { version: 1 | 2; accounts: Account[]; sessions: Session[]; challenges: Challenge[]; limits: Limit[]; grants: MembershipGrant[]; orders: Order[]; revokedPayments: string[]; events: string[]; bmcSubscriptions: BmcSubscription[]; plusAudit: PlusAudit[]; manualPlusAudit: StoredManualPlusAudit[] }
type StripePrice = { id: string; amount: number; currency: string }
export interface MembershipOptions {
  store: SnapshotStore
  authSecret: string
  dashboardKey?: string
  adminEmails?: readonly string[]
  sendCode?: EmailSender
  sendSecurityNotice?: SecurityNoticeSender
  stripeSecret?: string
  stripeWebhookSecret?: string
  stripePriceId?: string
  stripePriceIdEur?: string
  stripePriceIdUsd?: string
  appUrl?: string
  gameOrigins?: string[]
  allowLocalGameOrigins?: boolean
  ads?: MembershipConfig['ads']
  request?: typeof fetch
  now?: () => number
  bmc?: BmcOptions
}
const DAY = 86_400_000
const MAX_MANUAL_PLUS_AUDIT = 500
// A ten-minute challenge can straddle two hourly send windows.
const MAX_ACTIVE_CHALLENGES = 200
const MAX_PENDING_PASSWORD_RESETS = 9
const challengePurpose = (challenge: Challenge): ChallengePurpose => challenge.purpose ?? 'login'
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value)
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function normalizeMembershipEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email) ? email : null
}
export function adminEmailsFromEnvironment(env: NodeJS.ProcessEnv): string[] | undefined {
  const value = env.ADMIN_ACCOUNT_EMAILS
  if (value === undefined) return undefined
  if (value.length > 4096) throw new Error('ADMIN_ACCOUNT_EMAILS must contain a bounded list of valid account email addresses')
  return normalizeAdminEmails(value.split(',').filter(email => email.trim() !== ''))
}
function normalizeAdminEmails(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 100) throw new Error('ADMIN_ACCOUNT_EMAILS must contain a bounded list of valid account email addresses')
  const emails = values.map(normalizeMembershipEmail)
  if (emails.some(email => email === null)) throw new Error('ADMIN_ACCOUNT_EMAILS must contain only valid account email addresses')
  return [...new Set(emails as string[])]
}
class MembershipError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export function normalizeAccountName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= 24 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null
}
const empty = (): Data => ({ version: 1, accounts: [], sessions: [], challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [], bmcSubscriptions: [], plusAudit: [], manualPlusAudit: [] })

function manualReason(value: unknown): value is Exclude<ManualPlusReason, 'provider_delivery_recovery'> {
  return value === 'refund' || value === 'dispute' || value === 'provider_correction'
}
function plusAccessState(value: unknown): value is PlusAccessState {
  return object(value) && typeof value.active === 'boolean' && (value.expiresAt === null || time(value.expiresAt))
}
function manualPlusAuditEntry(value: unknown): value is StoredManualPlusAudit {
  if (!object(value) || !id(value.id) || !time(value.at) || value.at > 8_640_000_000_000_000 ||
      !(value.actorAccountId === null || id(value.actorAccountId)) || typeof value.email !== 'string' ||
      (value.subscriptionId === null ? normalizeMembershipEmail(value.email) : normalizeBmcEmail(value.email)) !== value.email ||
      !(value.before === null || plusAccessState(value.before)) || !plusAccessState(value.after)) return false
  switch (value.action) {
    case 'gift_granted': return value.subscriptionId === null && value.reason === null && value.after.active
    case 'gift_revoked': return value.subscriptionId === null && value.reason === null && value.before !== null && !value.after.active
    case 'subscription_revoked': return isBmcSubscriptionId(value.subscriptionId) && manualReason(value.reason) && value.before !== null && !value.after.active
    case 'giveaway_imported': return isBmcSubscriptionId(value.subscriptionId) && value.subscriptionId.startsWith('giveaway:') && value.reason === 'provider_delivery_recovery'
    default: return false
  }
}
function recordManualPlusChange(data: Data, actorAccountId: string | null | undefined, change: Omit<StoredManualPlusAudit, 'id' | 'actorAccountId'>) {
  if (actorAccountId === undefined) return
  data.manualPlusAudit = data.manualPlusAudit.concat({ id: randomUUID(), actorAccountId, ...change }).slice(-MAX_MANUAL_PLUS_AUDIT)
}
function giftAccess(grant: MembershipGrant | undefined, at: number): PlusAccessState | null {
  return grant ? { active: grant.active && (grant.expiresAt === null || grant.expiresAt > at), expiresAt: grant.expiresAt } : null
}
function subscriptionAccess(subscription: BmcSubscription, at: number): PlusAccessState {
  return { active: subscription.eligible && subscription.revokedAt === null && subscription.periodStart <= at && subscription.expiresAt > at, expiresAt: subscription.expiresAt }
}

function decode(value: unknown): Data {
  if (value === null) return empty()
  const fail = () => { throw new Error('Invalid membership storage; refusing to overwrite accounts or purchases') }
  if (!object(value) || ![1, 2].includes(value.version)) return fail()
  for (const field of ['accounts', 'sessions', 'challenges', 'limits', 'grants', 'orders', 'revokedPayments', 'events']) {
    if (!Array.isArray(value[field]) || value[field].length > 100_000) return fail()
  }
  const v = value as Data
  if (!v.accounts.every(a => object(a) && id(a.id) && normalizeMembershipEmail(a.email) === a.email && time(a.createdAt) &&
      (a.name === undefined || normalizeAccountName(a.name) === a.name) &&
      (a.passwordHash === undefined || isStoredPasswordHash(a.passwordHash))) ||
      new Set(v.accounts.map(a => a.id)).size !== v.accounts.length || new Set(v.accounts.map(a => a.email)).size !== v.accounts.length) return fail()
  const accountIds = new Set(v.accounts.map(a => a.id))
  if (!v.sessions.every(s => object(s) && accountIds.has(s.accountId) && digest(s.tokenHash) && time(s.expiresAt) &&
      (s.scope === undefined || s.scope === 'game') && (s.transport === undefined || isCookieAudience(s.transport)) &&
      (s.transport === undefined || s.transport === 'portal' || s.scope === 'game')) ||
      new Set(v.sessions.map(s => s.tokenHash)).size !== v.sessions.length ||
      !v.challenges.every(c => object(c) && normalizeMembershipEmail(c.email) === c.email && id(c.salt) && digest(c.codeHash) && time(c.expiresAt) && time(c.attempts) && c.attempts <= 5 &&
        (c.purpose === undefined || ['login', 'register', 'reset'].includes(c.purpose)) &&
        (c.purpose === 'register' ? normalizeAccountName(c.name) === c.name && isStoredPasswordHash(c.passwordHash) && digest(c.registrationTokenHash) : c.name === undefined && c.passwordHash === undefined && c.registrationTokenHash === undefined)) ||
      !v.limits.every(l => object(l) && digest(l.key) && time(l.count) && time(l.until)) ||
      !v.grants.every(g => object(g) && normalizeMembershipEmail(g.email) === g.email && typeof g.active === 'boolean' && (g.expiresAt === null || time(g.expiresAt)) && time(g.grantedAt)) ||
      new Set(v.grants.map(g => g.email)).size !== v.grants.length ||
      !v.orders.every(o => object(o) && id(o.id) && accountIds.has(o.accountId) && id(o.priceId) && time(o.amount) && /^[a-z]{3}$/.test(o.currency) && time(o.createdAt) &&
        (o.sessionId === null || id(o.sessionId)) && (o.paymentIntentId === null || id(o.paymentIntentId)) && (o.url === null || validCheckoutUrl(o.url)) && ['pending', 'paid', 'revoked'].includes(o.state)) ||
      new Set(v.orders.map(o => o.id)).size !== v.orders.length || !v.events.every(id) || !v.revokedPayments.every(id)) return fail()
  if (value.version === 2 && (!Array.isArray(value.bmcSubscriptions) || !Array.isArray(value.plusAudit))) return fail()
  v.bmcSubscriptions = parseBmcSubscriptions(value.bmcSubscriptions, accountIds)
  v.plusAudit = parsePlusAudit(value.plusAudit)
  const audit = value.manualPlusAudit
  if (audit !== undefined && (!Array.isArray(audit) || audit.length > MAX_MANUAL_PLUS_AUDIT || !audit.every(manualPlusAuditEntry) ||
      new Set(audit.map(entry => entry.id)).size !== audit.length)) return fail()
  v.manualPlusAudit = audit ?? []
  return v
}
function validCheckoutUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && !u.username && !u.password } catch { return false }
}
function validAppUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const u = new URL(value)
    if (u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) return null
    return u.origin
  } catch { return null }
}

/** Uses the exact bytes received; supports rotating signatures and a five-minute replay window. */
export function verifyStripeEvent(body: Buffer, signature: string, secret: string, now = Date.now()): Record<string, any> {
  if (!secret || !Buffer.isBuffer(body) || body.length > 262_144 || signature.length > 4096) throw new MembershipError('invalid_signature', 400)
  const parts = signature.split(',').map(p => p.trim().split('='))
  const timestamps = parts.filter(([key]) => key === 't')
  const timestamp = timestamps[0]?.[1] ?? ''
  if (timestamps.length !== 1 || !/^\d{1,13}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) throw new MembershipError('invalid_signature', 400)
  const expected = createHmac('sha256', secret).update(timestamp).update('.').update(body).digest('hex')
  if (!parts.some(([key, value]) => key === 'v1' && digest(value) && equal(value, expected))) throw new MembershipError('invalid_signature', 400)
  let event: unknown
  try { event = JSON.parse(body.toString('utf8')) } catch { throw new MembershipError('invalid_event', 400) }
  if (!object(event) || !id(event.id) || typeof event.type !== 'string' || typeof event.livemode !== 'boolean' || !object(event.data) || !object(event.data.object)) throw new MembershipError('invalid_event', 400)
  return event
}

/** A separate durable store: room expiry must never delete a purchase. */
export class MembershipService {
  private data: Data = empty()
  private queue: Promise<unknown> = Promise.resolve()
  private pending = 0
  private failed = false
  private listeners = new Set<(email?: string) => void>()
  private pendingPasswordResets = new Set<string>()
  private resetDeliveries = new Set<Promise<void>>()
  private reservedDeliveries = 0
  private deliveryFailures = 0
  private committedBytes = 0
  private priceCache: { prices: StripePrice[]; at: number } | null = null
  private priceLoading: Promise<StripePrice[]> | null = null
  private readonly now: () => number
  private readonly request: typeof fetch
  private readonly appUrl: string | null
  private readonly gameSignIn: GameSignInBroker
  private readonly cookieSocketTickets = new Map<string, SocketCookieProof>()
  private readonly cookieSocketRequests: RateLimiter
  private readonly adminEmails: ReadonlySet<string> | null
  private readonly adminStepUp: AdminStepUp | undefined
  private readonly securityNotices: SecurityNotices
  constructor(private readonly options: MembershipOptions) {
    if (options.authSecret.length < 32) throw new Error('MEMBERSHIP_AUTH_SECRET must contain at least 32 characters')
    this.now = options.now ?? Date.now
    this.securityNotices = new SecurityNotices(options.sendSecurityNotice, this.now)
    this.cookieSocketRequests = new RateLimiter(30, 60_000, this.now)
    this.adminEmails = options.adminEmails === undefined ? null : new Set(normalizeAdminEmails(options.adminEmails))
    if (this.adminEmails !== null) {
      this.adminStepUp = new AdminStepUp((tokenHash, portal) => {
        const match = this.accountSession(tokenHash, portal ? 'portal' : undefined)
        return match ? { id: match.account.id, email: match.account.email,
          eligible: match.session.scope !== 'game' && this.adminEmails!.has(match.account.email) } : null
      }, options.authSecret, options.sendCode, this.now, this.securityNotices)
    }
    this.request = options.request ?? fetch
    this.appUrl = validAppUrl(options.appUrl)
    this.gameSignIn = new GameSignInBroker(
      validateGameOrigins(options.gameOrigins ?? DEFAULT_GAME_ORIGINS, options.allowLocalGameOrigins === true),
      (sourceTokenHash, previousToken, origin, audience) => this.linkedSessionByHash(sourceTokenHash, previousToken, allowedPortalOrigin(origin) ? undefined : 'game', audience), this.now,
    )
  }
  async load() {
    this.data = decode(await this.options.store.load())
    this.committedBytes = snapshotCapacity(this.data).bytes
    return this
  }
  isHealthy() { return !this.failed && this.options.store.isHealthy?.() !== false }
  hasFailedOperation() { return this.failed }
  /** Counts only: never expose recipients, codes or provider errors in diagnostics. */
  emailDeliveryStatus() {
    const notices = this.securityNotices.status()
    return { pending: this.reservedDeliveries + notices.pending, failures: this.deliveryFailures + notices.failures }
  }
  storageCapacity() {
    return { bytes: this.committedBytes, limitBytes: MAX_SNAPSHOT_BYTES,
      usedPercent: Math.round(this.committedBytes / MAX_SNAPSHOT_BYTES * 1000) / 10,
      warning: this.committedBytes >= MAX_SNAPSHOT_BYTES * 0.75,
      growthAllowed: this.committedBytes < MAX_SNAPSHOT_BYTES - 256 * 1024 }
  }
  onChange(listener: (email?: string) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify(email?: string) { for (const listener of this.listeners) { try { listener(email) } catch { /* A UI listener cannot undo a committed payment. */ } } }
  private requireHealthy() {
    if (this.isHealthy()) return
    const firstFailure = !this.failed
    this.failed = true
    if (firstFailure) this.notify()
    throw new MembershipError('server_unavailable', 503)
  }
  async close() {
    await this.queue
    const deliveries = [...this.resetDeliveries, ...this.securityNotices.stop()]
    if (deliveries.length) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([Promise.allSettled(deliveries), new Promise<void>(resolve => { timer = setTimeout(resolve, 15_000) })])
      } finally { if (timer) clearTimeout(timer) }
    }
    await this.options.store.close()
  }
  private mutate<T>(work: (data: Data) => T | Promise<T>, notify = true, useControlReserve = false): Promise<T> {
    if (this.pending >= 100) return Promise.reject(new MembershipError('rate_limited', 429))
    this.pending++
    const result = this.queue.then(async () => {
      this.requireHealthy()
      const next = structuredClone(this.data)
      const now = this.now()
      next.sessions = next.sessions.filter(s => s.expiresAt > now)
      next.challenges = next.challenges.filter(c => c.expiresAt > now)
      next.limits = next.limits.filter(l => l.until > now)
      const value = await work(next)
      // Older servers refuse v2 rather than serving paid members as free users.
      if (next.bmcSubscriptions.length) next.version = 2
      const bytes = snapshotCapacity(next).bytes
      if (bytes > MAX_SNAPSHOT_BYTES || (!useControlReserve && bytes > MAX_SNAPSHOT_BYTES - 256 * 1024 && bytes > this.committedBytes)) {
        throw new MembershipError('storage_capacity', 503)
      }
      try { await this.options.store.save(next) } catch (error) {
        if (error instanceof SnapshotCapacityError) throw new MembershipError('storage_capacity', 503)
        this.failed = true; this.notify(); throw new MembershipError('server_unavailable', 503)
      }
      this.data = next
      this.committedBytes = bytes
      if (notify) this.notify()
      return value
    }).finally(() => { this.pending-- })
    this.queue = result.catch(() => undefined)
    return result
  }
  private publicAccount(account: Account, data = this.data, scope?: Session['scope']): MembershipAccount {
    const purchased = data.orders.some(o => o.accountId === account.id && o.state === 'paid')
    const gift = data.grants.find(g => g.email === account.email && g.active && (g.expiresAt === null || g.expiresAt > this.now()))
    const bmc = bmcEntitlement(data.bmcSubscriptions, account, this.now())
    const giftWins = !!gift && (gift.expiresAt === null || !bmc.active || gift.expiresAt >= (bmc.expiresAt ?? 0))
    const plus = purchased ? { active: true, expiresAt: null, provider: 'legacy' as const, status: 'active' as const, cancelAtPeriodEnd: false }
      : giftWins ? { active: true, expiresAt: gift!.expiresAt, provider: 'gift' as const, status: 'active' as const, cancelAtPeriodEnd: false } : bmc
    return { id: account.id, email: account.email, ...(account.name === undefined ? {} : { name: account.name }), ...(account.passwordHash === undefined ? {} : { hasPassword: true }),
      ...(scope !== 'game' && this.adminEmails?.has(account.email) ? { isAdmin: true } : {}), adFree: plus.active,
      source: purchased ? 'purchase' : giftWins || bmc.active && bmc.complimentary ? 'gift' : bmc.active ? 'purchase' : null, expiresAt: plus.expiresAt, plus }
  }
  /** Present even for an explicitly empty allowlist, which disables legacy admin access. */
  adminAccountVerifier(): AdminAccountVerifier | undefined {
    return this.adminStepUp
  }
  /** Admin-only projection. Credentials, delivery challenges and payment details never leave this service. */
  getAdminAccountSummary(): { total: number; plusActive: number } {
    this.requireHealthy()
    return { total: this.data.accounts.length, plusActive: this.data.accounts.filter(account => this.publicAccount(account).adFree).length }
  }
  listAdminAccounts(q = '', offset = 0, limit = 50): {
    total: number; filtered: number; offset: number; limit: number; accounts: Omit<AdminAccount, 'stats'>[]
  } {
    this.requireHealthy()
    const query = q.slice(0, 100).trim().toLocaleLowerCase()
    const start = Number.isSafeInteger(offset) ? Math.max(0, offset) : 0
    const size = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50
    const matches = this.data.accounts.filter(account => !query || account.email.toLocaleLowerCase().includes(query) || (account.name ?? '').toLocaleLowerCase().includes(query))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.email.localeCompare(b.email) || a.id.localeCompare(b.id))
    return { total: this.data.accounts.length, filtered: matches.length, offset: start, limit: size,
      accounts: matches.slice(start, start + size).map(account => {
        const entitlement = this.publicAccount(account)
        return { id: account.id, name: account.name ?? null, email: account.email, createdAt: account.createdAt,
          plus: { active: entitlement.adFree, source: entitlement.source, expiresAt: entitlement.expiresAt } }
      }) }
  }
  private accountSession(tokenHash: string, audience?: CookieAudience) {
    if (!this.isHealthy()) return null
    const now = this.now(), session = this.data.sessions.find(s => s.tokenHash === tokenHash && s.expiresAt > now && s.transport === audience)
    const account = session && this.data.accounts.find(a => a.id === session.accountId)
    return session && account ? { session, account } : null
  }
  authenticate(token: string, audience?: CookieAudience): MembershipAccount | null {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null
    const match = this.accountSession(hash(token), audience)
    return match ? this.publicAccount(match.account, this.data, match.session.scope) : null
  }
  authenticateRequest(req: Request): MembershipAccount | null {
    const { token, audience } = accountCredential(req)
    return this.authenticate(token, audience)
  }
  authenticateCookieSocket(proof: Pick<SocketCookieProof, 'tokenHash' | 'audience'>): MembershipAccount | null {
    const match = this.accountSession(proof.tokenHash, proof.audience)
    return match ? this.publicAccount(match.account, this.data, match.session.scope) : null
  }
  consumeCookieSocketTicket(ticket: unknown, origin: string | undefined): Pick<SocketCookieProof, 'tokenHash' | 'audience'> | null {
    if (!origin || typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return null
    const key = hash(ticket)
    const proof = this.cookieSocketTickets.get(key)
    if (!proof || origin !== proof.origin) return null
    this.cookieSocketTickets.delete(key)
    return proof.expiresAt > this.now() && this.accountSession(proof.tokenHash, proof.audience)
      ? { tokenHash: proof.tokenHash, audience: proof.audience } : null
  }
  private cookieSocketTicket(req: Request, res: Response) {
    const { token, audience } = accountCredential(req)
    if (!audience || !token) throw new MembershipError('unauthorized', 401)
    const tokenHash = hash(token), match = this.accountSession(tokenHash, audience)
    if (!match) throw new MembershipError('unauthorized', 401)
    const now = this.now(), retryAfter = this.cookieSocketRequests.take(match.account.id)
    if (retryAfter) { res.set('Retry-After', String(retryAfter)); throw new MembershipError('rate_limited', 429) }
    for (const [id, proof] of this.cookieSocketTickets) if (proof.expiresAt <= now) this.cookieSocketTickets.delete(id)
    if (this.cookieSocketTickets.size >= 2_000) throw new MembershipError('rate_limited', 429)
    const ticket = randomBytes(32).toString('base64url'), expiresAt = Math.min(match.session.expiresAt, now + 60_000)
    this.cookieSocketTickets.set(hash(ticket), { tokenHash, audience, origin: cookieRequestOrigin(req, audience), expiresAt })
    res.json({ ticket, expiresAt })
  }
  gameSignInCors(issuerOrigins: string[] = []) {
    return this.gameSignIn.cors([...issuerOrigins, ...(this.appUrl ? [this.appUrl] : []), 'https://nrnplay.com', 'https://www.nrnplay.com'])
  }
  /** A new game receives a separate session; the source credential never leaves this server. */
  linkedSession(sourceToken: string): Promise<MembershipSession> {
    if (!this.authenticate(sourceToken)) return Promise.reject(new MembershipError('unauthorized', 401))
    return this.linkedSessionByHash(hash(sourceToken), undefined, 'game')
  }
  private async linkedSessionByHash(sourceTokenHash: string, previousToken: string | undefined, scope: Session['scope'], audience?: CookieAudience): Promise<MembershipSession> {
    const session = await this.mutate(data => {
      // Recheck inside the mutation queue so logout/reset before exchange revokes the proof.
      const source = data.sessions.find(session => session.tokenHash === sourceTokenHash && session.expiresAt > this.now())
      const account = source && data.accounts.find(candidate => candidate.id === source.accountId)
      if (!source || !account) throw new MembershipError('unauthorized', 401)
      const effectiveScope = source.scope === 'game' || audience && audience !== 'portal' ? 'game' : scope
      if (previousToken && /^[A-Za-z0-9_-]{43}$/.test(previousToken)) {
        const previousHash = hash(previousToken)
        const previous = previousHash !== sourceTokenHash && data.sessions.find(session =>
          session.scope === effectiveScope && session.transport === audience && session.tokenHash === previousHash && session.accountId === account.id && session.expiresAt > this.now())
        if (previous) {
          previous.expiresAt = Math.min(previous.expiresAt, source.expiresAt)
          return { token: previousToken, expiresAt: previous.expiresAt, account: this.publicAccount(account, data, effectiveScope) }
        }
      }
      const token = randomBytes(32).toString('base64url')
      const expiresAt = Math.min(source.expiresAt, this.now() + 30 * DAY)
      const previous = data.sessions.filter(session => session.accountId === account.id && session.tokenHash !== sourceTokenHash).slice(-8)
      data.sessions = data.sessions.filter(session => session.accountId !== account.id)
        .concat(source, previous, { accountId: account.id, tokenHash: hash(token), expiresAt, ...(effectiveScope ? { scope: effectiveScope } : {}), ...(audience ? { transport: audience } : {}) })
      return { token, expiresAt, account: this.publicAccount(account, data, effectiveScope) }
    }, false)
    this.notify(session.account.email)
    return session
  }
  async revokeOtherSessions(token: string, lang: Language = 'en', audience?: CookieAudience): Promise<MembershipSession> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new MembershipError('unauthorized', 401)
    const tokenHash = hash(token)
    const current = this.accountSession(tokenHash, audience)
    if (!current) throw new MembershipError('unauthorized', 401)
    if (current.session.scope === 'game') throw new MembershipError('primary_session_required', 403)
    const newSession = await this.mutate(data => {
      const session = data.sessions.find(value => value.tokenHash === tokenHash && value.expiresAt > this.now() &&
        value.transport === audience)
      const account = session && data.accounts.find(value => value.id === session.accountId)
      if (!session || !account) throw new MembershipError('unauthorized', 401)
      if (session.scope === 'game') throw new MembershipError('primary_session_required', 403)
      if (!this.limit(data, `revoke-sessions:${account.id}`, 5, 15 * 60_000)) throw new MembershipError('rate_limited', 429)
      // Rotating the current credential also invalidates unfinished game handoffs and admin proofs.
      const replacement = randomBytes(32).toString('base64url')
      data.sessions = data.sessions.filter(value => value.accountId !== account.id)
      data.sessions.push({ ...session, tokenHash: hash(replacement) })
      return { token: replacement, expiresAt: session.expiresAt, account: this.publicAccount(account, data, session.scope) }
    }, false, true)
    this.notify(newSession.account.email)
    this.securityNotices.schedule(newSession.account, 'other_sessions_closed', lang)
    return newSession
  }
  private requireAccount(req: Request): MembershipAccount {
    const account = this.authenticateRequest(req)
    if (!account) throw new MembershipError('unauthorized', 401)
    return account
  }
  private token(req: Request) { return accountCredential(req).token }
  private requireAdmin(req: Request, auth: AdminAuth) {
    if (!auth.configured) throw new MembershipError('membership_not_configured', 503)
    const access = auth.access(req)
    if (!access.method) throw new MembershipError(access.error, access.status)
    if (['cookie', 'account'].includes(access.method) && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !auth.allowWrite(req)) throw new MembershipError('invalid_request', 403)
    return access.method
  }
  private manualPlusActor(req: Request, auth: AdminAuth): string | null {
    return this.requireAdmin(req, auth) === 'account' ? this.requireAccount(req).id : null
  }
  private limit(data: Data, label: string, count: number, window: number): boolean {
    const key = createHmac('sha256', this.options.authSecret).update(label).digest('hex')
    let limit = data.limits.find(l => l.key === key)
    if (!limit) { limit = { key, count: 0, until: this.now() + window }; data.limits.push(limit) }
    limit.count = Math.min(limit.count + 1, count + 1)
    return limit.count <= count
  }
  private limited(label: string, count: number): boolean {
    const key = createHmac('sha256', this.options.authSecret).update(label).digest('hex')
    return this.data.limits.some(l => l.key === key && l.until > this.now() && l.count >= count)
  }
  private codeHash(email: string, salt: string, code: string, purpose?: ChallengePurpose) {
    // Old snapshots omit purpose and keep their original digest readable.
    return createHmac('sha256', this.options.authSecret).update(`${purpose === undefined ? '' : purpose + '\0'}${email}\0${salt}\0${code}`).digest('hex')
  }
  private async reserveSend(email: string, remoteAddress: string): Promise<void> {
    if (this.limited(`send-ip:${remoteAddress}`, 15) || this.limited('send-global', 100) || this.limited(`send-email:${email}`, 3)) throw new MembershipError('rate_limited', 429)
    const allowed = await this.mutate(data => {
      const ipOk = this.limit(data, `send-ip:${remoteAddress}`, 15, 15 * 60_000)
      const globalOk = this.limit(data, 'send-global', 100, 60 * 60_000)
      const emailOk = this.limit(data, `send-email:${email}`, 3, 15 * 60_000)
      return ipOk && globalOk && emailOk
    }, false)
    if (!allowed) throw new MembershipError('rate_limited', 429)
  }
  private async passwordWork<T>(work: () => Promise<T>): Promise<T> {
    try { return await work() }
    catch (error) { if (error instanceof PasswordWorkBusy) throw new MembershipError('rate_limited', 429); throw error }
  }
  private async challenge(email: string, lang: Language, purpose: ChallengePurpose, registration?: { name: string; passwordHash: string; registrationTokenHash: string }): Promise<void> {
    // Reserve before the account lookup and the durable queue. A successful
    // acknowledgement must never silently drop a send when capacity changes.
    const asynchronous = purpose !== 'login'
    if (asynchronous && this.reservedDeliveries >= 16) throw new MembershipError('rate_limited', 429)
    if (asynchronous) this.reservedDeliveries++
    let deliveryOwnsSlot = false
    try {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
      const send = await this.mutate(data => {
        if (data.challenges.length >= MAX_ACTIVE_CHALLENGES) throw new MembershipError('rate_limited', 429)
        const exists = data.accounts.some(a => a.email === email)
        // A signup request can never replace an existing verified account.
        // Unknown reset emails get the same acknowledgement without a new account.
        if ((purpose === 'register' && exists) || (purpose === 'reset' && !exists)) return false
        const salt = randomBytes(16).toString('hex')
        data.challenges = data.challenges.filter(c => c.email !== email || challengePurpose(c) !== purpose)
        data.challenges.push({ email, salt, codeHash: this.codeHash(email, salt, code, purpose), expiresAt: this.now() + 10 * 60_000,
          attempts: 0, purpose, ...(registration ?? {}) })
        return true
      }, false)
      if (send) {
        if (asynchronous) {
          // Registration and reset acknowledge the durable challenge independently
          // of mail latency/failure. Failures remain visible as anonymous metrics.
          const delivery = Promise.resolve().then(() => this.options.sendCode!(email, code, lang))
            .catch(() => { this.deliveryFailures++ }).finally(() => {
              this.resetDeliveries.delete(delivery)
              this.reservedDeliveries--
            })
          this.resetDeliveries.add(delivery)
          deliveryOwnsSlot = true
          return
        }
        try { await this.options.sendCode!(email, code, lang) } catch { throw new MembershipError('email_unavailable', 503) }
      }
    } finally { if (asynchronous && !deliveryOwnsSlot) this.reservedDeliveries-- }
  }
  async requestCode(emailValue: unknown, lang: Language, remoteAddress: string): Promise<void> {
    if (!this.options.sendCode) throw new MembershipError('email_not_configured', 503)
    const email = normalizeMembershipEmail(emailValue)
    if (!email) throw new MembershipError('invalid_email')
    await this.reserveSend(email, remoteAddress)
    await this.challenge(email, lang, 'login')
  }
  async register(nameValue: unknown, emailValue: unknown, password: unknown, lang: Language, remoteAddress: string): Promise<string> {
    if (!this.options.sendCode) throw new MembershipError('email_not_configured', 503)
    const email = normalizeMembershipEmail(emailValue), name = normalizeAccountName(nameValue)
    if (!email) throw new MembershipError('invalid_email')
    if (!name) throw new MembershipError('invalid_name')
    if (!passwordIsAcceptable(password)) throw new MembershipError('invalid_password')
    if (this.reservedDeliveries >= 16) throw new MembershipError('rate_limited', 429)
    await this.reserveSend(email, remoteAddress)
    const passwordHash = await this.passwordWork(() => hashPassword(password))
    const registrationToken = randomBytes(32).toString('base64url')
    await this.challenge(email, lang, 'register', { name, passwordHash, registrationTokenHash: hash(registrationToken) })
    return registrationToken
  }
  async requestPasswordReset(emailValue: unknown, lang: Language, remoteAddress: string): Promise<void> {
    if (!this.options.sendCode) throw new MembershipError('email_not_configured', 503)
    const email = normalizeMembershipEmail(emailValue)
    if (!email) throw new MembershipError('invalid_email')
    // Apply backpressure before looking up the email, with the same response for everyone.
    if (this.reservedDeliveries >= 16) throw new MembershipError('rate_limited', 429)
    await this.reserveSend(email, remoteAddress)
    await this.challenge(email, lang, 'reset')
  }
  private issueSession(data: Data, account: Account, audience?: CookieAudience): MembershipSession {
    // Accounts only reach here after email/password proof. A webhook can never
    // create an account, transfer another account's seat or bypass verification.
    for (const subscription of data.bmcSubscriptions) if (subscription.accountId === null && subscription.email === account.email) subscription.accountId = account.id
    const token = randomBytes(32).toString('base64url'), expiresAt = this.now() + 30 * DAY
    const previous = data.sessions.filter(s => s.accountId === account.id).slice(-9)
    const scope = audience && audience !== 'portal' ? 'game' as const : undefined
    data.sessions = data.sessions.filter(s => s.accountId !== account.id).concat(previous,
      { accountId: account.id, tokenHash: hash(token), expiresAt, ...(audience ? { transport: audience } : {}), ...(scope ? { scope } : {}) })
    return { token, expiresAt, account: this.publicAccount(account, data, scope) }
  }
  private respondWithSession(req: Request, res: Response, session: MembershipSession) {
    if (!cookieAudience(req)) { res.json(session); return }
    setPortalCookie(res, session.token, session.expiresAt, this.now())
    res.json(this.portalSessionView(session.token, session.expiresAt, session.account))
  }
  private portalSessionView(token: string, expiresAt: number, account: MembershipAccount) {
    const sessionKey = createHmac('sha256', this.options.authSecret).update('nrn:portal-ui-session:v1\0').update(token).digest().subarray(0, 16).toString('base64url')
    return { account, expiresAt, session: 'cookie' as const, sessionKey }
  }
  private async upgradeCookieSession(req: Request, res: Response) {
    const audience = cookieAudience(req)
    if (!audience) throw new MembershipError('invalid_request', 403)
    // A second tab may already have upgraded. The device cookie, when present,
    // is authoritative and must never be overwritten by stale browser storage.
    const current = this.accountSession(hash(this.token(req)), audience)
    if (current) {
      res.json(this.portalSessionView(this.token(req), current.session.expiresAt, this.publicAccount(current.account, this.data, current.session.scope)))
      return
    }
    const legacyToken = bearerCredential(req)
    if (!/^[A-Za-z0-9_-]{43}$/.test(legacyToken)) throw new MembershipError('unauthorized', 401)
    const legacyHash = hash(legacyToken)
    if (!this.accountSession(legacyHash)) throw new MembershipError('unauthorized', 401)
    const replacement = await this.mutate(data => {
      const previous = data.sessions.find(value => value.tokenHash === legacyHash && value.transport === undefined)
      const account = previous && data.accounts.find(value => value.id === previous.accountId)
      if (!previous || !account) throw new MembershipError('unauthorized', 401)
      const token = randomBytes(32).toString('base64url')
      previous.tokenHash = hash(token)
      previous.transport = audience
      if (audience !== 'portal') previous.scope = 'game'
      return { token, expiresAt: previous.expiresAt, account: this.publicAccount(account, data, previous.scope) }
    }, false, true)
    this.notify(replacement.account.email)
    this.respondWithSession(req, res, replacement)
  }
  private async reserveVerify(remoteAddress: string): Promise<void> {
    if (this.limited(`verify-ip:${remoteAddress}`, 40)) throw new MembershipError('rate_limited', 429)
    const allowed = await this.mutate(data => this.limit(data, `verify-ip:${remoteAddress}`, 40, 15 * 60_000), false)
    if (!allowed) throw new MembershipError('rate_limited', 429)
  }
  private verifyChallenge(data: Data, email: string, code: string, purpose: ChallengePurpose, registrationToken?: unknown): Challenge | null {
    const challenge = data.challenges.find(c => c.email === email && challengePurpose(c) === purpose)
    if (!challenge || challenge.expiresAt <= this.now() || challenge.attempts >= 5) return null
    const hasRegistrationProof = purpose !== 'register' || (typeof registrationToken === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(registrationToken) &&
      equal(challenge.registrationTokenHash!, hash(registrationToken)))
    if (!hasRegistrationProof || !equal(challenge.codeHash, this.codeHash(email, challenge.salt, code, challenge.purpose))) {
      challenge.attempts++
      return null
    }
    return challenge
  }
  async verifyCode(emailValue: unknown, code: unknown, remoteAddress: string, purpose: 'login' | 'register' = 'login', registrationToken?: unknown, audience?: CookieAudience): Promise<MembershipSession> {
    const email = normalizeMembershipEmail(emailValue)
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new MembershipError('invalid_code')
    if (purpose !== 'login' && purpose !== 'register') throw new MembershipError('invalid_code')
    await this.reserveVerify(remoteAddress)
    const result = await this.mutate(data => {
      const challenge = this.verifyChallenge(data, email, code, purpose, registrationToken)
      if (!challenge) return null
      data.challenges = data.challenges.filter(c => c !== challenge)
      let account = data.accounts.find(a => a.email === email)
      if (!account) {
        account = { id: randomUUID(), email, createdAt: this.now(),
          ...(challenge.purpose === 'register' ? { name: challenge.name!, passwordHash: challenge.passwordHash! } : {}) }
        data.accounts.push(account)
      }
      return this.issueSession(data, account, audience)
    }, false)
    if (!result) throw new MembershipError('invalid_code')
    this.notify(result.account.email)
    return result
  }
  async passwordLogin(emailValue: unknown, password: unknown, remoteAddress: string, audience?: CookieAudience): Promise<MembershipSession> {
    const email = normalizeMembershipEmail(emailValue)
    if (!email || typeof password !== 'string' || !password.length || Buffer.byteLength(password, 'utf8') > 512) throw new MembershipError('invalid_credentials', 401)
    if (this.limited(`password-ip:${remoteAddress}`, 30) || this.limited(`password-email:${email}`, 10) || this.limited('password-global', 200)) throw new MembershipError('rate_limited', 429)
    const allowed = await this.mutate(data => {
      const ipOk = this.limit(data, `password-ip:${remoteAddress}`, 30, 15 * 60_000)
      const emailOk = this.limit(data, `password-email:${email}`, 10, 15 * 60_000)
      const globalOk = this.limit(data, 'password-global', 200, 15 * 60_000)
      return ipOk && emailOk && globalOk
    }, false)
    if (!allowed) throw new MembershipError('rate_limited', 429)
    const account = this.data.accounts.find(a => a.email === email), expectedHash = account?.passwordHash
    const correct = await this.passwordWork(() => verifyPassword(password, expectedHash))
    if (!account || !expectedHash || !correct) throw new MembershipError('invalid_credentials', 401)
    const session = await this.mutate(data => {
      const current = data.accounts.find(a => a.id === account.id)
      // A simultaneous reset invalidates an in-flight password comparison too.
      if (!current || current.passwordHash !== expectedHash) return null
      return this.issueSession(data, current, audience)
    }, false)
    if (!session) throw new MembershipError('invalid_credentials', 401)
    this.notify(session.account.email)
    return session
  }
  async confirmPasswordReset(emailValue: unknown, code: unknown, password: unknown, remoteAddress: string, lang: Language = 'en', audience?: CookieAudience): Promise<MembershipSession> {
    const email = normalizeMembershipEmail(emailValue)
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new MembershipError('invalid_code')
    if (!passwordIsAcceptable(password)) throw new MembershipError('invalid_password')
    await this.reserveVerify(remoteAddress)
    let claimed = false
    try {
      const claim = await this.mutate(data => {
        const challenge = this.verifyChallenge(data, email, code, 'reset')
        const account = data.accounts.find(a => a.email === email)
        if (!challenge || !account) return null
        if (this.pendingPasswordResets.has(email) || this.pendingPasswordResets.size >= MAX_PENDING_PASSWORD_RESETS) throw new MembershipError('rate_limited', 429)
        // Hold only an in-memory reservation while the KDF runs. A worker
        // failure leaves the verified challenge available for a later retry.
        this.pendingPasswordResets.add(email)
        claimed = true
        return { accountId: account.id, previousHash: account.passwordHash, challengeHash: challenge.codeHash }
      }, false)
      if (!claim) throw new MembershipError('invalid_code')
      const passwordHash = await this.passwordWork(() => hashPassword(password))
      const session = await this.mutate(data => {
        const account = data.accounts.find(a => a.id === claim.accountId)
        const challenge = data.challenges.find(c => c.email === email && c.purpose === 'reset' && equal(c.codeHash, claim.challengeHash) && c.expiresAt > this.now())
        if (!challenge || !account || account.passwordHash !== claim.previousHash) return null
        // Revoke outstanding email proofs along with sessions after a password
        // change. The exact reset challenge was checked above, so an older
        // request cannot complete using a replacement reset code.
        data.challenges = data.challenges.filter(c => c.email !== email)
        account.passwordHash = passwordHash
        data.sessions = data.sessions.filter(s => s.accountId !== account.id)
        return this.issueSession(data, account, audience)
      }, false)
      if (!session) throw new MembershipError('invalid_code')
      this.notify(session.account.email)
      this.securityNotices.schedule(session.account, 'password_changed', lang)
      return session
    } finally { if (claimed) this.pendingPasswordResets.delete(email) }
  }
  async grant(emailValue: unknown, expiresAt: unknown, actorAccountId?: string | null) {
    const email = normalizeMembershipEmail(emailValue)
    if (!email) throw new MembershipError('invalid_email')
    if (expiresAt !== null && !time(expiresAt)) throw new MembershipError('invalid_expiry')
    await this.mutate(data => {
      const at = this.now()
      if (expiresAt !== null && expiresAt <= at) throw new MembershipError('invalid_expiry')
      const previous = data.grants.find(g => g.email === email)
      if (previous?.active && previous.expiresAt === expiresAt) return
      data.grants = data.grants.filter(g => g.email !== email)
      data.grants.push({ email, active: true, expiresAt, grantedAt: at })
      recordManualPlusChange(data, actorAccountId, { at, action: 'gift_granted', email, subscriptionId: null, reason: null,
        before: giftAccess(previous, at), after: { active: true, expiresAt } })
    }, false)
    this.notify(email)
  }
  async revokeGift(emailValue: unknown, actorAccountId?: string | null) {
    const email = normalizeMembershipEmail(emailValue)
    if (!email) throw new MembershipError('invalid_email')
    await this.mutate(data => {
      const grant = data.grants.find(g => g.email === email)
      if (!grant?.active) return
      const at = this.now()
      const before = giftAccess(grant, at)
      grant.active = false
      recordManualPlusChange(data, actorAccountId, { at, action: 'gift_revoked', email, subscriptionId: null, reason: null,
        before, after: { active: false, expiresAt: grant.expiresAt } })
    }, false, true)
    this.notify(email)
  }
  private async stripe(path: string, form?: URLSearchParams, idempotencyKey?: string): Promise<Record<string, any>> {
    if (!this.options.stripeSecret) throw new MembershipError('checkout_not_configured', 503)
    try {
      const response = await this.request(`https://api.stripe.com/v1/${path}`, {
        method: form ? 'POST' : 'GET', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.options.stripeSecret}`, 'Stripe-Version': '2025-06-30.basil', ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        ...(form ? { body: form } : {}),
      })
      const body: unknown = await response.json()
      if (!response.ok || !object(body)) throw new Error('Request failed')
      return body
    } catch { throw new MembershipError('payment_unavailable', 503) }
  }
  private async prices(): Promise<StripePrice[]> {
    if (!this.appUrl || !this.options.stripeSecret || !this.options.stripeWebhookSecret) return []
    if (this.priceCache && this.now() - this.priceCache.at < 5 * 60_000) return this.priceCache.prices
    this.priceLoading ??= (async () => {
      const configured = this.options.stripePriceIdEur || this.options.stripePriceIdUsd
        ? [{ id: this.options.stripePriceIdEur, currency: 'eur' }, { id: this.options.stripePriceIdUsd, currency: 'usd' }]
        : [{ id: this.options.stripePriceId, currency: null }]
      const results = await Promise.all(configured.map(async expected => {
        if (!/^price_[a-zA-Z0-9]+$/.test(expected.id ?? '')) return null
        try {
          const p = await this.stripe(`prices/${expected.id}`)
          if (p.id !== expected.id || p.active !== true || p.type !== 'one_time' || p.recurring || !time(p.unit_amount) || p.unit_amount <= 0 ||
              !/^[a-z]{3}$/.test(p.currency) || p.livemode !== this.options.stripeSecret!.startsWith('sk_live_') ||
              (expected.currency && (p.currency !== expected.currency || p.unit_amount !== 499))) return null
          return { id: p.id, amount: p.unit_amount, currency: p.currency } as StripePrice
        } catch { return null }
      }))
      const prices = results.filter((price): price is StripePrice => price !== null)
      if (prices.length) this.priceCache = { prices, at: this.now() }
      return prices
    })().finally(() => { this.priceLoading = null })
    return this.priceLoading
  }
  async config(): Promise<MembershipConfig> {
    const prices = (this.options.bmc ? [] : await this.prices()).map(({ amount, currency }) => ({ amount, currency }))
    return { enabled: true, loginEnabled: !!this.options.sendCode, passwordLoginEnabled: true, checkoutEnabled: !!prices.length && !!this.options.sendCode && this.isHealthy(), price: prices[0] ?? null, prices, ads: this.options.ads ?? { provider: 'disabled', publisherId: null },
      ...(this.options.bmc ? { plus: bmcPublicConfig(this.options.bmc, this.isHealthy(), !!this.options.sendCode) } : {}) }
  }
  async plusCheckout(token: string, currency: unknown, interval: unknown = 'year', audience?: CookieAudience): Promise<string> {
    const account = this.authenticate(token, audience)
    if (!account) throw new MembershipError('unauthorized', 401)
    if (currency !== this.options.bmc?.currency || !['eur', 'usd'].includes(String(currency))) throw new MembershipError('invalid_currency')
    if (interval !== 'year' && interval !== 'month') throw new MembershipError('invalid_interval')
    if (interval === 'month' && this.options.bmc?.monthlyAmount !== 100) throw new MembershipError('invalid_interval')
    if (!bmcReadiness(this.options.bmc, this.isHealthy(), !!this.options.sendCode).ready) throw new MembershipError('plus_not_configured', 503)
    if (account.adFree) throw new MembershipError('already_ad_free', 409)
    // Checkout is hosted by BMC. No credentials or email are put in its URL.
    // A browser return URL, this click, or a donation never grants a right.
    return bmcUrl(this.options.bmc?.membershipUrl)!
  }
  plusReadiness() {
    return { ...bmcReadiness(this.options.bmc, this.isHealthy(), !!this.options.sendCode),
      provider: this.options.bmc ? 'buymeacoffee' : 'disabled',
      subscriptions: this.data.bmcSubscriptions.length,
      lastSignedTestAt: this.data.plusAudit.filter(a => a.kind === 'webhook_test').at(-1)?.at ?? null,
      refundMode: this.options.bmc?.refundMode ?? null }
  }
  async handleBmcWebhook(body: Buffer, signature: string) {
    const event = verifyBmcEvent(body, signature, this.options.bmc?.secret, this.now())
    if (!this.options.bmc?.durableStorage) throw new BmcError('durable_storage_required', 503)
    if (!event.live_mode) {
      await this.mutate(data => {
        const auditId = hash(`bmc-test:${event.type}:${event.created}`)
        if (!data.plusAudit.some(a => a.id === auditId)) data.plusAudit = [...data.plusAudit, { id: auditId, at: this.now(), kind: 'webhook_test' as const, subscriptionId: null, reason: null }].slice(-10_000)
      }, false, true)
      return { received: true, test: true }
    }
    if (!bmcReadiness(this.options.bmc, this.isHealthy(), !!this.options.sendCode).ready) throw new BmcError('plus_not_configured', 503)
    await this.mutate(data => {
      const result = applyBmcEvent(data.bmcSubscriptions, event, this.options.bmc!, data.accounts, this.now())
      if (!result) return
      data.bmcSubscriptions = data.bmcSubscriptions.filter(s => s.id !== result.record.id).concat(result.record)
      data.plusAudit = [...data.plusAudit, result.audit].slice(-10_000)
    }, true, true)
    return { received: true }
  }
  async revokePlus(subscriptionId: unknown, reason: unknown, actorAccountId?: string | null) {
    if (!isBmcSubscriptionId(subscriptionId) || !manualReason(reason)) throw new MembershipError('invalid_request')
    await this.mutate(data => {
      const subscription = data.bmcSubscriptions.find(s => s.id === subscriptionId)
      if (!subscription) throw new MembershipError('subscription_not_found', 404)
      if (subscription.revokedAt !== null) return
      const at = this.now()
      const before = subscriptionAccess(subscription, at)
      subscription.revokedAt = at; subscription.eligible = false
      subscription.expiresAt = Math.min(subscription.expiresAt, at)
      data.plusAudit = [...data.plusAudit, { id: hash(`owner-revoke:${subscriptionId}:${at}:${randomUUID()}`), at, kind: 'owner_revoke' as const, subscriptionId, reason }].slice(-10_000)
      recordManualPlusChange(data, actorAccountId, { at, action: 'subscription_revoked', email: subscription.email, subscriptionId, reason,
        before, after: subscriptionAccess(subscription, at) })
    }, true, true)
  }
  /** An owner attests to a real provider giveaway delivery, never to a payment. */
  async importBmcGiveaway(eventValue: unknown, reason: unknown, actorAccountId?: string | null) {
    if (reason !== 'provider_delivery_recovery') throw new MembershipError('invalid_giveaway')
    if (!bmcReadiness(this.options.bmc, this.isHealthy(), !!this.options.sendCode).ready) throw new MembershipError('plus_not_configured', 503)
    let event: BmcEvent
    try { event = validateBmcEvent(eventValue, this.now()) } catch { throw new MembershipError('invalid_giveaway') }
    if (event.type !== 'membership.started' || !event.live_mode || event.data.duration_type !== 'lifetime-giveaway' ||
        event.data.status !== 'active' || event.data.canceled !== 'false' || event.data.paused !== 'false' || event.data.cancel_at_period_end !== 'false') throw new MembershipError('invalid_giveaway')
    return this.mutate(data => {
      // Validate independently before looking at existing state; malformed input
      // must not turn into a successful no-op or disable a previous entitlement.
      let candidate: ReturnType<typeof applyBmcEvent>
      try { candidate = applyBmcEvent([], event, this.options.bmc!, data.accounts, this.now()) } catch { throw new MembershipError('invalid_giveaway') }
      if (!candidate?.record.eligible || candidate.record.interval !== 'giveaway' || candidate.record.periodStart > this.now() || candidate.record.expiresAt <= this.now()) throw new MembershipError('invalid_giveaway')
      const subscriptionId = candidate.record.id
      const previous = data.bmcSubscriptions.find(record => record.id === subscriptionId)
      if (previous && previous.revokedAt !== null) throw new MembershipError('giveaway_revoked', 409)
      if (previous && previous.email !== candidate.record.email) throw new MembershipError('invalid_giveaway')
      const result = applyBmcEvent(data.bmcSubscriptions, event, this.options.bmc!, data.accounts, this.now())
      if (!result) return { ok: true as const, subscriptionId, imported: false }
      data.bmcSubscriptions = data.bmcSubscriptions.filter(record => record.id !== subscriptionId).concat(result.record)
      data.plusAudit = [...data.plusAudit, { ...result.audit, kind: 'owner_import' as const, reason: 'provider_delivery_recovery' }].slice(-10_000)
      const at = this.now()
      recordManualPlusChange(data, actorAccountId, { at, action: 'giveaway_imported', email: result.record.email, subscriptionId, reason,
        before: previous ? subscriptionAccess(previous, at) : null, after: subscriptionAccess(result.record, at) })
      return { ok: true as const, subscriptionId, imported: true }
    }, true, true)
  }
  async checkout(token: string, currency?: unknown, audience?: CookieAudience): Promise<string> {
    const account = this.authenticate(token, audience)
    if (!account) throw new MembershipError('unauthorized', 401)
    if (this.options.bmc) throw new MembershipError('legacy_checkout_disabled', 409)
    if (this.committedBytes + 4 * 1024 > MAX_SNAPSHOT_BYTES - 256 * 1024) throw new MembershipError('storage_capacity', 503)
    if (currency !== undefined && currency !== 'eur' && currency !== 'usd') throw new MembershipError('invalid_currency')
    const prices = await this.prices()
    const price = currency === undefined ? prices[0] : prices.find(p => p.currency === currency)
    if (!price || !this.appUrl) throw new MembershipError('checkout_not_configured', 503)
    return this.mutate(async data => {
      // Recheck after prior queued account writes, before the external order.
      if (snapshotCapacity(data).bytes + 4 * 1024 > MAX_SNAPSHOT_BYTES - 256 * 1024) throw new MembershipError('storage_capacity', 503)
      const current = data.accounts.find(a => a.id === account.id)!
      if (this.publicAccount(current, data).adFree) throw new MembershipError('already_ad_free', 409)
      const existing = data.orders.find(o => o.accountId === account.id && o.state === 'pending' && o.priceId === price.id && o.amount === price.amount && o.currency === price.currency && this.now() - o.createdAt < 23 * 60 * 60_000 && o.url)
      if (existing?.url) return existing.url
      const order: Order = { id: randomUUID(), accountId: account.id, priceId: price.id, amount: price.amount, currency: price.currency, createdAt: this.now(), sessionId: null, paymentIntentId: null, url: null, state: 'pending' }
      const params = new URLSearchParams({ mode: 'payment', currency: price.currency, 'adaptive_pricing[enabled]': 'false', 'payment_method_types[0]': 'card', 'line_items[0][price]': price.id, 'line_items[0][quantity]': '1', customer_email: account.email, client_reference_id: account.id,
        'metadata[orderId]': order.id, 'metadata[accountId]': account.id, 'payment_intent_data[metadata][orderId]': order.id,
        success_url: `${this.appUrl}/?payment=success`, cancel_url: `${this.appUrl}/?payment=cancelled` })
      const checkout = await this.stripe('checkout/sessions', params, order.id)
      if (!id(checkout.id) || !validCheckoutUrl(checkout.url)) throw new MembershipError('payment_unavailable', 503)
      order.sessionId = checkout.id; order.url = checkout.url
      data.orders.push(order)
      return checkout.url
    })
  }
  async handleStripeEvent(event: Record<string, any>) {
    if (event.livemode !== this.options.stripeSecret?.startsWith('sk_live_')) throw new MembershipError('wrong_payment_mode', 400)
    await this.mutate(data => {
      if (data.events.includes(event.id)) return
      const payload = event.data.object
      if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        const order = data.orders.find(o => o.id === payload.metadata?.orderId)
        if (!order) throw new MembershipError('order_not_found', 409)
        if (order.sessionId !== payload.id || order.accountId !== payload.client_reference_id || payload.metadata?.accountId !== order.accountId ||
            payload.mode !== 'payment' || payload.amount_total !== order.amount || payload.currency !== order.currency) throw new MembershipError('payment_mismatch', 400)
        if (payload.payment_status === 'paid' && id(payload.payment_intent)) {
          order.paymentIntentId = payload.payment_intent
          if (order.state !== 'revoked' && !data.revokedPayments.includes(payload.payment_intent)) order.state = 'paid'
          else order.state = 'revoked'
        }
      } else if ((event.type === 'charge.refunded' && payload.refunded === true) || event.type === 'charge.dispute.created') {
        if (id(payload.payment_intent)) {
          if (!data.revokedPayments.includes(payload.payment_intent)) data.revokedPayments.push(payload.payment_intent)
          for (const order of data.orders) if (order.paymentIntentId === payload.payment_intent) order.state = 'revoked'
        }
      }
      data.events.push(event.id)
      // Order state and revoked payment IDs are the lasting replay protection.
      data.events = data.events.slice(-10_000)
    }, true, true)
  }
  registerRoutes(app: Express, origins: string[] = []) {
    const admin = new AdminAuth(this.options.dashboardKey, [...origins, ...(this.appUrl ? [this.appUrl] : [])], this.now, this.adminAccountVerifier())
    const run = (handler: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow')
      Promise.resolve().then(() => {
        if (cookieRequested(req) && !cookieAudience(req)) throw new MembershipError('invalid_request', 403)
        this.requireHealthy()
        return handler(req, res)
      }).catch(error => {
        const known = error instanceof MembershipError || error instanceof GameSignInError || error instanceof BmcError
        if (!res.headersSent) res.status(known ? error.status : 503).json({ error: known ? error.code : 'server_unavailable' })
      })
    }
    app.post('/api/membership/stripe-webhook', express.raw({ type: 'application/json', limit: '256kb', inflate: false }), run(async (req, res) => {
      if (!this.options.stripeWebhookSecret || !this.options.stripeSecret) throw new MembershipError('checkout_not_configured', 503)
      const event = verifyStripeEvent(req.body, req.get('stripe-signature') ?? '', this.options.stripeWebhookSecret, this.now())
      await this.handleStripeEvent(event); res.json({ received: true })
    }))
    app.post('/api/membership/bmc-webhook', express.raw({ type: 'application/json', limit: '256kb', inflate: false }), run(async (req, res) => {
      res.json(await this.handleBmcWebhook(req.body, req.get('x-signature-sha256') ?? ''))
    }))
    const json = express.json({ limit: '4kb', inflate: false })
    app.post('/api/membership/session/upgrade', json, run((req, res) => this.upgradeCookieSession(req, res)))
    app.post('/api/membership/socket-ticket', json, run((req, res) => this.cookieSocketTicket(req, res)))
    app.post('/api/membership/game-authorize', json, run((req, res) => {
      this.requireAccount(req)
      res.json(this.gameSignIn.authorize(this.token(req), req.body?.origin, req.body?.challenge, req.ip ?? 'unknown'))
    }))
    app.post('/api/membership/game-exchange', json, run(async (req, res) => {
      const audience = cookieAudience(req)
      const origin = audience ? cookieRequestOrigin(req, audience) : req.get('origin')
      const previous = audience ? this.token(req) || undefined : req.body?.previousToken
      this.respondWithSession(req, res, await this.gameSignIn.exchange(req.body?.code, req.body?.verifier, origin, req.ip ?? 'unknown', previous, audience))
    }))
    app.get('/api/membership/config', run(async (_req, res) => res.json(await this.config())))
    app.post('/api/membership/login', json, run(async (req, res) => {
      // Express's default socket address is deliberately used; forwarded IPs are
      // untrusted unless deployment explicitly configures a trusted proxy.
      await this.requestCode(req.body?.email, req.body?.lang === 'es' ? 'es' : 'en', req.ip ?? 'unknown'); res.json({ ok: true })
    }))
    app.post('/api/membership/verify', json, run(async (req, res) => {
      this.respondWithSession(req, res, await this.verifyCode(req.body?.email, req.body?.code, req.ip ?? 'unknown', req.body?.purpose, req.body?.registrationToken, cookieAudience(req)))
    }))
    app.post('/api/membership/register', json, run(async (req, res) => {
      const registrationToken = await this.register(req.body?.name, req.body?.email, req.body?.password, req.body?.lang === 'es' ? 'es' : 'en', req.ip ?? 'unknown')
      res.json({ ok: true, registrationToken })
    }))
    app.post('/api/membership/password-login', json, run(async (req, res) => {
      this.respondWithSession(req, res, await this.passwordLogin(req.body?.email, req.body?.password, req.ip ?? 'unknown', cookieAudience(req)))
    }))
    app.post('/api/membership/password-reset', json, run(async (req, res) => {
      await this.requestPasswordReset(req.body?.email, req.body?.lang === 'es' ? 'es' : 'en', req.ip ?? 'unknown')
      res.json({ ok: true })
    }))
    app.post('/api/membership/password-reset/confirm', json, run(async (req, res) => {
      this.respondWithSession(req, res, await this.confirmPasswordReset(req.body?.email, req.body?.code, req.body?.password,
        req.ip ?? 'unknown', req.body?.lang === 'es' ? 'es' : 'en', cookieAudience(req)))
    }))
    app.get('/api/membership/me', run((req, res) => {
      const account = this.requireAccount(req)
      const tokenHash = hash(this.token(req))
      const session = this.data.sessions.find(s => s.tokenHash === tokenHash)!
      res.json(cookieAudience(req) ? this.portalSessionView(this.token(req), session.expiresAt, account) : { account, expiresAt: session.expiresAt })
    }))
    app.post('/api/membership/logout', run(async (req, res) => {
      const account = this.authenticateRequest(req)
      if (account) {
        const tokenHash = hash(this.token(req))
        await this.mutate(data => { data.sessions = data.sessions.filter(s => s.tokenHash !== tokenHash) }, false)
        this.notify(account.email)
      }
      if (cookieAudience(req)) clearPortalCookie(res)
      res.json({ ok: true })
    }))
    app.post('/api/membership/sessions/revoke-others', json, run(async (req, res) => {
      this.respondWithSession(req, res, await this.revokeOtherSessions(this.token(req), req.body?.lang === 'es' ? 'es' : 'en', cookieAudience(req)))
    }))
    app.post('/api/membership/checkout', json, run(async (req, res) => res.json({ url: await this.checkout(this.token(req), req.body?.currency, cookieAudience(req)) })))
    app.post('/api/membership/plus/checkout', json, run(async (req, res) => res.json({ url: await this.plusCheckout(this.token(req), req.body?.currency, req.body?.interval, cookieAudience(req)) })))
    app.get('/api/admin/plus/readiness', run((req, res) => { this.requireAdmin(req, admin); res.json(this.plusReadiness()) }))
    app.get('/api/admin/plus/subscriptions', run((req, res) => {
      this.requireAdmin(req, admin)
      const accountEmails = new Map(this.data.accounts.map(account => [account.id, account.email]))
      res.json({ subscriptions: this.data.bmcSubscriptions.map(s => ({ id: s.id, email: s.email, accountId: s.accountId,
        expiresAt: s.expiresAt, interval: s.interval, eligible: s.eligible, cancelAtPeriodEnd: s.cancelAtPeriodEnd, revokedAt: s.revokedAt })),
        audit: this.data.plusAudit.slice(-100),
        manualAudit: this.data.manualPlusAudit.slice(-100).map((entry): ManualPlusAudit => ({
          id: entry.id, at: entry.at, action: entry.action, email: entry.email,
          actorEmail: entry.actorAccountId === null ? null : accountEmails.get(entry.actorAccountId) ?? null,
          subscriptionId: entry.subscriptionId, reason: entry.reason,
          before: entry.before ? { active: entry.before.active, expiresAt: entry.before.expiresAt } : null,
          after: { active: entry.after.active, expiresAt: entry.after.expiresAt },
        })),
      })
    }))
    app.post('/api/admin/plus/revoke', json, run(async (req, res) => {
      const actor = this.manualPlusActor(req, admin)
      if (!admin.allowWrite(req)) throw new MembershipError('invalid_request', 403)
      await this.revokePlus(req.body?.subscriptionId, req.body?.reason, actor); res.json({ ok: true })
    }))
    app.post('/api/admin/plus/giveaways/import', json, run(async (req, res) => {
      const actor = this.manualPlusActor(req, admin)
      if (!admin.allowWrite(req)) throw new MembershipError('invalid_request', 403)
      res.json(await this.importBmcGiveaway(req.body?.event, req.body?.reason, actor))
    }))
    app.get('/api/admin/memberships', run((req, res) => { this.requireAdmin(req, admin); res.json({ grants: this.data.grants.map(g => ({ ...g })).sort((a, b) => b.grantedAt - a.grantedAt) }) }))
    app.post('/api/admin/memberships/grant', json, run(async (req, res) => {
      await this.grant(req.body?.email, req.body?.expiresAt ?? null, this.manualPlusActor(req, admin)); res.json({ ok: true })
    }))
    app.post('/api/admin/memberships/revoke', json, run(async (req, res) => {
      await this.revokeGift(req.body?.email, this.manualPlusActor(req, admin)); res.json({ ok: true })
    }))
    // JSON/parser failures must not echo private input or a stack trace.
    app.use(['/api/membership', '/api/admin/memberships', '/api/admin/plus'], (error: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) { next(error); return }
      const tooLarge = object(error) && error.type === 'entity.too.large'
      const compressed = object(error) && error.type === 'encoding.unsupported'
      res.set('Cache-Control', 'no-store').status(tooLarge ? 413 : compressed ? 415 : 400).json({ error: 'invalid_request' })
    })
  }
}

export function adConfigFromEnvironment(env: NodeJS.ProcessEnv): MembershipConfig['ads'] {
  if (env.ADS_PROVIDER !== 'google-h5' || env.ADS_CONSENT_READY !== 'true') return { provider: 'disabled', publisherId: null }
  if (!/^ca-pub-\d{16}$/.test(env.ADSENSE_PUBLISHER_ID ?? '')) return { provider: 'disabled', publisherId: null }
  return { provider: 'google-h5', publisherId: env.ADSENSE_PUBLISHER_ID!, consentReady: true }
}
export async function createMembershipService(env: NodeJS.ProcessEnv = process.env): Promise<MembershipService | undefined> {
  if (env.MEMBERSHIP_ENABLED !== 'true') {
    if (env.ADMIN_ACCOUNT_EMAILS !== undefined) throw new Error('Enable accounts before configuring account-only administration')
    return undefined
  }
  const secret = env.MEMBERSHIP_AUTH_SECRET?.trim() ?? ''
  if (secret.length < 32) throw new Error('Set a strong MEMBERSHIP_AUTH_SECRET before enabling accounts')
  const adminEmails = adminEmailsFromEnvironment(env)
  const localPaths = snapshotStorageMode(env) === 'file' ? localSnapshotPaths(env) : null
  if (localPaths) await requireInstalledLocalSnapshots(env, localPaths)
  const store = localPaths ? await FileSnapshotStore.open(localPaths.membership)
    : env.DATABASE_URL ? await PostgresSnapshotStore.open(env.DATABASE_URL, 'membership')
    : env.MEMBERSHIP_STATE_PATH ? await FileSnapshotStore.open(env.MEMBERSHIP_STATE_PATH)
    : env.NODE_ENV !== 'production' && env.RENDER !== 'true' && !env.RAILWAY_ENVIRONMENT_ID ? await FileSnapshotStore.open(resolve('data/memberships.json'))
    : null
  if (!store) throw new Error('Memberships require DATABASE_URL or MEMBERSHIP_STATE_PATH on a persistent volume')
  const sendCode = createMembershipEmailSender(env)
  try {
    return await new MembershipService({ store, authSecret: secret, dashboardKey: env.ADMIN_DASHBOARD_KEY, adminEmails, sendCode, sendSecurityNotice: sendCode?.securityNotice, stripeSecret: env.STRIPE_SECRET_KEY, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET, stripePriceId: env.STRIPE_PRICE_ID, stripePriceIdEur: env.STRIPE_PRICE_ID_EUR, stripePriceIdUsd: env.STRIPE_PRICE_ID_USD, appUrl: env.PUBLIC_APP_URL,
      gameOrigins: gameOriginsFromEnvironment(env), allowLocalGameOrigins: env.NODE_ENV !== 'production' && env.RENDER !== 'true' && !env.RAILWAY_ENVIRONMENT_ID,
      ads: adConfigFromEnvironment(env), bmc: bmcFromEnvironment(env) }).load()
  } catch (error) { await store.close(); throw error }
}
