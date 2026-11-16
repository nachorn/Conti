import { useCallback, useEffect, useRef, useState } from 'react'
import type { LeagueDetail, LeagueGameType, LeagueSummary } from '@shared/leagues'
import { isLeagueDetail, isLeagueList } from './lib/leagues'

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')
export type LeagueError = 'unauthorized' | 'unavailable' | 'league_not_found' | 'league_wrong_game' | 'league_closed' | 'league_full' | 'invalid_league_name' | 'invalid_game_type' | 'invalid_min_games' | 'invalid_invite_code' | 'league_owner_required' | 'rate_limited' | 'league_limit'
const errorCodes = new Set<LeagueError>(['unauthorized', 'league_not_found', 'league_wrong_game', 'league_closed', 'league_full', 'invalid_league_name', 'invalid_game_type', 'invalid_min_games', 'invalid_invite_code', 'league_owner_required', 'rate_limited', 'league_limit'])
class RequestError extends Error { constructor(readonly code: LeagueError) { super('League request failed') } }

export function useLeagues(token: string | null, enabled = true, gameType?: LeagueGameType) {
  const [list, setList] = useState<{ token: string; gameType?: LeagueGameType; leagues: LeagueSummary[] } | null>(null)
  const [selected, setSelected] = useState<{ token: string; gameType?: LeagueGameType; league: LeagueDetail } | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LeagueError | null>(null)
  const activeToken = useRef(token)
  const activeEnabled = useRef(enabled)
  const activeGameType = useRef(gameType)
  activeToken.current = token
  activeEnabled.current = enabled
  activeGameType.current = gameType
  const listSequence = useRef(0)
  const actionSequence = useRef(0)
  const actionPending = useRef(false)
  const controllers = useRef(new Set<AbortController>())

  async function request(path: string, currentToken: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController()
    controllers.current.add(controller)
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(`${API_URL}/api/leagues${path}`, { method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${currentToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: 'no-store', signal: controller.signal })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: LeagueError } | null
        throw new RequestError(response.status === 401 ? 'unauthorized' : payload?.error && errorCodes.has(payload.error) ? payload.error : 'unavailable')
      }
      return await response.json()
    } finally { window.clearTimeout(timeout); controllers.current.delete(controller) }
  }
  const refresh = useCallback(async () => {
    const sequence = ++listSequence.current
    if (!token || !enabled) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const selectedId = selectedRef.current?.token === token && selectedRef.current.gameType === gameType ? selectedRef.current.league.id : null
      const [value, detail] = await Promise.all([request('', token), selectedId ? request('/' + encodeURIComponent(selectedId), token) : Promise.resolve(null)])
      if (sequence !== listSequence.current || activeToken.current !== token || activeGameType.current !== gameType || !activeEnabled.current) return
      if (!isLeagueList(value) || (selectedId && !isLeagueDetail(detail))) throw new RequestError('unavailable')
      if (selectedId && isLeagueDetail(detail) && gameType !== undefined && detail.gameType !== gameType) throw new RequestError('league_wrong_game')
      setList({ token, gameType, leagues: value.leagues.filter(league => gameType === undefined || league.gameType === gameType) })
      if (selectedId && isLeagueDetail(detail)) setSelected({ token, gameType, league: detail })
    } catch (failure) {
      if (sequence !== listSequence.current || activeToken.current !== token || activeGameType.current !== gameType || !activeEnabled.current) return
      const code = failure instanceof RequestError ? failure.code : 'unavailable'
      setError(code)
      if (code === 'unauthorized') { setList(null); setSelected(null) }
      if (code === 'league_not_found' || code === 'league_wrong_game') setSelected(null)
    } finally { if (sequence === listSequence.current) setLoading(false) }
  }, [token, enabled, gameType])

  useEffect(() => {
    setError(null); setBusy(false)
    void refresh()
    const update = () => { if (!actionPending.current) void refresh() }
    if (token && enabled) { window.addEventListener('focus', update); window.addEventListener('conti-leagues-updated', update) }
    return () => {
      ++listSequence.current; ++actionSequence.current; actionPending.current = false
      window.removeEventListener('focus', update); window.removeEventListener('conti-leagues-updated', update)
      for (const controller of controllers.current) controller.abort()
      controllers.current.clear()
    }
  }, [refresh])

  async function action(path: string, body?: unknown): Promise<boolean> {
    const currentToken = token
    if (!currentToken || !enabled || actionPending.current) return false
    actionPending.current = true
    const sequence = ++actionSequence.current
    ++listSequence.current
    setLoading(false); setBusy(true); setError(null)
    try {
      const value = await request(path, currentToken, body)
      if (sequence !== actionSequence.current || activeToken.current !== currentToken || activeGameType.current !== gameType || !activeEnabled.current) return false
      if (!isLeagueDetail(value)) throw new RequestError('unavailable')
      if (gameType !== undefined && value.gameType !== gameType) throw new RequestError('league_wrong_game')
      setSelected({ token: currentToken, gameType, league: value })
      setList(previous => ({ token: currentToken, gameType, leagues: [value, ...(previous?.token === currentToken && previous.gameType === gameType ? previous.leagues.filter(league => league.id !== value.id) : [])] }))
      if (body !== undefined) window.dispatchEvent(new Event('conti-leagues-updated'))
      return true
    } catch (failure) {
      if (sequence !== actionSequence.current || activeToken.current !== currentToken || activeGameType.current !== gameType || !activeEnabled.current) return false
      const code = failure instanceof RequestError ? failure.code : 'unavailable'
      setError(code)
      if (code === 'unauthorized') { setList(null); setSelected(null) }
      return false
    } finally {
      if (sequence === actionSequence.current) { actionPending.current = false; setBusy(false) }
    }
  }
  return {
    leagues: list?.token === token && list.gameType === gameType ? list.leagues : null,
    detail: selected?.token === token && selected.gameType === gameType ? selected.league : null,
    loading, busy, error, refresh,
    openLeague: (id: string) => action('/' + encodeURIComponent(id)),
    createLeague: (name: string, requestedGame: LeagueGameType, minGames: number) => action('', { name, gameType: gameType ?? requestedGame, minGames }),
    joinLeague: (code: string) => action('/join', { code, ...(gameType === undefined ? {} : { expectedGameType: gameType }) }),
    closeLeague: (id: string) => action('/' + encodeURIComponent(id) + '/close', {}),
    back: () => { ++actionSequence.current; ++listSequence.current; actionPending.current = false; setBusy(false); setLoading(false); setSelected(null); setError(null) },
    clearError: () => setError(null),
  }
}
