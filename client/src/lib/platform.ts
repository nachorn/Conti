export type CardGame = 'continental' | 'pocha'
export type PlatformGame = 'football' | 'conti' | 'pocha'

export const PLATFORM_ORIGIN = 'https://nrnplay.com'

export function platformAccountHref(hostname = typeof window === 'undefined' ? '' : window.location.hostname): string {
  return hostname === 'www.nrnplay.com' || hostname.endsWith('.nrnplay.com') ? `${PLATFORM_ORIGIN}/account` : '/account'
}
export const GAME_ORIGINS: Record<PlatformGame, string> = {
  football: 'https://football.nrnplay.com',
  conti: 'https://conti.nrnplay.com',
  pocha: 'https://pocha.nrnplay.com',
}

/** Enable the new links only once all three DNS entries and HTTPS are ready. */
export const gameSubdomainsEnabled = import.meta.env.VITE_GAME_SUBDOMAINS_ENABLED === 'true'

export function hostedCardGame(hostname: string): CardGame | null {
  if (hostname.toLowerCase() === 'conti.nrnplay.com') return 'continental'
  if (hostname.toLowerCase() === 'pocha.nrnplay.com') return 'pocha'
  return null
}

export function platformHomeHref(hostname = typeof window === 'undefined' ? '' : window.location.hostname): string {
  return hostedCardGame(hostname) ? `${PLATFORM_ORIGIN}/` : '/'
}

export function gameHref(game: PlatformGame, enabled = gameSubdomainsEnabled): string {
  if (enabled) return `${GAME_ORIGINS[game]}/`
  return game === 'football' ? 'https://footballchampion.net/' : `/${game}`
}

/** The game creates its own PKCE proof before requesting the central sign-in. */
export function gameLaunchHref(href: string, signedIn: boolean): string {
  if (!signedIn || !href.startsWith('https://')) return href
  const url = new URL(href)
  if (![...Object.values(GAME_ORIGINS), 'https://footballchampion.net'].includes(url.origin)) return href
  url.searchParams.set('nrn-signin', '1')
  return url.href
}
