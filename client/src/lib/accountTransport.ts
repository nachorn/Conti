const COOKIE_PREFIX = 'portal-cookie:'
export const PORTAL_SESSION_CHANGE = 'nrnplay-portal-session-change'

export function portalCookieEnabled(origin = typeof window === 'undefined' ? '' : window.location.origin) {
  return origin === 'https://nrnplay.com' || (import.meta.env?.DEV === true &&
    import.meta.env.VITE_NRN_COOKIE_TEST === 'true' && /^https?:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin))
}

/** This marker keys the current view. It cannot authenticate any request. */
export const cookieAccountKey = (sessionKey: string) => COOKIE_PREFIX + sessionKey
export const isCookieAccountKey = (token: string | null | undefined): boolean =>
  token?.startsWith(COOKIE_PREFIX) === true && /^[A-Za-z0-9_-]{22}$/.test(token.slice(COOKIE_PREFIX.length))

export function accountHeaders(token: string | null | undefined, portal: boolean): Record<string, string> {
  return { ...(portal ? { 'X-NRN-Portal': '1' } : {}),
    ...(token && !isCookieAccountKey(token) ? { Authorization: `Bearer ${token}` } : {}) }
}

export function notifyPortalSessionChange(storage: Pick<Storage, 'setItem'> | null) {
  try { storage?.setItem(PORTAL_SESSION_CHANGE, `${Date.now()}-${Math.random()}`) } catch { /* Focus restores the cookie in other tabs. */ }
}
