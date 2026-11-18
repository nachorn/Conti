const COOKIE_PREFIX = 'portal-cookie:'
export const PORTAL_SESSION_CHANGE = 'nrnplay-portal-session-change'
type CookieHeader = '1' | 'conti' | 'pocha'
const COOKIE_HOSTS = new Map<string, CookieHeader>([
  ['https://nrnplay.com', '1'],
  ['https://conti.nrnplay.com', 'conti'],
  ['https://pocha.nrnplay.com', 'pocha'],
])

export function accountCookieHeader(origin = typeof window === 'undefined' ? '' : window.location.origin): CookieHeader | null {
  const header = COOKIE_HOSTS.get(origin)
  if (header) return header
  if (import.meta.env?.DEV !== true || import.meta.env.VITE_NRN_COOKIE_TEST !== 'true' ||
      !/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin)) return null
  const game = import.meta.env.VITE_NRN_COOKIE_TEST_AUDIENCE
  return game === 'conti' || game === 'pocha' ? game : '1'
}

export const accountCookieEnabled = () => accountCookieHeader() !== null

/** This marker keys the current view. It cannot authenticate any request. */
export const cookieAccountKey = (sessionKey: string) => COOKIE_PREFIX + sessionKey
export const isCookieAccountKey = (token: string | null | undefined): boolean =>
  token?.startsWith(COOKIE_PREFIX) === true && /^[A-Za-z0-9_-]{22}$/.test(token.slice(COOKIE_PREFIX.length))

export function accountHeaders(token: string | null | undefined, cookie: boolean, header = accountCookieHeader()): Record<string, string> {
  return { ...(cookie ? { 'X-NRN-Portal': header ?? '1' } : {}),
    ...(token && !isCookieAccountKey(token) ? { Authorization: `Bearer ${token}` } : {}) }
}

export function notifyPortalSessionChange(storage: Pick<Storage, 'setItem'> | null) {
  try { storage?.setItem(PORTAL_SESSION_CHANGE, `${Date.now()}-${Math.random()}`) } catch { /* Focus restores the cookie in other tabs. */ }
}
