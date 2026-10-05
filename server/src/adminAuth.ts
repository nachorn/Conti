import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import express, { type CookieOptions, type Express, type NextFunction, type Request, type Response } from 'express'

export const ADMIN_SESSION_COOKIE = 'conti_admin_session'
export const ADMIN_REMEMBER_MS = 30 * 24 * 60 * 60_000
export const ADMIN_SESSION_MS = 12 * 60 * 60_000
const COOKIE_PATH = '/api/admin'
const hash = (value: string) => createHash('sha256').update(value).digest()
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)
const normalizeOrigin = (value: string | undefined): string | null => {
  if (!value) return null
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null
  } catch { return null }
}

/** A fixed-lifetime, deployment-stable session. Rotating the admin key revokes every session. */
export class AdminAuth {
  private readonly passwordHash: Buffer | null
  private readonly signingKey: Buffer | null
  private readonly allowedOrigins: Set<string>
  constructor(key?: string, origins: string[] = [], private readonly now: () => number = Date.now) {
    const password = key?.trim()
    this.passwordHash = password && password.length >= 32 && password.length <= 256 ? hash(password) : null
    this.signingKey = this.passwordHash ? createHmac('sha256', password!).update('conti:admin-session:signing-key:v1').digest() : null
    this.allowedOrigins = new Set(origins.map(normalizeOrigin).filter((origin): origin is string => origin !== null))
  }
  get configured() { return this.passwordHash !== null }
  validPassword(value: unknown): boolean {
    return this.passwordHash !== null && typeof value === 'string' && value.length > 0 && value.length <= 256 && same(hash(value), this.passwordHash)
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
  authenticate(req: Request): 'bearer' | 'cookie' | null {
    const authorization = req.get('authorization') ?? ''
    // An explicitly supplied but invalid credential must not silently fall back to a cookie.
    if (authorization) return authorization.startsWith('Bearer ') && this.validPassword(authorization.slice(7)) ? 'bearer' : null
    const cookies = (req.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${ADMIN_SESSION_COOKIE}=`))
    if (cookies.length !== 1) return null
    return this.validSession(cookies[0].slice(ADMIN_SESSION_COOKIE.length + 1)) ? 'cookie' : null
  }
  allowWrite(req: Request): boolean {
    // This header cannot be sent by HTML forms, and credentialed cross-origin CORS is disabled.
    if (req.get('x-admin-request') !== '1') return false
    const originHeader = req.get('origin')
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
  issue(req: Request, res: Response, remember: boolean) {
    if (!this.signingKey) throw new Error('Admin authentication is not configured')
    const lifetime = remember ? ADMIN_REMEMBER_MS : ADMIN_SESSION_MS
    const issued = this.now()
    const payload = `v1.${issued}.${issued + lifetime}.${randomBytes(16).toString('base64url')}`
    const signature = createHmac('sha256', this.signingKey).update(payload).digest('base64url')
    res.cookie(ADMIN_SESSION_COOKIE, `${payload}.${signature}`, {
      ...this.cookieOptions(req), ...(remember ? { maxAge: lifetime, expires: new Date(issued + lifetime) } : {}),
    })
  }
  clear(req: Request, res: Response) { res.clearCookie(ADMIN_SESSION_COOKIE, this.cookieOptions(req)) }
}

export function registerAdminSessions(app: Express, auth: AdminAuth, isHealthy: () => boolean) {
  const privateResponse = (_req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow'); next()
  }
  const writeRequest = (req: Request, res: Response, next: NextFunction) => {
    if (!auth.allowWrite(req)) { res.status(403).json({ error: 'invalid_request' }); return }
    next()
  }
  app.post('/api/admin/session', privateResponse, writeRequest, express.json({ limit: '1kb' }), (req, res) => {
    if (!auth.configured) { res.status(503).json({ error: 'dashboard_not_configured' }); return }
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
    res.set('Cache-Control', 'no-store').status(tooLarge ? 413 : 400).json({ error: 'invalid_request' })
  })
}
