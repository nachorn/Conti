import type { CookieOptions, Request, Response } from 'express'

export const PORTAL_ORIGIN = 'https://nrnplay.com'
export const PORTAL_SESSION_COOKIE = '__Host-nrnplay_session'
const COOKIE_ORIGINS = {
  portal: PORTAL_ORIGIN,
  conti: 'https://conti.nrnplay.com',
  pocha: 'https://pocha.nrnplay.com',
  football: 'https://football.nrnplay.com',
} as const
export type CookieAudience = keyof typeof COOKIE_ORIGINS
const PORTAL_HEADER = 'x-nrn-portal'
const opaqueToken = /^[A-Za-z0-9_-]{43}$/
const COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' }

const loopbackOrigin = (origin: string | undefined): boolean =>
  process.env.NODE_ENV !== 'production' && origin !== undefined &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)

export function allowedPortalOrigin(origin: string | undefined): boolean {
  return origin === PORTAL_ORIGIN || loopbackOrigin(origin)
}

export function isCookieAudience(value: unknown): value is CookieAudience {
  return typeof value === 'string' && Object.hasOwn(COOKIE_ORIGINS, value)
}

export const cookieRequested = (req: Request) => req.get(PORTAL_HEADER) !== undefined

/** Existing portal clients send 1. Game sites identify their own exact origin. */
export function cookieAudience(req: Request): CookieAudience | undefined {
  const header = req.get(PORTAL_HEADER)
  const audience = header === '1' ? 'portal' : isCookieAudience(header) && header !== 'portal' ? header : undefined
  if (!audience) return undefined
  const origin = req.get('origin'), site = req.get('sec-fetch-site')
  if (site !== undefined && site !== 'same-origin') return undefined
  if (origin !== undefined) return origin === COOKIE_ORIGINS[audience] || loopbackOrigin(origin) ? audience : undefined
  if (site !== 'same-origin') return undefined
  return audience === 'portal' || req.method === 'GET' || req.method === 'HEAD' ? audience : undefined
}

export function cookieRequestOrigin(req: Request, audience: CookieAudience): string {
  return req.get('origin') ?? COOKIE_ORIGINS[audience]
}

export function bearerCredential(req: Request): string {
  const auth = req.get('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

export function accountCredential(req: Request): { token: string; audience?: CookieAudience } {
  if (!cookieRequested(req)) return { token: bearerCredential(req) }
  const audience = cookieAudience(req)
  if (!audience) return { token: '' }
  const prefix = PORTAL_SESSION_COOKIE + '='
  const values = (req.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(prefix))
  const token = values.length === 1 ? values[0].slice(prefix.length) : ''
  return { token: opaqueToken.test(token) ? token : '', audience }
}

export function setPortalCookie(res: Response, token: string, expiresAt: number, now: number) {
  res.cookie(PORTAL_SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: Math.max(0, expiresAt - now) })
}

export function clearPortalCookie(res: Response) { res.clearCookie(PORTAL_SESSION_COOKIE, COOKIE_OPTIONS) }
