import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { FileSnapshotStore, PostgresSnapshotStore, MAX_SNAPSHOT_BYTES, SnapshotCapacityError, snapshotCapacity, type SnapshotStore } from './storage.js'
import { createMembershipEmailSender } from './membershipEmail.js'
import { AdminAuth } from './adminAuth.js'
import { hashPassword, verifyPassword, isStoredPasswordHash, passwordIsAcceptable, PasswordWorkBusy } from './passwordAuth.js'
import { DEFAULT_GAME_ORIGINS, GameSignInBroker, GameSignInError, gameOriginsFromEnvironment, validateGameOrigins } from './gameSignIn.js'
import { applyBmcEvent, bmcEntitlement, bmcFromEnvironment, bmcPublicConfig, bmcReadiness, bmcUrl, BmcError, isBmcSubscriptionId, parseBmcSubscriptions, parsePlusAudit, validateBmcEvent, verifyBmcEvent, type BmcEvent, type BmcOptions, type BmcSubscription, type PlusAudit } from './membershipBmc.js'
import type { MembershipAccount, MembershipConfig, MembershipGrant, MembershipSession } from '../../shared/membership.js'

export type { MembershipAccount } from '../../shared/membership.js'
type Language = 'en' | 'es'
type Account = { id: string; email: string; createdAt: number; name?: string; passwordHash?: string }
type Session = { accountId: string; tokenHash: string; expiresAt: number }
type ChallengePurpose = 'login' | 'register' | 'reset'
type Challenge = { email: string; salt: string; codeHash: string; expiresAt: number; attempts: number; purpose?: ChallengePurpose; name?: string; passwordHash?: string; registrationTokenHash?: string }
type Limit = { key: string; count: number; until: number }
type Order = { id: string; accountId: string; priceId: string; amount: number; currency: string; createdAt: number; sessionId: string | null; paymentIntentId: string | null; url: string | null; state: 'pending' | 'paid' | 'revoked' }
type Data = { version: 1 | 2; accounts: Account[]; sessions: Session[]; challenges: Challenge[]; limits: Limit[]; grants: MembershipGrant[]; orders: Order[]; revokedPayments: string[]; events: string[]; bmcSubscriptions: BmcSubscription[]; plusAudit: PlusAudit[] }
type StripePrice = { id: string; amount: number; currency: string }
type EmailSender = (email: string, code: string, lang: Language) => Promise<void>
export interface MembershipOptions {
  store: SnapshotStore
  authSecret: string
  dashboardKey?: string
  sendCode?: EmailSender
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
class MembershipError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}
export function normalizeAccountName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length > 0 && name.length <= 24 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null
}
const empty = (): Data => ({ version: 1, accounts: [], sessions: [], challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [], bmcSubscriptions: [], plusAudit: [] })
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
  if (!v.sessions.every(s => object(s) && accountIds.has(s.accountId) && digest(s.tokenHash) && time(s.expiresAt)) ||
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
  private listeners = new Set<() => void>()
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
  constructor(private readonly options: MembershipOptions) {
    if (options.authSecret.length < 32) throw new Error('MEMBERSHIP_AUTH_SECRET must contain at least 32 characters')
    this.now = options.now ?? Date.now
    this.request = options.request ?? fetch
    this.appUrl = validAppUrl(options.appUrl)
    this.gameSignIn = new GameSignInBroker(
      validateGameOrigins(options.gameOrigins ?? DEFAULT_GAME_ORIGINS, options.allowLocalGameOrigins === true),
      sourceTokenHash => this.linkedSessionByHash(sourceTokenHash), this.now,
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
  emailDeliveryStatus() { return { pending: this.reservedDeliveries, failures: this.deliveryFailures } }
  storageCapacity() {
    return { bytes: this.committedBytes, limitBytes: MAX_SNAPSHOT_BYTES,
      usedPercent: Math.round(this.committedBytes / MAX_SNAPSHOT_BYTES * 1000) / 10,
      warning: this.committedBytes >= MAX_SNAPSHOT_BYTES * 0.75,
      growthAllowed: this.committedBytes < MAX_SNAPSHOT_BYTES - 256 * 1024 }
  }
  onChange(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify() { for (const listener of this.listeners) { try { listener() } catch { /* A UI listener cannot undo a committed payment. */ } } }
  private requireHealthy() {
    if (this.isHealthy()) return
    const firstFailure = !this.failed
    this.failed = true
    if (firstFailure) this.notify()
    throw new MembershipError('server_unavailable', 503)
  }
  async close() {
    await this.queue
    if (this.resetDeliveries.size) {
      let timer: NodeJS.Timeout | undefined
      try {
        await Promise.race([Promise.allSettled(this.resetDeliveries), new Promise<void>(resolve => { timer = setTimeout(resolve, 15_000) })])
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
  private publicAccount(account: Account, data = this.data): MembershipAccount {
    const purchased = data.orders.some(o => o.accountId === account.id && o.state === 'paid')
    const gift = data.grants.find(g => g.email === account.email && g.active && (g.expiresAt === null || g.expiresAt > this.now()))
    const bmc = bmcEntitlement(data.bmcSubscriptions, account, this.now())
    const giftWins = !!gift && (gift.expiresAt === null || !bmc.active || gift.expiresAt >= (bmc.expiresAt ?? 0))
    const plus = purchased ? { active: true, expiresAt: null, provider: 'legacy' as const, status: 'active' as const, cancelAtPeriodEnd: false }
      : giftWins ? { active: true, expiresAt: gift!.expiresAt, provider: 'gift' as const, status: 'active' as const, cancelAtPeriodEnd: false } : bmc
    return { id: account.id, email: account.email, ...(account.name === undefined ? {} : { name: account.name }), ...(account.passwordHash === undefined ? {} : { hasPassword: true }), adFree: plus.active,
      source: purchased ? 'purchase' : giftWins || bmc.active && bmc.complimentary ? 'gift' : bmc.active ? 'purchase' : null, expiresAt: plus.expiresAt, plus }
  }
  authenticate(token: string): MembershipAccount | null {
    if (!this.isHealthy() || typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null
    const session = this.data.sessions.find(s => s.tokenHash === hash(token) && s.expiresAt > this.now())
    const account = session && this.data.accounts.find(a => a.id === session.accountId)
    return account ? this.publicAccount(account) : null
  }
  gameSignInCors(issuerOrigins: string[] = []) {
    return this.gameSignIn.cors([...issuerOrigins, ...(this.appUrl ? [this.appUrl] : []), 'https://nrnplay.com', 'https://www.nrnplay.com'])
  }
  /** A new game receives a separate session; the source credential never leaves this server. */
  linkedSession(sourceToken: string): Promise<MembershipSession> {
    if (typeof sourceToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(sourceToken)) return Promise.reject(new MembershipError('unauthorized', 401))
    return this.linkedSessionByHash(hash(sourceToken))
  }
  private linkedSessionByHash(sourceTokenHash: string): Promise<MembershipSession> {
    return this.mutate(data => {
      // Recheck inside the mutation queue so logout/reset before exchange revokes the proof.
      const source = data.sessions.find(session => session.tokenHash === sourceTokenHash && session.expiresAt > this.now())
      const account = source && data.accounts.find(candidate => candidate.id === source.accountId)
      if (!source || !account) throw new MembershipError('unauthorized', 401)
      const token = randomBytes(32).toString('base64url')
      const expiresAt = Math.min(source.expiresAt, this.now() + 30 * DAY)
      const previous = data.sessions.filter(session => session.accountId === account.id && session.tokenHash !== sourceTokenHash).slice(-8)
      data.sessions = data.sessions.filter(session => session.accountId !== account.id)
        .concat(source, previous, { accountId: account.id, tokenHash: hash(token), expiresAt })
      return { token, expiresAt, account: this.publicAccount(account, data) }
    })
  }
  private requireAccount(req: Request): MembershipAccount {
    const account = this.authenticate(this.token(req))
    if (!account) throw new MembershipError('unauthorized', 401)
    return account
  }
  private token(req: Request) { const auth = req.get('authorization') ?? ''; return auth.startsWith('Bearer ') ? auth.slice(7) : '' }
  private requireAdmin(req: Request, auth: AdminAuth) {
    if (!auth.configured) throw new MembershipError('membership_not_configured', 503)
    const method = auth.authenticate(req)
    if (!method) throw new MembershipError('unauthorized', 401)
    if (method === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !auth.allowWrite(req)) throw new MembershipError('invalid_request', 403)
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
        const exists = data.accounts.some(a => a.email === email)
        // A signup request can never replace an existing verified account.
        // Unknown reset emails get the same acknowledgement without a new account.
        if ((purpose === 'register' && exists) || (purpose === 'reset' && !exists)) return false
        const salt = randomBytes(16).toString('hex')
        data.challenges = data.challenges.filter(c => c.email !== email)
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
  private issueSession(data: Data, account: Account): MembershipSession {
    // Accounts only reach here after email/password proof. A webhook can never
    // create an account, transfer another account's seat or bypass verification.
    for (const subscription of data.bmcSubscriptions) if (subscription.accountId === null && subscription.email === account.email) subscription.accountId = account.id
    const token = randomBytes(32).toString('base64url'), expiresAt = this.now() + 30 * DAY
    const previous = data.sessions.filter(s => s.accountId === account.id).slice(-9)
    data.sessions = data.sessions.filter(s => s.accountId !== account.id).concat(previous, { accountId: account.id, tokenHash: hash(token), expiresAt })
    return { token, expiresAt, account: this.publicAccount(account, data) }
  }
  private async reserveVerify(remoteAddress: string): Promise<void> {
    if (this.limited(`verify-ip:${remoteAddress}`, 40)) throw new MembershipError('rate_limited', 429)
    const allowed = await this.mutate(data => this.limit(data, `verify-ip:${remoteAddress}`, 40, 15 * 60_000), false)
    if (!allowed) throw new MembershipError('rate_limited', 429)
  }
  private consumeChallenge(data: Data, email: string, code: string, purpose: ChallengePurpose, registrationToken?: unknown): Challenge | null {
    const challenge = data.challenges.find(c => c.email === email)
    if (!challenge || challenge.expiresAt <= this.now() || challenge.attempts >= 5 ||
        (challenge.purpose ?? 'login') !== purpose) return null
    challenge.attempts++
    if (purpose === 'register' && (typeof registrationToken !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(registrationToken) ||
        !equal(challenge.registrationTokenHash!, hash(registrationToken)))) return null
    if (!equal(challenge.codeHash, this.codeHash(email, challenge.salt, code, challenge.purpose))) return null
    data.challenges = data.challenges.filter(c => c !== challenge)
    return challenge
  }
  async verifyCode(emailValue: unknown, code: unknown, remoteAddress: string, purpose: 'login' | 'register' = 'login', registrationToken?: unknown): Promise<MembershipSession> {
    const email = normalizeMembershipEmail(emailValue)
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new MembershipError('invalid_code')
    if (purpose !== 'login' && purpose !== 'register') throw new MembershipError('invalid_code')
    await this.reserveVerify(remoteAddress)
    const result = await this.mutate(data => {
      const challenge = this.consumeChallenge(data, email, code, purpose, registrationToken)
      if (!challenge) return null
      let account = data.accounts.find(a => a.email === email)
      if (!account) {
        account = { id: randomUUID(), email, createdAt: this.now(),
          ...(challenge.purpose === 'register' ? { name: challenge.name!, passwordHash: challenge.passwordHash! } : {}) }
        data.accounts.push(account)
      }
      return this.issueSession(data, account)
    }, false)
    if (!result) throw new MembershipError('invalid_code')
    this.notify()
    return result
  }
  async passwordLogin(emailValue: unknown, password: unknown, remoteAddress: string): Promise<MembershipSession> {
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
      return this.issueSession(data, current)
    }, false)
    if (!session) throw new MembershipError('invalid_credentials', 401)
    this.notify()
    return session
  }
  async confirmPasswordReset(emailValue: unknown, code: unknown, password: unknown, remoteAddress: string): Promise<MembershipSession> {
    const email = normalizeMembershipEmail(emailValue)
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new MembershipError('invalid_code')
    if (!passwordIsAcceptable(password)) throw new MembershipError('invalid_password')
    await this.reserveVerify(remoteAddress)
    // Verify and claim the one-use challenge before expensive work, but do not
    // change a password or session until the resulting hash is durable.
    const claim = await this.mutate(data => {
      const challenge = this.consumeChallenge(data, email, code, 'reset')
      const account = data.accounts.find(a => a.email === email)
      return challenge && account ? { accountId: account.id, previousHash: account.passwordHash, challengeHash: challenge.codeHash } : null
    }, false)
    if (!claim) throw new MembershipError('invalid_code')
    const passwordHash = await this.passwordWork(() => hashPassword(password))
    const session = await this.mutate(data => {
      const account = data.accounts.find(a => a.id === claim.accountId)
      if (!account || account.passwordHash !== claim.previousHash) return null
      account.passwordHash = passwordHash
      data.sessions = data.sessions.filter(s => s.accountId !== account.id)
      return this.issueSession(data, account)
    }, false)
    if (!session) throw new MembershipError('invalid_code')
    this.notify()
    return session
  }
  async grant(emailValue: unknown, expiresAt: unknown) {
    const email = normalizeMembershipEmail(emailValue)
    if (!email) throw new MembershipError('invalid_email')
    if (expiresAt !== null && (!time(expiresAt) || expiresAt <= this.now())) throw new MembershipError('invalid_expiry')
    await this.mutate(data => {
      data.grants = data.grants.filter(g => g.email !== email)
      data.grants.push({ email, active: true, expiresAt: expiresAt as number | null, grantedAt: this.now() })
    })
  }
  async revokeGift(emailValue: unknown) {
    const email = normalizeMembershipEmail(emailValue)
    if (!email) throw new MembershipError('invalid_email')
    await this.mutate(data => { const grant = data.grants.find(g => g.email === email); if (grant) grant.active = false }, true, true)
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
  async plusCheckout(token: string, currency: unknown, interval: unknown = 'year'): Promise<string> {
    const account = this.authenticate(token)
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
  async revokePlus(subscriptionId: unknown, reason: unknown) {
    if (!isBmcSubscriptionId(subscriptionId) || !['refund', 'dispute', 'provider_correction'].includes(String(reason))) throw new MembershipError('invalid_request')
    await this.mutate(data => {
      const subscription = data.bmcSubscriptions.find(s => s.id === subscriptionId)
      if (!subscription) throw new MembershipError('subscription_not_found', 404)
      if (subscription.revokedAt !== null) return
      subscription.revokedAt = this.now(); subscription.eligible = false
      subscription.expiresAt = Math.min(subscription.expiresAt, this.now())
      data.plusAudit = [...data.plusAudit, { id: hash(`owner-revoke:${subscriptionId}:${this.now()}:${randomUUID()}`), at: this.now(), kind: 'owner_revoke' as const, subscriptionId, reason: String(reason) }].slice(-10_000)
    }, true, true)
  }
  /** An owner attests to a real provider giveaway delivery, never to a payment. */
  async importBmcGiveaway(eventValue: unknown, reason: unknown) {
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
      return { ok: true as const, subscriptionId, imported: true }
    }, true, true)
  }
  async checkout(token: string, currency?: unknown): Promise<string> {
    const account = this.authenticate(token)
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
    const admin = new AdminAuth(this.options.dashboardKey, [...origins, ...(this.appUrl ? [this.appUrl] : [])], this.now)
    const run = (handler: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow')
      Promise.resolve().then(() => { this.requireHealthy(); return handler(req, res) }).catch(error => {
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
    app.post('/api/membership/game-authorize', json, run((req, res) => {
      this.requireAccount(req)
      res.json(this.gameSignIn.authorize(this.token(req), req.body?.origin, req.body?.challenge, req.ip ?? 'unknown'))
    }))
    app.post('/api/membership/game-exchange', json, run(async (req, res) => {
      res.json(await this.gameSignIn.exchange(req.body?.code, req.body?.verifier, req.get('origin'), req.ip ?? 'unknown'))
    }))
    app.get('/api/membership/config', run(async (_req, res) => res.json(await this.config())))
    app.post('/api/membership/login', json, run(async (req, res) => {
      // Express's default socket address is deliberately used; forwarded IPs are
      // untrusted unless deployment explicitly configures a trusted proxy.
      await this.requestCode(req.body?.email, req.body?.lang === 'es' ? 'es' : 'en', req.ip ?? 'unknown'); res.json({ ok: true })
    }))
    app.post('/api/membership/verify', json, run(async (req, res) => res.json(await this.verifyCode(req.body?.email, req.body?.code, req.ip ?? 'unknown', req.body?.purpose, req.body?.registrationToken))))
    app.post('/api/membership/register', json, run(async (req, res) => {
      const registrationToken = await this.register(req.body?.name, req.body?.email, req.body?.password, req.body?.lang === 'es' ? 'es' : 'en', req.ip ?? 'unknown')
      res.json({ ok: true, registrationToken })
    }))
    app.post('/api/membership/password-login', json, run(async (req, res) => res.json(await this.passwordLogin(req.body?.email, req.body?.password, req.ip ?? 'unknown'))))
    app.post('/api/membership/password-reset', json, run(async (req, res) => {
      await this.requestPasswordReset(req.body?.email, req.body?.lang === 'es' ? 'es' : 'en', req.ip ?? 'unknown')
      res.json({ ok: true })
    }))
    app.post('/api/membership/password-reset/confirm', json, run(async (req, res) => res.json(await this.confirmPasswordReset(req.body?.email, req.body?.code, req.body?.password, req.ip ?? 'unknown'))))
    app.get('/api/membership/me', run((req, res) => {
      const account = this.requireAccount(req)
      const session = this.data.sessions.find(s => s.tokenHash === hash(this.token(req)))!
      res.json({ account, expiresAt: session.expiresAt })
    }))
    app.post('/api/membership/logout', run(async (req, res) => {
      if (!this.authenticate(this.token(req))) { res.json({ ok: true }); return }
      const tokenHash = hash(this.token(req)); await this.mutate(data => { data.sessions = data.sessions.filter(s => s.tokenHash !== tokenHash) }); res.json({ ok: true })
    }))
    app.post('/api/membership/checkout', json, run(async (req, res) => res.json({ url: await this.checkout(this.token(req), req.body?.currency) })))
    app.post('/api/membership/plus/checkout', json, run(async (req, res) => res.json({ url: await this.plusCheckout(this.token(req), req.body?.currency, req.body?.interval) })))
    app.get('/api/admin/plus/readiness', run((req, res) => { this.requireAdmin(req, admin); res.json(this.plusReadiness()) }))
    app.get('/api/admin/plus/subscriptions', run((req, res) => {
      this.requireAdmin(req, admin)
      res.json({ subscriptions: this.data.bmcSubscriptions.map(s => ({ id: s.id, email: s.email, accountId: s.accountId,
        expiresAt: s.expiresAt, interval: s.interval, eligible: s.eligible, cancelAtPeriodEnd: s.cancelAtPeriodEnd, revokedAt: s.revokedAt })),
        audit: this.data.plusAudit.slice(-100) })
    }))
    app.post('/api/admin/plus/revoke', json, run(async (req, res) => {
      this.requireAdmin(req, admin)
      if (!admin.allowWrite(req)) throw new MembershipError('invalid_request', 403)
      await this.revokePlus(req.body?.subscriptionId, req.body?.reason); res.json({ ok: true })
    }))
    app.post('/api/admin/plus/giveaways/import', json, run(async (req, res) => {
      this.requireAdmin(req, admin)
      if (!admin.allowWrite(req)) throw new MembershipError('invalid_request', 403)
      res.json(await this.importBmcGiveaway(req.body?.event, req.body?.reason))
    }))
    app.get('/api/admin/memberships', run((req, res) => { this.requireAdmin(req, admin); res.json({ grants: this.data.grants.map(g => ({ ...g })).sort((a, b) => b.grantedAt - a.grantedAt) }) }))
    app.post('/api/admin/memberships/grant', json, run(async (req, res) => { this.requireAdmin(req, admin); await this.grant(req.body?.email, req.body?.expiresAt ?? null); res.json({ ok: true }) }))
    app.post('/api/admin/memberships/revoke', json, run(async (req, res) => { this.requireAdmin(req, admin); await this.revokeGift(req.body?.email); res.json({ ok: true }) }))
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
  if (env.MEMBERSHIP_ENABLED !== 'true') return undefined
  const secret = env.MEMBERSHIP_AUTH_SECRET?.trim() ?? ''
  if (secret.length < 32) throw new Error('Set a strong MEMBERSHIP_AUTH_SECRET before enabling accounts')
  const store = env.DATABASE_URL ? await PostgresSnapshotStore.open(env.DATABASE_URL, 'membership')
    : env.MEMBERSHIP_STATE_PATH ? await FileSnapshotStore.open(env.MEMBERSHIP_STATE_PATH)
    : env.NODE_ENV !== 'production' && env.RENDER !== 'true' && !env.RAILWAY_ENVIRONMENT_ID ? await FileSnapshotStore.open(resolve('data/memberships.json'))
    : null
  if (!store) throw new Error('Memberships require DATABASE_URL or MEMBERSHIP_STATE_PATH on a persistent volume')
  const sendCode = createMembershipEmailSender(env)
  try {
    return await new MembershipService({ store, authSecret: secret, dashboardKey: env.ADMIN_DASHBOARD_KEY, sendCode, stripeSecret: env.STRIPE_SECRET_KEY, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET, stripePriceId: env.STRIPE_PRICE_ID, stripePriceIdEur: env.STRIPE_PRICE_ID_EUR, stripePriceIdUsd: env.STRIPE_PRICE_ID_USD, appUrl: env.PUBLIC_APP_URL,
      gameOrigins: gameOriginsFromEnvironment(env), allowLocalGameOrigins: env.NODE_ENV !== 'production' && env.RENDER !== 'true' && !env.RAILWAY_ENVIRONMENT_ID,
      ads: adConfigFromEnvironment(env), bmc: bmcFromEnvironment(env) }).load()
  } catch (error) { await store.close(); throw error }
}
