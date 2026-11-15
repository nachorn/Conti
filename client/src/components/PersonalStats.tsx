import { useState } from 'react'
import type { Lang } from '../i18n'
import { usePersonalStats } from '../usePersonalStats'

export function PersonalStats({ token, lang, onSignIn, active }: { token: string | null; lang: Lang; onSignIn: () => void; active: boolean }) {
  const es = lang === 'es'
  const [filter, setFilter] = useState<'all' | 'pocha' | 'continental'>('all')
  const { data, loading, error, refresh } = usePersonalStats(token, active)
  const summary = data ? filter === 'all' ? data.overall : data.byGame[filter] : null
  const games = data?.recentGames.filter(game => filter === 'all' || game.gameType === filter) ?? []
  const number = new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { maximumFractionDigits: 1 })
  return <section className="personal-stats" aria-labelledby="personal-stats-title">
    <div className="personal-stats-heading"><h3 id="personal-stats-title">{es ? 'Tus resultados' : 'Your results'}</h3>
      <button type="button" className="membership-text" disabled={loading} onClick={() => void refresh()}>{loading ? (es ? 'Actualizando…' : 'Refreshing…') : (es ? 'Actualizar' : 'Refresh')}</button></div>
    <div className="personal-stats-filters" role="group" aria-label={es ? 'Filtrar por juego' : 'Filter by game'}>
      {(['all', 'pocha', 'continental'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value === 'all' ? (es ? 'Todos' : 'All games') : value === 'pocha' ? 'Pocha' : 'Conti'}</button>)}
    </div>
    {loading && !data && <p role="status">{es ? 'Cargando tus partidas…' : 'Loading your games…'}</p>}
    {error && <div className="membership-error" role="alert"><p>{error === 'expired' ? (es ? 'Vuelve a entrar para consultar tus estadísticas.' : 'Sign in again to see your statistics.') : (es ? 'No hemos podido actualizar tus resultados. Inténtalo de nuevo.' : 'Your results could not be updated. Please try again.')}</p>
      {error === 'expired' && <button className="membership-secondary" type="button" onClick={onSignIn}>{es ? 'Volver a entrar' : 'Sign in again'}</button>}</div>}
    {summary && <>
      <dl className="personal-stats-summary">
        {[[es ? 'Jugadas' : 'Played', summary.played], [es ? 'Ganadas' : 'Wins', summary.wins], [es ? 'Victorias' : 'Win rate', `${number.format(summary.winRate)}%`], [es ? 'Empatadas' : 'Draws', summary.draws]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'number' ? number.format(value) : value}</dd></div>)}
      </dl>
      {!summary.played ? <div className="personal-stats-empty"><strong>{es ? 'Tu próxima partida empieza el historial' : 'Your next game starts your history'}</strong><p>{es ? 'Entra en tu cuenta antes de empezar y termina una partida de Pocha o Conti con amigos. Aquí aparecerá el resultado.' : 'Sign in before starting and finish a game of Pocha or Conti with friends. Your result will appear here.'}</p></div> : <>
        <h3>{es ? 'Partidas recientes' : 'Recent games'}</h3>
        {!games.length && <p>{es ? 'No hay partidas de este juego entre las últimas 50.' : 'This game does not appear among your last 50 games.'}</p>}
        <ol className="personal-stats-history">{games.map(game => <li key={game.id}>
          <div className="personal-stats-game-heading"><strong>{game.gameType === 'pocha' ? 'La Pocha' : 'Conti'}</strong><span className={'personal-stats-outcome is-' + game.outcome}>{game.outcome === 'win' ? (es ? 'Victoria' : 'Win') : game.outcome === 'draw' ? (es ? 'Empate' : 'Draw') : (es ? 'Derrota' : 'Loss')}</span></div>
          <div className="personal-stats-game-meta"><time dateTime={new Date(game.finishedAt).toISOString()}>{new Date(game.finishedAt).toLocaleDateString(es ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</time><span>{game.position} / {game.playerCount} · {number.format(game.score)} {es ? 'puntos' : 'points'}</span></div>
          <details><summary>{es ? 'Ver mesa' : 'View table'}</summary><ol>{game.players.map((player, index) => <li key={index}><span>{player.position}. {player.name}</span><strong>{number.format(player.score)} pt</strong></li>)}</ol></details>
        </li>)}</ol>
      </>}
      <p className="personal-stats-note">{es ? 'Se cuentan las partidas nuevas que empiezas con tu cuenta y terminas, incluso frente a invitados. Los empates se muestran aparte; el porcentaje cuenta victorias individuales. Las partidas abandonadas y las de prueba con bots no cuentan.' : 'New games count when you sign in before starting and finish the game, including games against guests. Draws are separate; win rate counts individual wins. Abandoned games and test-bot games do not count.'}</p>
    </>}
  </section>
}
