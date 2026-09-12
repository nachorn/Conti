import express, { type Express, type Request, type Response, type NextFunction } from 'express'
import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { resolve } from 'node:path'
import { FileSnapshotStore, PostgresSnapshotStore, type SnapshotStore } from './storage.js'
import { createMembershipEmailSender } from './membershipEmail.js'
import type { MembershipAccount, MembershipConfig, MembershipGrant, MembershipSession } from '../../shared/membership.js'

export type { MembershipAccount } from '../../shared/membership.js'
type Language = 'en' | 'es'
type Account = { id: string; email: string; createdAt: number }
type Session = { accountId: string; tokenHash: string; expiresAt: number }
type Challenge = { email: string; salt: string; codeHash: string; expiresAt: number; attempts: number }
type Limit = { key: string; count: number; until: number }
type Order = { id: string; accountId: string; priceId: string; amount: number; currency: string; createdAt: number; sessionId: string | null; paymentIntentId: string | null; url: string | null; state: 'pending' | 'paid' | 'revoked' }
type Data = { version: 1; accounts: Account[]; sessions: Session[]; challenges: Challenge[]; limits: Limit[]; grants: MembershipGrant[]; orders: Order[]; revokedPayments: string[]; events: string[] }
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
  ads?: MembershipConfig['ads']
  request?: typeof fetch
  now?: () => number
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
const empty = (): Data => ({ version: 1, accounts: [], sessions: [], challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [] })
function decode(value: unknown): Data {
  if (value === null) return empty()
  const fail = () => { throw new Error('Invalid membership storage; refusing to overwrite accounts or purchases') }
  if (!object(value) || value.version !== 1) return fail()
  for (const field of ['accounts', 'sessions', 'challenges', 'limits', 'grants', 'orders', 'revokedPayments', 'events']) {
    if (!Array.isArray(value[field]) || value[field].length > 100_000) return fail()
  }
  const v = value as Data
  if (!v.accounts.every(a => object(a) && id(a.id) && normalizeMembershipEmail(a.email) === a.email && time(a.createdAt)) ||
      new Set(v.accounts.map(a => a.id)).size !== v.accounts.length || new Set(v.accounts.map(a => a.email)).size !== v.accounts.length) return fail()
  const accountIds = new Set(v.accounts.map(a => a.id))
  if (!v.sessions.every(s => object(s) && accountIds.has(s.accountId) && digest(s.tokenHash) && time(s.expiresAt)) ||
      new Set(v.sessions.map(s => s.tokenHash)).size !== v.sessions.length ||
      !v.challenges.every(c => object(c) && normalizeMembershipEmail(c.email) === c.email && id(c.salt) && digest(c.codeHash) && time(c.expiresAt) && time(c.attempts) && c.attempts <= 5) ||
      !v.limits.every(l => object(l) && digest(l.key) && time(l.count) && time(l.until)) ||
      !v.grants.every(g => object(g) && normalizeMembershipEmail(g.email) === g.email && typeof g.active === 'boolean' && (g.expiresAt === null || time(g.expiresAt)) && time(g.grantedAt)) ||
      new Set(v.grants.map(g => g.email)).size !== v.grants.length ||
      !v.orders.every(o => object(o) && id(o.id) && accountIds.has(o.accountId) && id(o.priceId) && time(o.amount) && /^[a-z]{3}$/.test(o.currency) && time(o.createdAt) &&
        (o.sessionId === null || id(o.sessionId)) && (o.paymentIntentId === null || id(o.paymentIntentId)) && (o.url === null || validCheckoutUrl(o.url)) && ['pending', 'paid', 'revoked'].includes(o.state)) ||
      new Set(v.orders.map(o => o.id)).size !== v.orders.length || !v.events.every(id) || !v.revokedPayments.every(id)) return fail()
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
  private priceCache: { prices: StripePrice[]; at: number } | null = null
  private priceLoading: Promise<StripePrice[]> | null = null
  private readonly now: () => number
  private readonly request: typeof fetch
  private readonly appUrl: string | null
  constructor(private readonly options: MembershipOptions) {
    if (options.authSecret.length < 32) throw new Error('MEMBERSHIP_AUTH_SECRET must contain at least 32 characters')
    this.now = options.now ?? Date.now
    this.request = options.request ?? fetch
    this.appUrl = validAppUrl(options.appUrl)
  }
  async load() { this.data = decode(await this.options.store.load()); return this }
  isHealthy() { return !this.failed && this.options.store.isHealthy?.() !== false }
  hasFailedOperation() { return this.failed }
  onChange(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify() { for (const listener of this.listeners) { try { listener() } catch { /* A UI listener cannot undo a committed payment. */ } } }
  private requireHealthy() {
    if (this.isHealthy()) return
    const firstFailure = !this.failed
    this.failed = true
    if (firstFailure) this.notify()
    throw new MembershipError('server_unavailable', 503)
  }
  async close() { await this.queue; await this.options.store.close() }
  private mutate<T>(work: (data: Data) => T | Promise<T>, notify = true): Promise<T> {
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
      try { await this.options.store.save(next) } catch { this.failed = true; this.notify(); throw new MembershipError('server_unavailable', 503) }
      this.data = next
      if (notify) this.notify()
      return value
    }).finally(() => { this.pending-- })
    this.queue = result.catch(() => undefined)
    return result
  }
  private publicAccount(account: Account, data = this.data): MembershipAccount {
    const purchased = data.orders.some(o => o.accountId === account.id && o.state === 'paid')
    const gift = data.grants.find(g => g.email === account.email && g.active && (g.expiresAt === null || g.expiresAt > this.now()))
    return { id: account.id, email: account.email, adFree: purchased || !!gift, source: purchased ? 'purchase' : gift ? 'gift' : null, expiresAt: purchased ? null : gift?.expiresAt ?? null }
  }
  authenticate(token: string): MembershipAccount | null {
    if (!this.isHealthy() || typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null
    const session = this.data.sessions.find(s => s.tokenHash === hash(token) && s.expiresAt > this.now())
    const account = session && this.data.accounts.find(a => a.id === session.accountId)
    return account ? this.publicAccount(account) : null
  }
  private requireAccount(req: Request): MembershipAccount {
    const account = this.authenticate(this.token(req))
    if (!account) throw new MembershipError('unauthorized', 401)
    return account
  }
  private token(req: Request) { const auth = req.get('authorization') ?? ''; return auth.startsWith('Bearer ') ? auth.slice(7) : '' }
  private requireAdmin(req: Request) {
    const key = this.options.dashboardKey?.trim()
    if (!key || key.length < 32 || key.length > 256) throw new MembershipError('membership_not_configured', 503)
    const supplied = this.token(req)
    if (!supplied || supplied.length > 256 || !equal(hash(key), hash(supplied))) throw new MembershipError('unauthorized', 401)
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
  private codeHash(email: string, salt: string, code: string) { return createHmac('sha256', this.options.authSecret).update(`${email}\0${salt}\0${code}`).digest('hex') }
  async requestCode(emailValue: unknown, lang: Language, remoteAddress: string): Promise<void> {
    if (!this.options.sendCode) throw new MembershipError('email_not_configured', 503)
    const email = normalizeMembershipEmail(emailValue)
    if (!email) throw new MembershipError('invalid_email')
    if (this.limited(`send-ip:${remoteAddress}`, 15) || this.limited('send-global', 100) || this.limited(`send-email:${email}`, 3)) throw new MembershipError('rate_limited', 429)
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
    const allowed = await this.mutate(data => {
      const ipOk = this.limit(data, `send-ip:${remoteAddress}`, 15, 15 * 60_000)
      const globalOk = this.limit(data, 'send-global', 100, 60 * 60_000)
      if (!ipOk || !globalOk) return false
      if (!this.limit(data, `send-email:${email}`, 3, 15 * 60_000)) return false
      const salt = randomBytes(16).toString('hex')
      data.challenges = data.challenges.filter(c => c.email !== email)
      data.challenges.push({ email, salt, codeHash: this.codeHash(email, salt, code), expiresAt: this.now() + 10 * 60_000, attempts: 0 })
      return true
    }, false)
    if (!allowed) throw new MembershipError('rate_limited', 429)
    try { await this.options.sendCode(email, code, lang) } catch { throw new MembershipError('email_unavailable', 503) }
  }
  async verifyCode(emailValue: unknown, code: unknown, remoteAddress: string): Promise<MembershipSession> {
    const email = normalizeMembershipEmail(emailValue)
    if (!email || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new MembershipError('invalid_code')
    if (this.limited(`verify-ip:${remoteAddress}`, 40)) throw new MembershipError('rate_limited', 429)
    if (!this.data.challenges.some(c => c.email === email && c.expiresAt > this.now() && c.attempts < 5)) throw new MembershipError('invalid_code')
    const result = await this.mutate(data => {
      if (!this.limit(data, `verify-ip:${remoteAddress}`, 40, 15 * 60_000)) return { error: 'rate_limited' }
      const challenge = data.challenges.find(c => c.email === email)
      if (!challenge || challenge.attempts >= 5) return { error: 'invalid_code' }
      challenge.attempts++
      if (!equal(challenge.codeHash, this.codeHash(email, challenge.salt, code))) return { error: 'invalid_code' }
      data.challenges = data.challenges.filter(c => c !== challenge)
      let account = data.accounts.find(a => a.email === email)
      if (!account) { account = { id: randomUUID(), email, createdAt: this.now() }; data.accounts.push(account) }
      const token = randomBytes(32).toString('base64url')
      const expiresAt = this.now() + 30 * DAY
      const previous = data.sessions.filter(s => s.accountId === account!.id).slice(-9)
      data.sessions = data.sessions.filter(s => s.accountId !== account!.id).concat(previous, { accountId: account.id, tokenHash: hash(token), expiresAt })
      return { session: { token, expiresAt, account: this.publicAccount(account, data) } }
    }, false)
    if (result.error || !result.session) throw new MembershipError(result.error ?? 'invalid_code', result.error === 'rate_limited' ? 429 : 400)
    this.notify()
    return result.session
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
    await this.mutate(data => { const grant = data.grants.find(g => g.email === email); if (grant) grant.active = false })
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
    const prices = (await this.prices()).map(({ amount, currency }) => ({ amount, currency }))
    return { enabled: true, loginEnabled: !!this.options.sendCode, checkoutEnabled: !!prices.length && !!this.options.sendCode && this.isHealthy(), price: prices[0] ?? null, prices, ads: this.options.ads ?? { provider: 'disabled', publisherId: null } }
  }
  async checkout(token: string, currency?: unknown): Promise<string> {
    const account = this.authenticate(token)
    if (!account) throw new MembershipError('unauthorized', 401)
    if (currency !== undefined && currency !== 'eur' && currency !== 'usd') throw new MembershipError('invalid_currency')
    const prices = await this.prices()
    const price = currency === undefined ? prices[0] : prices.find(p => p.currency === currency)
    if (!price || !this.appUrl) throw new MembershipError('checkout_not_configured', 503)
    return this.mutate(async data => {
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
    })
  }
  registerRoutes(app: Express) {
    const run = (handler: (req: Request, res: Response) => Promise<unknown> | unknown) => (req: Request, res: Response) => {
      res.set('Cache-Control', 'no-store'); res.set('X-Robots-Tag', 'noindex, nofollow')
      Promise.resolve().then(() => { this.requireHealthy(); return handler(req, res) }).catch(error => {
        if (!res.headersSent) res.status(error instanceof MembershipError ? error.status : 503).json({ error: error instanceof MembershipError ? error.code : 'server_unavailable' })
      })
    }
    app.post('/api/membership/stripe-webhook', express.raw({ type: 'application/json', limit: '256kb' }), run(async (req, res) => {
      if (!this.options.stripeWebhookSecret || !this.options.stripeSecret) throw new MembershipError('checkout_not_configured', 503)
      const event = verifyStripeEvent(req.body, req.get('stripe-signature') ?? '', this.options.stripeWebhookSecret, this.now())
      await this.handleStripeEvent(event); res.json({ received: true })
    }))
    const json = express.json({ limit: '4kb' })
    app.get('/api/membership/config', run(async (_req, res) => res.json(await this.config())))
    app.post('/api/membership/login', json, run(async (req, res) => {
      // Express's default socket address is deliberately used; forwarded IPs are
      // untrusted unless deployment explicitly configures a trusted proxy.
      await this.requestCode(req.body?.email, req.body?.lang === 'es' ? 'es' : 'en', req.ip ?? 'unknown'); res.json({ ok: true })
    }))
    app.post('/api/membership/verify', json, run(async (req, res) => res.json(await this.verifyCode(req.body?.email, req.body?.code, req.ip ?? 'unknown'))))
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
    app.get('/api/admin/memberships', run((req, res) => { this.requireAdmin(req); res.json({ grants: this.data.grants.map(g => ({ ...g })).sort((a, b) => b.grantedAt - a.grantedAt) }) }))
    app.post('/api/admin/memberships/grant', json, run(async (req, res) => { this.requireAdmin(req); await this.grant(req.body?.email, req.body?.expiresAt ?? null); res.json({ ok: true }) }))
    app.post('/api/admin/memberships/revoke', json, run(async (req, res) => { this.requireAdmin(req); await this.revokeGift(req.body?.email); res.json({ ok: true }) }))
    // JSON/parser failures must not echo private input or a stack trace.
    app.use(['/api/membership', '/api/admin/memberships'], (error: unknown, _req: Request, res: Response, next: NextFunction) => {
      if (res.headersSent) { next(error); return }
      const tooLarge = object(error) && error.type === 'entity.too.large'
      res.set('Cache-Control', 'no-store').status(tooLarge ? 413 : 400).json({ error: 'invalid_request' })
    })
  }
}

export function adConfigFromEnvironment(env: NodeJS.ProcessEnv): MembershipConfig['ads'] {
  if (env.ADS_PROVIDER !== 'google-h5') return { provider: 'disabled', publisherId: null }
  if (!/^ca-pub-\d{16}$/.test(env.ADSENSE_PUBLISHER_ID ?? '')) return { provider: 'disabled', publisherId: null }
  return { provider: 'google-h5', publisherId: env.ADSENSE_PUBLISHER_ID! }
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
    return await new MembershipService({ store, authSecret: secret, dashboardKey: env.ADMIN_DASHBOARD_KEY, sendCode, stripeSecret: env.STRIPE_SECRET_KEY, stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET, stripePriceId: env.STRIPE_PRICE_ID, stripePriceIdEur: env.STRIPE_PRICE_ID_EUR, stripePriceIdUsd: env.STRIPE_PRICE_ID_USD, appUrl: env.PUBLIC_APP_URL, ads: adConfigFromEnvironment(env) }).load()
  } catch (error) { await store.close(); throw error }
}
