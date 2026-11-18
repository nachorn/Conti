import { accountHeaders, isCookieAccountKey } from './accountTransport'

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : 'https://api.nrnplay.com')

export type LeagueError = 'unauthorized' | 'unavailable' | 'league_not_found' | 'league_wrong_game' | 'league_closed' | 'league_full' | 'invalid_league_name' | 'invalid_game_type' | 'invalid_min_games' | 'invalid_invite_code' | 'league_owner_required' | 'rate_limited' | 'league_limit' | 'invalid_season_name' | 'league_season_not_found' | 'league_season_limit'
const errorCodes = new Set<LeagueError>([
  'unauthorized', 'league_not_found', 'league_wrong_game', 'league_closed', 'league_full', 'invalid_league_name',
  'invalid_game_type', 'invalid_min_games', 'invalid_invite_code', 'league_owner_required', 'rate_limited', 'league_limit',
  'invalid_season_name', 'league_season_not_found', 'league_season_limit',
])

export class LeagueRequestError extends Error {
  constructor(readonly code: LeagueError) { super('League request failed') }
}

export async function requestLeague(path: string, token: string, signal: AbortSignal, body?: unknown): Promise<unknown> {
  const portal = isCookieAccountKey(token)
  const response = await fetch(`${portal ? '' : API_URL}/api/leagues${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...accountHeaders(token, portal), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    credentials: portal ? 'same-origin' : 'omit',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal,
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: LeagueError } | null
    throw new LeagueRequestError(response.status === 401 ? 'unauthorized' : payload?.error && errorCodes.has(payload.error) ? payload.error : 'unavailable')
  }
  return await response.json()
}
