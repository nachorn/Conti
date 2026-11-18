import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AdminLeagueDetail } from '@shared/platformAdmin'
import type { Lang } from '../i18n'
import { AdminLeaguesController, type LeagueFilters } from '../lib/adminLeagues'
import './AdminLeagues.css'

export function AdminLeagues({ lang, onSessionExpired }: { lang: Lang; onSessionExpired: () => void }) {
  const es = lang === 'es'
  const [controller] = useState(() => new AdminLeaguesController({ onSessionExpired }))
  const { list, detail, selected, loading, loadingDetail, error } = useSyncExternalStore(controller.subscribe, controller.getState)
  const [filters, setFilters] = useState<LeagueFilters>({ q: '', gameType: '', status: 'all', offset: 0 })
  useEffect(() => {
    const timeout = window.setTimeout(() => void controller.load(filters), filters.q ? 300 : 0)
    return () => { window.clearTimeout(timeout); controller.cancel() }
  }, [controller, filters])
  const update = (value: Partial<LeagueFilters>) => { controller.clearSelection(); setFilters(previous => ({ ...previous, ...value, offset: 0 })) }
  const date = (value: number) => new Date(value).toLocaleDateString(es ? 'es-ES' : 'en-US')
  return <section className="admin-leagues" aria-labelledby="admin-leagues-title">
    <div className="dashboard-section-heading"><h2 id="admin-leagues-title">{es ? 'Ligas' : 'Leagues'}{list && <span>{list.filtered} / {list.total}</span>}</h2>
      <button type="button" className="dashboard-button" disabled={loading} onClick={() => void controller.load(filters)}>{es ? 'Actualizar' : 'Refresh'}</button></div>
    <p className="dashboard-note"><a href={`/learn/${lang}/standings/`}>{es ? 'Cómo se calculan los resultados y la clasificación' : 'How results and standings are calculated'}</a></p>
    <div className="admin-league-filters">
      <label><span>{es ? 'Nombre o creador' : 'Name or creator'}</span><input type="search" maxLength={100} value={filters.q} placeholder={es ? 'Buscar liga' : 'Find a league'} onChange={event => update({ q: event.target.value })} /></label>
      <label><span>{es ? 'Juego' : 'Game'}</span><select value={filters.gameType} onChange={event => update({ gameType: event.target.value as LeagueFilters['gameType'] })}>
        <option value="">{es ? 'Todos' : 'All'}</option><option value="continental">Conti</option><option value="pocha">Pocha</option>
      </select></label>
      <label><span>{es ? 'Estado' : 'Status'}</span><select value={filters.status} onChange={event => update({ status: event.target.value as LeagueFilters['status'] })}>
        <option value="all">{es ? 'Todas' : 'All'}</option><option value="active">{es ? 'Abiertas' : 'Open'}</option><option value="closed">{es ? 'Cerradas' : 'Closed'}</option>
      </select></label>
    </div>
    {error === 'list' && <p className="dashboard-error" role="alert">{es ? 'No se pudieron cargar las ligas.' : 'Leagues could not be loaded.'}</p>}
    {loading && <p className="dashboard-note" role="status">{es ? 'Cargando ligas…' : 'Loading leagues…'}</p>}
    <div className={`admin-league-layout${selected ? ' has-selection' : ''}`}>
      <div>{list && <>
        <div className="admin-league-list">{list.leagues.map(league => <button type="button" className={`admin-league-card${selected === league.id ? ' is-selected' : ''}`} key={league.id}
          aria-pressed={selected === league.id} onClick={() => void controller.select(league.id)}>
          <span className="admin-league-card-top"><strong>{league.name}</strong><span>{league.gameType === 'continental' ? 'Conti' : 'Pocha'} · {league.closedAt === null ? (es ? 'Abierta' : 'Open') : (es ? 'Cerrada' : 'Closed')}</span></span>
          <span className="admin-league-owner">{es ? 'Creador' : 'Creator'}: {league.ownerName}</span>
          <span className="admin-league-card-bottom"><span>{league.memberCount} {es ? (league.memberCount === 1 ? 'jugador' : 'jugadores') : (league.memberCount === 1 ? 'player' : 'players')} · {league.gameCount} {es ? (league.gameCount === 1 ? 'partida' : 'partidas') : (league.gameCount === 1 ? 'game' : 'games')}</span><time dateTime={new Date(league.createdAt).toISOString()}>{date(league.createdAt)}</time></span>
        </button>)}</div>
        {!list.leagues.length && <p className="dashboard-note">{es ? 'No hay ligas que coincidan.' : 'No matching leagues.'}</p>}
        <nav className="admin-league-pagination" aria-label={es ? 'Páginas de ligas' : 'League pages'}>
          <span>{list.leagues.length ? `${list.offset + 1}–${list.offset + list.leagues.length} / ${list.filtered}` : '0 / 0'}</span>
          <button type="button" className="dashboard-button" disabled={loading || list.offset === 0} onClick={() => setFilters(previous => ({ ...previous, offset: Math.max(0, list.offset - list.limit) }))}>{es ? 'Anterior' : 'Previous'}</button>
          <button type="button" className="dashboard-button" disabled={loading || list.offset + list.limit >= list.filtered} onClick={() => setFilters(previous => ({ ...previous, offset: list.offset + list.limit }))}>{es ? 'Siguiente' : 'Next'}</button>
        </nav>
      </>}</div>
      {selected && <div className="admin-league-detail" aria-live="polite">
        <button type="button" className="dashboard-button admin-league-close" onClick={controller.clearSelection}>{es ? 'Cerrar detalle' : 'Close details'}</button>
        {loadingDetail && <p role="status" className="dashboard-note">{es ? 'Cargando clasificación…' : 'Loading standings…'}</p>}
        {(error === 'detail' || error === 'missing') && <p className="dashboard-error" role="alert">{error === 'missing' ? (es ? 'La liga ya no está disponible.' : 'This league is no longer available.') : (es ? 'No se pudo cargar la liga.' : 'The league could not be loaded.')}
          {' '}<button type="button" className="dashboard-button" onClick={() => void controller.select(selected)}>{es ? 'Reintentar' : 'Retry'}</button></p>}
        {detail && <LeagueDetail league={detail} lang={lang} />}
      </div>}
    </div>
  </section>
}

function LeagueDetail({ league, lang }: { league: AdminLeagueDetail; lang: Lang }) {
  const es = lang === 'es', date = (value: number) => new Date(value).toLocaleDateString(es ? 'es-ES' : 'en-US')
  return <>
    <h3 className="admin-league-detail-title">{league.name}</h3>
    <p className="dashboard-note">{league.gameType === 'continental' ? 'Conti' : 'Pocha'} · {es ? 'Creador' : 'Creator'}: {league.ownerName} · {league.closedAt === null ? (es ? 'Abierta' : 'Open') : `${es ? 'Cerrada' : 'Closed'} ${date(league.closedAt)}`}</p>
    <div className="admin-league-totals"><span><strong>{league.memberCount}</strong>{es ? 'Jugadores' : 'Players'}</span><span><strong>{league.gameCount}</strong>{es ? 'Partidas' : 'Games'}</span><span><strong>{league.minGames}</strong>{es ? 'Mínimo para clasificación' : 'Games to qualify'}</span></div>
    <h4>{es ? 'Clasificación y jugadores' : 'Standings and players'}</h4>
    <p className="dashboard-note">TrueSkill · {es ? 'Sin puesto hasta completar el mínimo de partidas.' : 'Unranked until the minimum number of games is completed.'}</p>
    <div className="dashboard-table-scroll"><table className="dashboard-report-table admin-league-standings"><thead><tr>
      <th scope="col">#</th><th scope="col">{es ? 'Jugador' : 'Player'}</th><th scope="col">{es ? 'Rating' : 'Rating'}</th><th scope="col">{es ? 'Partidas' : 'Games'}</th><th scope="col">{es ? 'Victorias' : 'Wins'}</th><th scope="col">{es ? 'Empates' : 'Draws'}</th><th scope="col">{es ? 'Derrotas' : 'Losses'}</th><th scope="col">%</th>
    </tr></thead><tbody>{league.standings.map(row => <tr key={row.memberId}>
      <td>{row.rank ?? '—'}</td><th scope="row"><strong>{row.name}</strong><small>{row.isOwner ? `${es ? 'Creador' : 'Creator'} · ` : ''}{es ? 'Desde' : 'Joined'} {date(row.joinedAt)}{row.provisional ? ` · ${es ? 'Provisional' : 'Provisional'}` : ''}</small></th>
      <td>{row.rating.toLocaleString(es ? 'es-ES' : 'en-US', { maximumFractionDigits: 2 })}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.winRate}%</td>
    </tr>)}</tbody></table></div>
    <details className="dashboard-details"><summary>{es ? 'Últimas partidas' : 'Recent games'} <span>{league.recentGames.length}</span></summary>
      {!league.recentGames.length && <p className="dashboard-note">{es ? 'Aún no hay partidas registradas.' : 'No recorded games yet.'}</p>}
      <div className="admin-league-games">{league.recentGames.map(game => <article key={game.id}><h5><time dateTime={new Date(game.finishedAt).toISOString()}>{new Date(game.finishedAt).toLocaleString(es ? 'es-ES' : 'en-US')}</time></h5>
        <ol>{game.players.map(player => <li key={player.memberId}><span>{player.position}. {player.name}</span><strong>{player.score} {es ? 'pts' : 'pts'}</strong></li>)}</ol>
      </article>)}</div>
    </details>
  </>
}
