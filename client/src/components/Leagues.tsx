import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { LeagueDetail, LeagueGameType } from '@shared/leagues'
import type { Lang } from '../i18n'
import type { LeagueAccountTarget } from '../lib/leagueLinks'
import { useLeagues, type LeagueError } from '../useLeagues'
import { LeagueInviteLinks, LeagueJoinInvitation } from './LeagueInvites'
import './Leagues.css'

const errorCopy: Record<LeagueError, [string, string]> = {
  unauthorized: ['Vuelve a entrar en tu cuenta para ver las ligas.', 'Sign in again to see your leagues.'],
  unavailable: ['No hemos podido actualizar la liga. Inténtalo de nuevo.', 'We could not update the league. Please try again.'],
  league_not_found: ['No encontramos esa liga. Comprueba el código o tu acceso.', 'League not found. Check the code or your access.'],
  league_wrong_game: ['Esta liga pertenece a otro juego. Abre ese juego para unirte.', 'This league belongs to another game. Open that game to join.'],
  league_closed: ['Esta liga está cerrada y no acepta nuevas incorporaciones ni partidas.', 'This league is closed to new members and games.'],
  league_full: ['Esta liga ha alcanzado su límite de miembros.', 'This league has reached its member limit.'],
  invalid_league_name: ['Escribe un nombre de hasta 60 caracteres.', 'Enter a name of up to 60 characters.'],
  invalid_game_type: ['No hemos podido identificar el juego de esta liga.', 'We could not identify this league’s game.'],
  invalid_min_games: ['El mínimo para clasificarse debe estar entre 1 y 50 partidas.', 'The qualifying minimum must be between 1 and 50 games.'],
  invalid_invite_code: ['Comprueba el código de invitación de diez caracteres.', 'Check the ten-character invitation code.'],
  league_owner_required: ['Solo quien creó la liga puede hacer este cambio.', 'Only the league creator can make this change.'],
  rate_limited: ['Espera unos minutos antes de volver a intentarlo.', 'Wait a few minutes before trying again.'],
  league_limit: ['Has alcanzado el límite de ligas de tu cuenta.', 'You have reached your account’s league limit.'],
  invalid_season_name: ['Escribe un nombre para la temporada de hasta 60 caracteres.', 'Enter a season name of up to 60 characters.'],
  league_season_not_found: ['No encontramos esa temporada.', 'We could not find that season.'],
  league_season_limit: ['Esta liga ha alcanzado su límite de temporadas.', 'This league has reached its season limit.'],
}
export const leagueErrorText = (error: LeagueError, lang: Lang) => errorCopy[error][lang === 'es' ? 0 : 1]
const gameName = (game: 'pocha' | 'continental') => game === 'pocha' ? 'La Pocha' : 'Conti'

export function Leagues({ token, gameType, lang, active, onSignIn, target, onTargetHandled }: {
  token: string | null; gameType: LeagueGameType; lang: Lang; active: boolean; onSignIn: () => void
  target?: LeagueAccountTarget | null; onTargetHandled?: () => void
}) {
  const es = lang === 'es'
  const leagues = useLeagues(token, active, gameType)
  const { openLeague } = leagues
  const titleId = useId()
  const title = useRef<HTMLHeadingElement>(null)
  const returnFocus = useRef('')
  const focusOnReturn = useRef(false)
  const [form, setForm] = useState<'create' | 'join' | null>(null)
  const [name, setName] = useState('')
  const [minGames, setMinGames] = useState(5)
  const [code, setCode] = useState('')
  const [targetAttempt, setTargetAttempt] = useState(0)
  const direct = target?.kind === 'league' && target.gameType === gameType ? target : null
  const invite = target?.kind === 'invite' && target.gameType === gameType ? target : null
  const detailId = leagues.detail?.id
  useEffect(() => {
    if (!direct || !active || !token) return
    let current = true
    void openLeague(direct.id, direct.seasonId).then(ok => { if (ok && current) onTargetHandled?.() })
    return () => { current = false }
  }, [direct, active, token, openLeague, onTargetHandled, targetAttempt])
  useEffect(() => {
    if (detailId) title.current?.focus()
    else if (focusOnReturn.current) {
      focusOnReturn.current = false
      const listButton = document.getElementById(returnFocus.current)
      const destination = listButton ?? title.current
      destination?.focus()
    }
  }, [detailId])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const ok = form === 'create'
      ? await leagues.createLeague(String(fields.get('leagueName') ?? '').trim(), gameType, Number(fields.get('minGames')))
      : await leagues.joinLeague(String(fields.get('inviteCode') ?? '').trim().toUpperCase())
    if (ok) { setForm(null); setName(''); setCode('') }
  }
  const changeForm = (next: typeof form) => { setForm(next); leagues.clearError() }
  const detail = leagues.detail
  return <section className="leagues" aria-labelledby={titleId}>
    {detail ? <LeagueView key={detail.id} league={detail} lang={lang} busy={leagues.busy} titleId={titleId} titleRef={title}
      onBack={() => { focusOnReturn.current = true; onTargetHandled?.(); leagues.back(); setForm(null) }}
      onRefresh={() => void leagues.refreshDetail()} onSelectSeason={seasonId => void openLeague(detail.id, seasonId)}
      onClose={() => leagues.closeLeague(detail.id)} onRotate={() => leagues.rotateInvite(detail.id)}
      onStartSeason={name => leagues.startSeason(detail.id, name)} /> : invite ? <LeagueJoinInvitation
      code={invite.code} gameType={gameType} token={active ? token : null} lang={lang} titleId={titleId} busy={leagues.busy}
      onJoin={() => leagues.joinLeague(invite.code)} onOpen={openLeague} onSignIn={onSignIn}
      onCancel={() => { leagues.clearError(); onTargetHandled?.() }} /> : <>
      <div className="leagues-heading"><h3 id={titleId} tabIndex={-1} ref={title}>{es ? `Tus ligas de ${gameName(gameType)}` : `Your ${gameName(gameType)} leagues`}</h3>
        <button type="button" className="membership-text" disabled={leagues.loading || leagues.busy} onClick={() => void leagues.refresh()}>{es ? 'Actualizar' : 'Refresh'}</button></div>
      <p className="leagues-intro"><a href={`/learn/${lang}/standings/`}>{es ? 'Cómo se calcula la clasificación' : 'How standings work'}</a></p>
      <div className="leagues-entry-actions">
        <button className="membership-primary" type="button" disabled={leagues.busy} aria-expanded={form === 'create'} onClick={() => changeForm(form === 'create' ? null : 'create')}>{es ? 'Crear liga' : 'Create league'}</button>
        <button className="membership-secondary" type="button" disabled={leagues.busy} aria-expanded={form === 'join'} onClick={() => changeForm(form === 'join' ? null : 'join')}>{es ? 'Unirme con un código' : 'Join with a code'}</button>
      </div>
      {form && <form className="league-form" onSubmit={submit}>
        <h4>{form === 'create' ? (es ? 'Crear liga' : 'Create league') : (es ? 'Unirse a una liga' : 'Join a league')}</h4>
        {form === 'create' ? <>
          <label htmlFor="league-name">{es ? 'Nombre de la liga' : 'League name'}</label>
          <input id="league-name" name="leagueName" autoComplete="off" required maxLength={60} value={name} onChange={event => setName(event.target.value)} placeholder={es ? 'Las cartas del domingo' : 'Sunday card club'} />
          <p><strong>{es ? 'Juego' : 'Game'}:</strong> {gameName(gameType)}</p>
          <label htmlFor="league-min-games">{es ? 'Partidas mínimas para clasificarse' : 'Games needed to qualify'}</label>
          <input id="league-min-games" name="minGames" type="number" inputMode="numeric" required min={1} max={50} value={minGames} onChange={event => setMinGames(Number(event.target.value))} aria-describedby="league-min-games-help" />
          <p id="league-min-games-help">{es ? 'Hasta completar este mínimo, el jugador aparece como provisional. El juego y este mínimo quedan fijados al crear la liga.' : 'Players stay provisional until they complete this minimum. The game and minimum are fixed when you create the league.'}</p>
        </> : <>
          <label htmlFor="league-invite-code">{es ? 'Código de la liga' : 'League code'}</label>
          <input id="league-invite-code" name="inviteCode" className="league-code-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={10} minLength={10} pattern="[A-Fa-f0-9]{10}" required value={code} onChange={event => setCode(event.target.value.replace(/\s/g, '').toUpperCase())} />
          <p>{es ? 'Pídele el código a alguien de la liga. La invitación permite ver la clasificación y participar.' : 'Ask a league member for the code. The invitation lets you see the standings and take part.'}</p>
        </>}
        <div className="leagues-entry-actions"><button className="membership-primary" type="submit" disabled={leagues.busy}>{leagues.busy ? (es ? 'Un momento…' : 'One moment…') : form === 'create' ? (es ? 'Crear mi liga' : 'Create my league') : (es ? 'Unirme a la liga' : 'Join the league')}</button><button className="membership-text" type="button" disabled={leagues.busy} onClick={() => changeForm(null)}>{es ? 'Cancelar' : 'Cancel'}</button></div>
      </form>}
      {leagues.loading && !leagues.leagues && <p role="status">{es ? 'Cargando tus ligas…' : 'Loading your leagues…'}</p>}
      {leagues.leagues && !leagues.leagues.length && <div className="personal-stats-empty"><strong>{es ? 'Todavía no tienes ligas.' : 'No leagues yet.'}</strong><p>{es ? 'Crea una liga o únete con una invitación. Después, el anfitrión podrá elegirla dentro del lobby de la partida.' : 'Create a league or join with an invitation. The game host can then select it in the waiting lobby.'}</p></div>}
      {!!leagues.leagues?.length && <ul className="league-list">{leagues.leagues.map(league => <li key={league.id}><button id={`${titleId}-${league.id}`} type="button" disabled={leagues.busy} onClick={event => { returnFocus.current = event.currentTarget.id; void openLeague(league.id) }}>
        <span><strong>{league.name}</strong><small>{gameName(league.gameType)} · {league.memberCount} {es ? 'miembros' : 'members'} · {league.gameCount} {es ? 'partidas' : 'games'}</small></span><span className="league-list-status">{league.closedAt !== null ? (es ? 'Cerrada' : 'Closed') : league.isOwner ? (es ? 'Tu liga' : 'Your league') : (es ? 'Ver liga' : 'View league')} <span aria-hidden="true">→</span></span>
      </button></li>)}</ul>}
    </>}
    {leagues.error && <div className="membership-error" role="alert"><p>{leagueErrorText(leagues.error, lang)}</p>{leagues.error === 'unauthorized'
      ? <button type="button" className="membership-secondary" onClick={onSignIn}>{es ? 'Volver a entrar' : 'Sign in again'}</button>
      : direct && <button type="button" className="membership-secondary" onClick={() => setTargetAttempt(value => value + 1)}>{es ? 'Reintentar' : 'Try again'}</button>}</div>}
  </section>
}

function LeagueView({ league, lang, busy, titleId, titleRef, onBack, onRefresh, onSelectSeason, onClose, onRotate, onStartSeason }: {
  league: LeagueDetail; lang: Lang; busy: boolean; titleId: string; titleRef: React.RefObject<HTMLHeadingElement>
  onBack: () => void; onRefresh: () => void; onSelectSeason: (id?: string) => void; onClose: () => Promise<boolean>
  onRotate: () => Promise<boolean>; onStartSeason: (name: string) => Promise<boolean>
}) {
  const es = lang === 'es'
  const [confirmClose, setConfirmClose] = useState(false)
  const historical = Boolean(league.seasonId && league.seasonId !== league.activeSeasonId)
  const number = new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { maximumFractionDigits: 2 })
  return <>
    <div className="leagues-heading"><button type="button" className="membership-text" disabled={busy} onClick={onBack}>← {es ? 'Mis ligas' : 'My leagues'}</button><button type="button" className="membership-text" disabled={busy} onClick={onRefresh}>{busy ? (es ? 'Actualizando…' : 'Refreshing…') : (es ? 'Actualizar' : 'Refresh')}</button></div>
    <header className="league-title"><span className="membership-eyebrow">{gameName(league.gameType)}{league.closedAt !== null && (es ? ' · CERRADA' : ' · CLOSED')}</span><h3 id={titleId} tabIndex={-1} ref={titleRef}>{league.name}</h3><p>{league.memberCount} {es ? (league.memberCount === 1 ? 'miembro' : 'miembros') : (league.memberCount === 1 ? 'member' : 'members')} · {league.gameCount} {es ? (league.gameCount === 1 ? 'partida completada' : 'partidas completadas') : (league.gameCount === 1 ? 'completed game' : 'completed games')}</p></header>
    {league.closedAt === null && !historical && <LeagueInviteLinks key={league.inviteCode} league={league} lang={lang} busy={busy} onRotate={onRotate} />}
    <LeagueSeasons league={league} lang={lang} busy={busy} historical={historical} onSelect={onSelectSeason} onStart={onStartSeason} />
    <div className="league-ranking-heading"><h4>{es ? 'Clasificación' : 'Standings'}</h4><span>TrueSkill</span></div>
    <p className="league-ranking-help"><a href={`/learn/${lang}/standings/#rating`}>{es ? 'Cómo funciona el ranking' : 'How league rankings work'}</a></p>
    <ol className="league-standings">{league.standings.map(player => <li key={player.memberId} className={player.isMe ? 'is-me' : ''}>
      <span className="league-rank" aria-label={player.rank === null ? (es ? 'Provisional' : 'Provisional') : (es ? 'Puesto ' : 'Rank ') + player.rank}>{player.rank ?? '—'}</span>
      <div className="league-player"><strong>{player.name}{player.isMe && <small>{es ? ' · tú' : ' · you'}</small>}</strong>
        {player.provisional && <span>{player.isMe && !historical ? qualificationText(league.minGames - player.played, es) : 'Provisional'}</span>}
      </div>
      <div className="league-points"><strong>{number.format(player.rating)}</strong><span>{es ? 'puntos' : 'points'}</span></div>
      <dl className="league-player-stats"><div><dt>{es ? 'Jugadas' : 'Played'}</dt><dd>{player.played}</dd></div><div><dt>{es ? 'Ganadas' : 'Wins'}</dt><dd>{player.wins}</dd></div><div><dt>{es ? 'Victorias' : 'Win rate'}</dt><dd>{number.format(player.winRate)}%</dd></div><div><dt>{es ? 'Empates' : 'Draws'}</dt><dd>{player.draws}</dd></div></dl>
    </li>)}</ol>
    <h4>{es ? 'Últimas partidas' : 'Recent games'}</h4>
    {!league.recentGames.length ? <p className="membership-notice">{historical || league.closedAt !== null
      ? (es ? 'No hay partidas guardadas.' : 'No games were saved.')
      : (es ? 'Todavía no hay partidas. Elegid esta liga antes de empezar.' : 'No games yet. Select this league before starting.')}</p> : <ol className="league-games">{league.recentGames.map(game => <li key={game.id}><details><summary><time dateTime={new Date(game.finishedAt).toISOString()}>{new Date(game.finishedAt).toLocaleDateString(es ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</time><span>{game.playerCount} {es ? 'jugadores · Ver mesa' : 'players · View table'}</span></summary><ol>{[...game.players].sort((a, b) => a.position - b.position).map(player => <li key={player.memberId}><span>{player.position}. {player.name}</span><strong>{number.format(player.score)} pt</strong></li>)}</ol></details></li>)}</ol>}
    {league.isOwner && league.closedAt === null && !historical && <div className="league-close">
      {confirmClose ? <><strong>{es ? `¿Cerrar «${league.name}»?` : `Close “${league.name}”?`}</strong><p>{es ? 'Se conservarán la clasificación y el historial. No se admitirán nuevos miembros ni nuevas partidas; las que ya han empezado podrán terminar y contar.' : 'Standings and history will remain. New members and games will be blocked; games already started can still finish and count.'}</p><div className="leagues-entry-actions"><button type="button" className="membership-secondary" disabled={busy} onClick={async () => { if (await onClose()) setConfirmClose(false) }}>{es ? 'Sí, cerrar la liga' : 'Yes, close the league'}</button><button type="button" className="membership-text" disabled={busy} onClick={() => setConfirmClose(false)}>{es ? 'Cancelar' : 'Cancel'}</button></div></> : <button type="button" className="membership-text" disabled={busy} onClick={() => setConfirmClose(true)}>{es ? 'Cerrar esta liga' : 'Close this league'}</button>}
    </div>}
  </>
}

function qualificationText(remaining: number, es: boolean) {
  if (es) return remaining === 1 ? 'Te falta 1 partida' : `Te faltan ${remaining} partidas`
  return remaining === 1 ? '1 more game to qualify' : `${remaining} more games to qualify`
}

function LeagueSeasons({ league, lang, busy, historical, onSelect, onStart }: {
  league: LeagueDetail; lang: Lang; busy: boolean; historical: boolean
  onSelect: (id?: string) => void; onStart: (name: string) => Promise<boolean>
}) {
  const es = lang === 'es'
  const field = useId()
  const seasonName = useId()
  const [editing, setEditing] = useState(false)
  const enabled = !!league.seasons?.length
  const showManage = league.isOwner && league.closedAt === null && !historical
  if (!enabled && !showManage) return null
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = String(new FormData(event.currentTarget).get('seasonName') ?? '').trim()
    if (name && await onStart(name)) setEditing(false)
  }
  return <div className="league-seasons">
    {enabled && <><label htmlFor={field}>{es ? 'Temporada' : 'Season'}</label>
      <select id={field} value={league.seasonId} disabled={busy} onChange={event => onSelect(event.target.value === league.activeSeasonId ? undefined : event.target.value)}>
        {league.seasons?.slice().reverse().map(season => <option key={season.id} value={season.id}>
          {season.name ?? (es ? 'Historial anterior' : 'Previous results')}{season.id === league.activeSeasonId && league.closedAt === null ? (es ? ' · Actual' : ' · Current') : ''}
        </option>)}
      </select>
    </>}
    {showManage && (editing ? <form className="league-form" onSubmit={submit}>
      <h4>{es ? 'Empezar temporada' : 'Start season'}</h4>
      <p>{es ? 'La nueva clasificación empieza en cero. Los resultados anteriores quedan en el historial.' : 'The new standings start at zero. Previous results stay in the history.'}</p>
      <label htmlFor={seasonName}>{es ? 'Nombre de la temporada' : 'Season name'}</label>
      <input id={seasonName} name="seasonName" required maxLength={60} autoComplete="off" />
      <div className="leagues-entry-actions">
        <button type="submit" className="membership-primary" disabled={busy}>{es ? 'Empezar temporada' : 'Start season'}</button>
        <button type="button" className="membership-text" disabled={busy} onClick={() => setEditing(false)}>{es ? 'Cancelar' : 'Cancel'}</button>
      </div>
    </form> : <button type="button" className="membership-text" disabled={busy} onClick={() => setEditing(true)}>{enabled
      ? (es ? 'Empezar otra temporada' : 'Start another season')
      : (es ? 'Activar temporadas (opcional)' : 'Enable seasons (optional)')}</button>)}
  </div>
}
