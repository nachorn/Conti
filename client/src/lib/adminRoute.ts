/** Central administration drops legacy query/hash values instead of forwarding credentials. */
export function adminDestination(hostname: string): '/admin' | 'https://nrnplay.com/admin' {
  return ['nrnplay.com', 'localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname.toLowerCase()) ? '/admin' : 'https://nrnplay.com/admin'
}

export function adminAccess(value: { loaded: boolean; authReady: boolean; token: string | null; account: { isAdmin?: boolean } | null }): 'pending' | 'denied' | 'allowed' {
  if (!value.loaded || !value.authReady) return 'pending'
  return value.account?.isAdmin === true && !!value.token && /^[A-Za-z0-9_-]{43}$/.test(value.token) ? 'allowed' : 'denied'
}
