import type { CookieOptions, Request, Response } from 'express'

export const PORTAL_ORIGIN = 'https://nrnplay.com'
export const PORTAL_SESSION_COOKIE = '__Host-nrnplay_session'
const PORTAL_HEADER = 'x-nrn-portal'
const opaqueToken = /^[A-Za-z0-9_-]{43}$/
const COOKIE_OPTIONS: CookieOptions = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' }

export function allowedPortalOrigin(origin: string | undefined): boolean {
  return origin === PORTAL_ORIGIN || process.env.NODE_ENV !== 'production' && origin !== undefined &&
    /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin)
}

export const portalRequested = (req: Request) => req.get(PORTAL_HEADER) !== undefined

/** Browser requests need an opt-in header plus same-origin metadata or the exact portal origin. */
export function portalRequest(req: Request): boolean {
  if (req.get(PORTAL_HEADER) !== '1') return false
  const origin = req.get('origin'), site = req.get('sec-fetch-site')
  if (site !== undefined && site !== 'same-origin') return false
  if (origin !== undefined) return allowedPortalOrigin(origin)
  return site === 'same-origin'
}

export function bearerCredential(req: Request): string {
  const auth = req.get('authorization') ?? ''
  return auth.startsWith('Bearer ') ? auth.slice(7) : ''
}

export function accountCredential(req: Request): { token: string; portal: boolean } {
  if (!portalRequested(req)) return { token: bearerCredential(req), portal: false }
  if (!portalRequest(req)) return { token: '', portal: true }
  const prefix = PORTAL_SESSION_COOKIE + '='
  const values = (req.get('cookie') ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(prefix))
  const token = values.length === 1 ? values[0].slice(prefix.length) : ''
  return { token: opaqueToken.test(token) ? token : '', portal: true }
}

export function setPortalCookie(res: Response, token: string, expiresAt: number, now: number) {
  res.cookie(PORTAL_SESSION_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: Math.max(0, expiresAt - now) })
}

export function clearPortalCookie(res: Response) { res.clearCookie(PORTAL_SESSION_COOKIE, COOKIE_OPTIONS) }
