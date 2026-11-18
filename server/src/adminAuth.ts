import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import express, { type CookieOptions, type Express, type NextFunction, type Request, type Response } from 'express'
import { RateLimiter, requestLimit } from './security.js'
import { ADMIN_PROOF_SESSION_MS, AdminStepUpError, type AdminStepUp, type AdminProofDenial } from './adminStepUp.js'

export const ADMIN_SESSION_COOKIE = 'conti_admin_session'
export const ADMIN_PROOF_COOKIE = '__Secure-nrn_admin_session'
export const ADMIN_REMEMBER_MS = 30 * 24 * 60 * 60_000
export const ADMIN_SESSION_MS = 12 * 60 * 60_000
const COOKIE_PATH = '/api/admin'
const hash = (value: string) => createHash('sha256').update(value).digest()
export type AdminAccountVerifier = Pick<AdminStepUp, 'verify' | 'challenge' | 'confirm' | 'revoke'>
type AdminMethod = 'bearer' | 'cookie' | 'account'
type AdminAccess = { method: AdminMethod; error?: never; status?: never } | ({ method: null } & AdminProofDenial)
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)
const bearer = (req: Request) => {
  const authorization = req.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
}
const cookie = (req: Request, name: string) => {
  const values = (req.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`))
  return values.length === 1 ? values[0].slice(name.length + 1) : ''
}
const normalizeOrigin = (value: string | undefined): string | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null
  } catch { return null }
}

/** Account administration requires both the current account session and a recent email proof. */
export class AdminAuth {
  private readonly passwordHash: Buffer | null
  private readonly signingKey: Buffer | null
  private readonly allowedOrigins: Set<string>
  constructor(key?: string, origins: string[] = [], private readonly now: () => number = Date.now, private readonly accountVerifier?: AdminAccountVerifier) {
    const password = key?.trim()
    this.passwordHash = password && password.length >= 32 && password.length <= 256 ? hash(password) : null
    this.signingKey = this.passwordHash ? createHmac('sha256', password!).update('conti:admin-session:signing-key:v1').digest() : null
    this.allowedOrigins = new Set(origins.map(normalizeOrigin).filter((origin): origin is string => origin !== null))
  }
  get accountOnly() { return this.accountVerifier !== undefined }
  get configured() { return this.accountOnly || this.passwordHash !== null }
  validPassword(value: unknown): boolean {
    return !this.accountOnly && this.passwordHash !== null && typeof value === 'string' && value.length > 0 && value.length <= 256 && same(hash(value), this.passwordHash)
  }
  private validSession(token: string): boolean {
    if (!this.signingKey || token.length > 256) return false
    const parts = token.split('.')
    if (parts.length !== 5 || parts[0] !== 'v1' || !/^\d{1,16}$/.test(parts[1]) || !/^\d{1,16}$/.test(parts[2]) || !/^[a-zA-Z0-9_-]{22}$/.test(parts[3]) || !/^[a-zA-Z0-9_-]{43}$/.test(parts[4])) return false
    const issued = Number(parts[1]), expires = Number(parts[2]), now = this.now()
    if (!Number.isSafeInteger(issued) || !Number.isSafeInteger(expires) || issued > now || expires <= now || expires <= issued || expires - issued > ADMIN_REMEMBER_MS) return false
    const expected = createHmac('sha256', this.signingKey).update(parts.slice(0, 4).join('.')).digest()
    return same(Buffer.from(parts[4], 'base64url'), expected)
  }
  access(req: Request): AdminAccess {
    const authorization = req.get('authorization') ?? ''
    if (this.accountVerifier) {
      const denied = this.accountVerifier.verify(bearer(req), cookie(req, ADMIN_PROOF_COOKIE))
      return denied ? { method: null, ...denied } : { method: 'account' }
    }
    // An explicitly supplied but invalid credential must not silently fall back to a cookie.
    if (authorization) return authorization.startsWith('Bearer ') && this.validPassword(authorization.slice(7)) ? { method: 'bearer' } : { method: null, error: 'unauthorized', status: 401 }
    return this.validSession(cookie(req, ADMIN_SESSION_COOKIE))
      ? { method: 'cookie' } : { method: null, error: 'unauthorized', status: 401 }
  }
  authenticate(req: Request): AdminMethod | null {
    return this.access(req).method
  }
  allowWrite(req: Request): boolean {
    // This header cannot be sent by HTML forms, and credentialed cross-origin CORS is disabled.
    if (req.get('x-admin-request') !== '1') return false
    const originHeader = req.get('origin')
    if (this.accountOnly) {
      const site = req.get('sec-fetch-site')
      if (site && site !== 'same-origin' && site !== 'none') return false
      if (!originHeader) return true
      const origin = normalizeOrigin(originHeader)
      return origin === 'https://nrnplay.com' || process.env.NODE_ENV !== 'production' && origin !== null &&
        /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)
    }
    if (!originHeader) return true
    const origin = normalizeOrigin(originHeader)
    if (!origin) return false
    const directOrigin = normalizeOrigin(`${this.secure(req) ? 'https' : 'http'}://${req.get('host') ?? ''}`)
    return origin === directOrigin || this.allowedOrigins.has(origin)
  }
  private secure(req: Request): boolean {
    return process.env.NODE_ENV === 'production' || req.secure || req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https'
  }
  private cookieOptions(req: Request): CookieOptions {
    return { httpOnly: true, secure: this.secure(req), sameSite: 'strict', path: COOKIE_PATH }
  }
  private proofCookieOptions(): CookieOptions {
    return { httpOnly: true, secure: true, sameSite: 'strict', path: COOKIE_PATH }
  }
  challenge(req: Request, lang: 'en' | 'es') {
    if (!this.accountVerifier) throw new AdminStepUpError('dashboard_not_configured', 503)
    return this.accountVerifier.challenge(bearer(req), lang)
  }
  confirm(req: Request, res: Response, code: unknown) {
    if (!this.accountVerifier) throw new AdminStepUpError('dashboard_not_configured', 503)
    const token = this.accountVerifier.confirm(bearer(req), code)
    res.cookie(ADMIN_PROOF_COOKIE, token, { ...this.proofCookieOptions(), maxAge: ADMIN_PROOF_SESSION_MS })
  }
  issue(req: Request, res: Response, remember: boolean) {
    if (this.accountOnly || !this.signingKey) throw new Error('Legacy admin authentication is not configured')
    const lifetime = remember ? ADMIN_REMEMBER_MS : ADMIN_SESSION_MS
    const issued = this.now()
    const payload = `v1.${issued}.${issued + lifetime}.${randomBytes(16).toString('base64url')}`
    const signature = createHmac('sha256', this.signingKey).update(payload).digest('base64url')
    res.cookie(ADMIN_SESSION_COOKIE, `${payload}.${signature}`, {
      ...this.cookieOptions(req), ...(remember ? { maxAge: lifetime, expires: new Date(issued + lifetime) } : {}),
    })
  }
  clear(req: Request, res: Response) {
    if (this.accountVerifier) {
      this.accountVerifier.revoke(cookie(req, ADMIN_PROOF_COOKIE))
      res.clearCookie(ADMIN_PROOF_COOKIE, this.proofCookieOptions())
    } else res.clearCookie(ADMIN_SESSION_COOKIE, this.cookieOptions(req))
  }
}

export function registerAdminSessions(app: Express, auth: AdminAuth, isHealthy: () => boolean) {
  const privateResponse = (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow'); next()
  }
  const writeRequest = (req: Request, res: Response, next: NextFunction) => {
    if (!auth.allowWrite(req)) { res.status(403).json({ error: 'invalid_request' }); return }
    next()
  }
  const proofError = (error: unknown, res: Response) => {
    if (!(error instanceof AdminStepUpError)) { res.status(503).json({ error: 'server_unavailable' }); return }
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter))
    res.status(error.status).json({ error: error.code })
  }
  app.post('/api/admin/session/challenge', privateResponse, writeRequest, requestLimit(new RateLimiter(10, 60_000)), express.json({ limit: '1kb', inflate: false }), async (req, res) => {
    if (!isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    if (!req.is('application/json') || (req.body?.lang !== 'es' && req.body?.lang !== 'en')) { res.status(400).json({ error: 'invalid_request' }); return }
    try { await auth.challenge(req, req.body.lang); res.json({ ok: true }) } catch (error) { proofError(error, res) }
  })
  app.post('/api/admin/session', privateResponse, writeRequest, requestLimit(new RateLimiter(10, 60_000)), express.json({ limit: '1kb', inflate: false }), (req, res) => {
    if (!auth.configured) { res.status(503).json({ error: 'dashboard_not_configured' }); return }
    if (auth.accountOnly) {
      if (!isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
      if (!req.is('application/json')) { res.status(400).json({ error: 'invalid_request' }); return }
      try { auth.confirm(req, res, req.body?.code); res.json({ ok: true }) } catch (error) { proofError(error, res) }
      return
    }
    if (!req.is('application/json') || typeof req.body?.password !== 'string' || typeof req.body?.remember !== 'boolean') { res.status(400).json({ error: 'invalid_request' }); return }
    if (!auth.validPassword(req.body.password)) { res.status(401).json({ error: 'unauthorized' }); return }
    if (!isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    auth.issue(req, res, req.body.remember)
    res.json({ ok: true })
  })
  app.delete('/api/admin/session', privateResponse, writeRequest, (req, res) => {
    auth.clear(req, res)
    res.json({ ok: true })
  })
  app.use('/api/admin/session', (error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) { next(error); return }
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large'
    const unsupported = typeof error === 'object' && error !== null && 'type' in error && error.type === 'encoding.unsupported'
    res.set('Cache-Control', 'no-store').status(tooLarge ? 413 : unsupported ? 415 : 400).json({ error: 'invalid_request' })
  })
}
