import { useCallback, useEffect, useRef, useState } from 'react'
import type { LeagueDetail, LeagueGameType, LeagueSummary } from '@shared/leagues'
import { isLeagueDetail, isLeagueList } from './lib/leagues'
import { requestLeague, LeagueRequestError, type LeagueError } from './lib/leagueApi'

export type { LeagueError } from './lib/leagueApi'

const leaguePath = (id: string, seasonId?: string) => '/' + encodeURIComponent(id) + (seasonId ? '?seasonId=' + encodeURIComponent(seasonId) : '')

export function useLeagues(token: string | null, enabled = true, gameType?: LeagueGameType) {
  const [list, setList] = useState<{ token: string; gameType?: LeagueGameType; leagues: LeagueSummary[] } | null>(null)
  const [selected, setSelected] = useState<{ token: string; gameType?: LeagueGameType; league: LeagueDetail; seasonId?: string } | null>(null)
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

  const request = useCallback(async (path: string, currentToken: string, body?: unknown): Promise<unknown> => {
    const controller = new AbortController()
    controllers.current.add(controller)
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    try {
      return await requestLeague(path, currentToken, controller.signal, body)
    } finally { window.clearTimeout(timeout); controllers.current.delete(controller) }
  }, [])
  const refresh = useCallback(async () => {
    const sequence = ++listSequence.current
    if (!token || !enabled) { setLoading(false); return }
    setLoading(true); setError(null)
    try {
      const selection = selectedRef.current?.token === token && selectedRef.current.gameType === gameType ? selectedRef.current : null
      const [value, detail] = await Promise.all([request('', token), selection ? request(leaguePath(selection.league.id, selection.seasonId), token) : Promise.resolve(null)])
      if (sequence !== listSequence.current || activeToken.current !== token || activeGameType.current !== gameType || !activeEnabled.current) return
      if (!isLeagueList(value) || (selection && !isLeagueDetail(detail))) throw new LeagueRequestError('unavailable')
      if (selection && isLeagueDetail(detail) && gameType !== undefined && detail.gameType !== gameType) throw new LeagueRequestError('league_wrong_game')
      setList({ token, gameType, leagues: value.leagues.filter(league => gameType === undefined || league.gameType === gameType) })
      if (selection && isLeagueDetail(detail)) setSelected({ ...selection, league: detail })
    } catch (failure) {
      if (sequence !== listSequence.current || activeToken.current !== token || activeGameType.current !== gameType || !activeEnabled.current) return
      const code = failure instanceof LeagueRequestError ? failure.code : 'unavailable'
      setError(code)
      if (code === 'unauthorized') { setList(null); setSelected(null) }
      if (code === 'league_not_found' || code === 'league_wrong_game') setSelected(null)
    } finally { if (sequence === listSequence.current) setLoading(false) }
  }, [token, enabled, gameType, request])

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

  const action = useCallback(async (path: string, body?: unknown, seasonId?: string): Promise<boolean> => {
    const currentToken = token
    if (!currentToken || !enabled || actionPending.current) return false
    actionPending.current = true
    const sequence = ++actionSequence.current
    ++listSequence.current
    setLoading(false); setBusy(true); setError(null)
    try {
      const value = await request(path, currentToken, body)
      if (sequence !== actionSequence.current || activeToken.current !== currentToken || activeGameType.current !== gameType || !activeEnabled.current) return false
      if (!isLeagueDetail(value)) throw new LeagueRequestError('unavailable')
      if (gameType !== undefined && value.gameType !== gameType) throw new LeagueRequestError('league_wrong_game')
      setSelected({ token: currentToken, gameType, league: value, seasonId })
      if (body !== undefined) window.dispatchEvent(new Event('conti-leagues-updated'))
      return true
    } catch (failure) {
      if (sequence !== actionSequence.current || activeToken.current !== currentToken || activeGameType.current !== gameType || !activeEnabled.current) return false
      const code = failure instanceof LeagueRequestError ? failure.code : 'unavailable'
      setError(code)
      if (code === 'unauthorized') { setList(null); setSelected(null) }
      return false
    } finally {
      if (sequence === actionSequence.current) { actionPending.current = false; setBusy(false) }
    }
  }, [token, enabled, gameType, request])
  const openLeague = useCallback((id: string, seasonId?: string) => action(leaguePath(id, seasonId), undefined, seasonId), [action])
  return {
    leagues: list?.token === token && list.gameType === gameType ? list.leagues : null,
    detail: selected?.token === token && selected.gameType === gameType ? selected.league : null,
    loading, busy, error, refresh, openLeague,
    refreshDetail: () => {
      const selection = selectedRef.current
      if (selection) return openLeague(selection.league.id, selection.seasonId)
    },
    createLeague: (name: string, requestedGame: LeagueGameType, minGames: number) => action('', { name, gameType: gameType ?? requestedGame, minGames }),
    joinLeague: (code: string) => action('/join', { code, ...(gameType === undefined ? {} : { expectedGameType: gameType }) }),
    closeLeague: (id: string) => action('/' + encodeURIComponent(id) + '/close', {}),
    rotateInvite: (id: string) => action(leaguePath(id) + '/invite/rotate', {}),
    startSeason: (id: string, name: string) => action(leaguePath(id) + '/seasons', { name }),
    back: () => {
      ++actionSequence.current; ++listSequence.current; actionPending.current = false
      selectedRef.current = null
      setBusy(false); setSelected(null)
      void refresh()
    },
    clearError: () => setError(null),
  }
}
