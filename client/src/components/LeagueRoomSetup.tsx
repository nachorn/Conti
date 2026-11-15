import { useState } from 'react'
import type { RoomLeagueSummary } from '@shared/leagues'
import type { Lang } from '../i18n'
import type { ActionResult } from '../types'
import { useLeagues } from '../useLeagues'
import { leagueErrorText } from './Leagues'
import './Leagues.css'

export interface LeagueRoomSetupProps {
  token: string | null
  roomLeague: RoomLeagueSummary | null
  gameType: 'pocha' | 'continental'
  isHost: boolean
  connected: boolean
  lang: Lang
  onSetLeague: (leagueId: string | null) => Promise<ActionResult>
  onOpenAccount: () => void
  nextGame?: boolean
}

/** The league is selected for the table; only server-confirmed state is displayed. */
export function LeagueRoomSetup({ token, roomLeague, gameType, isHost, connected, lang, onSetLeague, onOpenAccount, nextGame = false }: LeagueRoomSetupProps) {
  const es = lang === 'es'
  const leagues = useLeagues(token, isHost && connected)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const available = connected && !pending
  const choices = leagues.leagues?.filter(league => league.gameType === gameType && league.closedAt === null) ?? []
  const setLeague = async (leagueId: string | null) => {
    if (!available) return
    setPending(true); setError(null)
    try {
      const result = await onSetLeague(leagueId)
      if (!result.ok) setError(result.error || (es ? 'No se ha podido cambiar la liga.' : 'The league could not be changed.'))
    } catch { setError(es ? 'No se ha podido cambiar la liga. Comprueba tu conexión.' : 'The league could not be changed. Check your connection.') }
    finally { setPending(false) }
  }
  return <section className="league-room-setup" aria-labelledby="league-room-title">
    <h3 id="league-room-title">{nextGame ? (es ? 'Próxima partida' : 'Next game') : (es ? 'Partida y clasificación' : 'Game and standings')}</h3>
    {isHost && token ? <>
      <label htmlFor="room-league">{es ? '¿Cuenta para una liga?' : 'Count towards a league?'}</label>
      <select id="room-league" value={roomLeague?.id ?? ''} disabled={!available || leagues.loading} onChange={event => void setLeague(event.target.value || null)} aria-describedby="room-league-help">
        <option value="">{es ? 'Partida amistosa' : 'Friendly game'}</option>
        {roomLeague && !choices.some(league => league.id === roomLeague.id) && <option value={roomLeague.id}>{roomLeague.name}{roomLeague.closedAt !== null ? (es ? ' · cerrada' : ' · closed') : ''}</option>}
        {choices.map(league => <option value={league.id} key={league.id}>{league.name}</option>)}
      </select>
      <div className="league-room-actions"><button type="button" className="membership-text" disabled={!available} onClick={onOpenAccount}>{es ? 'Gestionar ligas en Mi cuenta' : 'Manage leagues in My account'}</button><button type="button" className="membership-text" disabled={!available || leagues.loading} onClick={() => void leagues.refresh()}>{leagues.loading ? (es ? 'Cargando…' : 'Loading…') : (es ? 'Actualizar ligas' : 'Refresh leagues')}</button></div>
    </> : <p><strong>{roomLeague?.name ?? (es ? 'Partida amistosa' : 'Friendly game')}</strong></p>}
    <p id="room-league-help">{roomLeague ? roomLeague.closedAt !== null
      ? (es ? 'Esta liga está cerrada. El anfitrión debe elegir otra liga o una partida amistosa para empezar.' : 'This league is closed. The host must choose another league or a friendly game to start.')
      : (es ? 'Todos deben iniciar sesión y unirse a esta liga antes de empezar. El resultado completo actualizará la clasificación TrueSkill.' : 'Everyone must sign in and join this league before starting. The completed result will update the TrueSkill standings.')
      : (es ? 'Juega con invitados o con cuentas. El anfitrión puede elegir una liga antes de empezar.' : 'Play with guests or accounts. The host can choose a league before starting.')}</p>
    {!token && <button type="button" className="membership-text" disabled={!connected} onClick={onOpenAccount}>{es ? 'Entrar o crear una cuenta' : 'Sign in or create an account'}</button>}
    {isHost && !token && roomLeague && <button type="button" className="membership-text" disabled={!available} onClick={() => void setLeague(null)}>{es ? 'Jugar una amistosa' : 'Play a friendly game'}</button>}
    {(error || leagues.error) && <p className="membership-error" role="alert">{error || (leagues.error ? leagueErrorText(leagues.error, lang) : '')}</p>}
  </section>
}
