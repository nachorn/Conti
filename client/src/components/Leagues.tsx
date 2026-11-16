import { useState, type FormEvent } from 'react'
import type { LeagueDetail, LeagueGameType } from '@shared/leagues'
import type { Lang } from '../i18n'
import { useLeagues, type LeagueError } from '../useLeagues'
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
  league_owner_required: ['Solo quien creó la liga puede cerrarla.', 'Only the league creator can close it.'],
  rate_limited: ['Espera unos minutos antes de volver a intentarlo.', 'Wait a few minutes before trying again.'],
  league_limit: ['Has alcanzado el límite de ligas de tu cuenta.', 'You have reached your account’s league limit.'],
}
export const leagueErrorText = (error: LeagueError, lang: Lang) => errorCopy[error][lang === 'es' ? 0 : 1]
const gameName = (game: 'pocha' | 'continental') => game === 'pocha' ? 'La Pocha' : 'Conti'

export function Leagues({ token, gameType, lang, active, onSignIn }: { token: string | null; gameType: LeagueGameType; lang: Lang; active: boolean; onSignIn: () => void }) {
  const es = lang === 'es'
  const leagues = useLeagues(token, active, gameType)
  const [form, setForm] = useState<'create' | 'join' | null>(null)
  const [name, setName] = useState('')
  const [minGames, setMinGames] = useState(5)
  const [code, setCode] = useState('')
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const ok = form === 'create'
      ? await leagues.createLeague(String(fields.get('leagueName') ?? '').trim(), gameType, Number(fields.get('minGames')))
      : await leagues.joinLeague(String(fields.get('inviteCode') ?? '').trim().toUpperCase())
    if (ok) { setForm(null); setName(''); setCode('') }
  }
  const changeForm = (next: typeof form) => { setForm(next); leagues.clearError() }
  return <section className="leagues" aria-labelledby="leagues-title">
    {leagues.detail ? <LeagueView league={leagues.detail} lang={lang} busy={leagues.busy}
      onBack={() => { leagues.back(); setForm(null) }} onRefresh={() => void leagues.openLeague(leagues.detail!.id)}
      onClose={() => leagues.closeLeague(leagues.detail!.id)} /> : <>
      <div className="leagues-heading"><h3 id="leagues-title">{es ? `Tus ligas de ${gameName(gameType)}` : `Your ${gameName(gameType)} leagues`}</h3>
        <button type="button" className="membership-text" disabled={leagues.loading || leagues.busy} onClick={() => void leagues.refresh()}>{es ? 'Actualizar' : 'Refresh'}</button></div>
      <p className="leagues-intro">{es ? `Clasificaciones privadas de ${gameName(gameType)}.` : `Private ${gameName(gameType)} standings.`}</p>
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
      {!!leagues.leagues?.length && <ul className="league-list">{leagues.leagues.map(league => <li key={league.id}><button type="button" disabled={leagues.busy} onClick={() => void leagues.openLeague(league.id)}>
        <span><strong>{league.name}</strong><small>{gameName(league.gameType)} · {league.memberCount} {es ? 'miembros' : 'members'} · {league.gameCount} {es ? 'partidas' : 'games'}</small></span><span className="league-list-status">{league.closedAt !== null ? (es ? 'Cerrada' : 'Closed') : league.isOwner ? (es ? 'Tu liga' : 'Your league') : (es ? 'Ver liga' : 'View league')} <span aria-hidden="true">→</span></span>
      </button></li>)}</ul>}
    </>}
    {leagues.error && <div className="membership-error" role="alert"><p>{leagueErrorText(leagues.error, lang)}</p>{leagues.error === 'unauthorized' && <button type="button" className="membership-secondary" onClick={onSignIn}>{es ? 'Volver a entrar' : 'Sign in again'}</button>}</div>}
  </section>
}

function LeagueView({ league, lang, busy, onBack, onRefresh, onClose }: {
  league: LeagueDetail; lang: Lang; busy: boolean; onBack: () => void; onRefresh: () => void; onClose: () => Promise<boolean>
}) {
  const es = lang === 'es'
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const number = new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { maximumFractionDigits: 2 })
  const copyCode = async () => { try { await navigator.clipboard.writeText(league.inviteCode); setCopied(true); setCopyError(false) } catch { setCopyError(true) } }
  const share = async () => {
    try { await navigator.share({ title: league.name, text: es ? `Únete a «${league.name}» en ${window.location.origin}. En Mi cuenta → Ligas, introduce el código ${league.inviteCode}.` : `Join “${league.name}” at ${window.location.origin}. In My account → Leagues, enter code ${league.inviteCode}.` }) }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setCopyError(true) }
  }
  return <>
    <div className="leagues-heading"><button type="button" className="membership-text" disabled={busy} onClick={onBack}>← {es ? 'Mis ligas' : 'My leagues'}</button><button type="button" className="membership-text" disabled={busy} onClick={onRefresh}>{busy ? (es ? 'Actualizando…' : 'Refreshing…') : (es ? 'Actualizar' : 'Refresh')}</button></div>
    <header className="league-title"><span className="membership-eyebrow">{gameName(league.gameType)} · {league.closedAt !== null ? (es ? 'LIGA CERRADA' : 'CLOSED LEAGUE') : (es ? 'LIGA PRIVADA' : 'PRIVATE LEAGUE')}</span><h3 id="leagues-title">{league.name}</h3><p>{league.memberCount} {es ? (league.memberCount === 1 ? 'miembro' : 'miembros') : (league.memberCount === 1 ? 'member' : 'members')} · {league.gameCount} {es ? (league.gameCount === 1 ? 'partida completada' : 'partidas completadas') : (league.gameCount === 1 ? 'completed game' : 'completed games')}</p></header>
    {league.closedAt === null && <details className="league-invite" open={league.gameCount === 0}>
      <summary>{es ? 'Invitar al grupo' : 'Invite your group'}</summary>
      <div><label htmlFor="league-share-code">{es ? 'Invita a tu grupo con este código' : 'Invite your group with this code'}</label><input id="league-share-code" readOnly value={league.inviteCode} aria-label={es ? 'Código de invitación' : 'Invitation code'} onFocus={event => event.currentTarget.select()} /><div className="leagues-entry-actions"><button type="button" className="membership-secondary" onClick={() => void copyCode()}>{copied ? (es ? 'Código copiado' : 'Code copied') : (es ? 'Copiar código' : 'Copy code')}</button>{typeof navigator.share === 'function' && <button type="button" className="membership-secondary" onClick={() => void share()}>{es ? 'Compartir' : 'Share'}</button>}</div>{copyError && <p role="status">{es ? 'Selecciona el código de arriba y cópialo para compartirlo.' : 'Select and copy the code above to share it.'}</p>}</div>
    </details>}
    <div className="league-ranking-heading"><h4>{es ? 'Clasificación' : 'Standings'}</h4><span>TrueSkill</span></div>
    <p className="league-ranking-help">{es ? `Se ordena por puntos TrueSkill. Se tienen en cuenta tus rivales y el puesto final de todos los jugadores. Necesitas ${league.minGames} ${league.minGames === 1 ? 'partida' : 'partidas'} para clasificarte.` : `Ordered by TrueSkill points, considering your opponents and every player’s final position. Complete ${league.minGames} ${league.minGames === 1 ? 'game' : 'games'} to qualify.`}</p>
    <ol className="league-standings">{league.standings.map(player => <li key={player.memberId} className={player.isMe ? 'is-me' : ''}>
      <span className="league-rank" aria-label={player.rank === null ? (es ? 'Provisional' : 'Provisional') : (es ? 'Puesto ' : 'Rank ') + player.rank}>{player.rank ?? '—'}</span>
      <div className="league-player"><strong>{player.name}{player.isMe && <small>{es ? ' · tú' : ' · you'}</small>}</strong><span>{player.provisional ? (es ? `Provisional · ${player.played}/${league.minGames} partidas` : `Provisional · ${player.played}/${league.minGames} games`) : (es ? 'Clasificado' : 'Qualified')}</span></div>
      <div className="league-points"><strong>{number.format(player.rating)}</strong><span>{es ? 'puntos' : 'points'}</span></div>
      <dl className="league-player-stats"><div><dt>{es ? 'Jugadas' : 'Played'}</dt><dd>{player.played}</dd></div><div><dt>{es ? 'Ganadas' : 'Wins'}</dt><dd>{player.wins}</dd></div><div><dt>{es ? 'Victorias' : 'Win rate'}</dt><dd>{number.format(player.winRate)}%</dd></div><div><dt>{es ? 'Empates' : 'Draws'}</dt><dd>{player.draws}</dd></div></dl>
    </li>)}</ol>
    <p className="league-ranking-help">{es ? 'Los puntos usan una estimación prudente del nivel: una buena racha inicial sigue siendo provisional. Las victorias y el porcentaje se muestran como información; los empates cuentan aparte.' : 'Points use a conservative skill estimate: a good early streak stays provisional. Wins and win rate are shown for context; draws are counted separately.'}</p>
    <h4>{es ? 'Últimas partidas' : 'Recent games'}</h4>
    {!league.recentGames.length ? <p className="membership-notice">{es ? 'Todavía no hay partidas. Elegid esta liga en el lobby antes de empezar; todos los jugadores deben tener cuenta y ser miembros.' : 'No games yet. Select this league in the waiting lobby before starting; every player needs an account and league membership.'}</p> : <ol className="league-games">{league.recentGames.map(game => <li key={game.id}><details><summary><time dateTime={new Date(game.finishedAt).toISOString()}>{new Date(game.finishedAt).toLocaleDateString(es ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</time><span>{game.playerCount} {es ? 'jugadores · Ver mesa' : 'players · View table'}</span></summary><ol>{[...game.players].sort((a, b) => a.position - b.position).map(player => <li key={player.memberId}><span>{player.position}. {player.name}</span><strong>{number.format(player.score)} pt</strong></li>)}</ol></details></li>)}</ol>}
    <p className="league-ranking-help">{es ? 'Solo cuentan partidas completas de esta liga con todos sus jugadores identificados. Las partidas con invitados, bots o abandonos quedan fuera de la clasificación.' : 'Only completed league games with every player signed in count. Games with guests, bots or departures do not affect the standings.'}</p>
    {league.isOwner && league.closedAt === null && <div className="league-close">
      {confirmClose ? <><strong>{es ? `¿Cerrar «${league.name}»?` : `Close “${league.name}”?`}</strong><p>{es ? 'Se conservarán la clasificación y el historial. No se admitirán nuevos miembros ni nuevas partidas; las que ya han empezado podrán terminar y contar.' : 'Standings and history will remain. New members and games will be blocked; games already started can still finish and count.'}</p><div className="leagues-entry-actions"><button type="button" className="membership-secondary" disabled={busy} onClick={async () => { if (await onClose()) setConfirmClose(false) }}>{es ? 'Sí, cerrar la liga' : 'Yes, close the league'}</button><button type="button" className="membership-text" disabled={busy} onClick={() => setConfirmClose(false)}>{es ? 'Cancelar' : 'Cancel'}</button></div></> : <button type="button" className="membership-text" disabled={busy} onClick={() => setConfirmClose(true)}>{es ? 'Cerrar esta liga' : 'Close this league'}</button>}
    </div>}
  </>
}
