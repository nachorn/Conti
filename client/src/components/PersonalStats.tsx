import type { Lang } from '../i18n'
import { usePersonalStats } from '../usePersonalStats'

export function PersonalStats({ token, lang, onSignIn, active, gameType }: { token: string | null; lang: Lang; onSignIn: () => void; active: boolean; gameType: 'pocha' | 'continental' }) {
  const es = lang === 'es'
  const gameName = gameType === 'pocha' ? 'La Pocha' : 'Conti'
  const titleId = `personal-stats-${gameType}-title`
  const { data, loading, error, refresh } = usePersonalStats(token, active, gameType)
  const summary = data?.byGame[gameType] ?? null
  const games = data?.recentGames.filter(game => game.gameType === gameType) ?? []
  const number = new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { maximumFractionDigits: 1 })
  return <section className="personal-stats" aria-labelledby={titleId}>
    <div className="personal-stats-heading"><h3 id={titleId}>{es ? `Estadísticas de ${gameName}` : `${gameName} statistics`}</h3>
      <button type="button" className="membership-text" disabled={loading} onClick={() => void refresh()}>{loading ? (es ? 'Actualizando…' : 'Refreshing…') : (es ? 'Actualizar' : 'Refresh')}</button></div>
    {loading && !data && <p role="status">{es ? `Cargando tus partidas de ${gameName}…` : `Loading your ${gameName} games…`}</p>}
    {error && <div className="membership-error" role="alert"><p>{error === 'expired' ? (es ? `Vuelve a entrar para consultar tus estadísticas de ${gameName}.` : `Sign in again to see your ${gameName} statistics.`) : (es ? `No hemos podido actualizar tus resultados de ${gameName}. Inténtalo de nuevo.` : `Your ${gameName} results could not be updated. Please try again.`)}</p>
      {error === 'expired' && <button className="membership-secondary" type="button" onClick={onSignIn}>{es ? 'Volver a entrar' : 'Sign in again'}</button>}</div>}
    {summary && <>
      <dl className="personal-stats-summary">
        {[[es ? 'Jugadas' : 'Played', summary.played], [es ? 'Ganadas' : 'Wins', summary.wins], [es ? '% victorias' : 'Win rate', `${number.format(summary.winRate)}%`], [es ? 'Empatadas' : 'Draws', summary.draws]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === 'number' ? number.format(value) : value}</dd></div>)}
      </dl>
      {!summary.played ? <div className="personal-stats-empty"><strong>{es ? `Todavía no has completado partidas de ${gameName}` : `You have not completed any ${gameName} games yet`}</strong><p>{es ? `Entra en tu cuenta antes de empezar y termina una partida de ${gameName}. Aquí aparecerá el resultado.` : `Sign in before starting and finish a game of ${gameName}. Your result will appear here.`}</p></div> : <>
        <h3>{es ? `Partidas recientes de ${gameName}` : `Recent ${gameName} games`}</h3>
        {!games.length && <p>{es ? `No hay partidas recientes de ${gameName} disponibles.` : `No recent ${gameName} games are available.`}</p>}
        <ol className="personal-stats-history">{games.map(game => <li key={game.id}>
          <div className="personal-stats-game-heading"><strong>{game.gameType === 'pocha' ? 'La Pocha' : 'Conti'}</strong><span className={'personal-stats-outcome is-' + game.outcome}>{game.outcome === 'win' ? (es ? 'Victoria' : 'Win') : game.outcome === 'draw' ? (es ? 'Empate' : 'Draw') : (es ? 'Derrota' : 'Loss')}</span></div>
          <div className="personal-stats-game-meta"><time dateTime={new Date(game.finishedAt).toISOString()}>{new Date(game.finishedAt).toLocaleDateString(es ? 'es-ES' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</time><span>{game.position} / {game.playerCount} · {number.format(game.score)} {es ? 'puntos' : 'points'}</span></div>
          <details><summary>{es ? 'Ver mesa' : 'View table'}</summary><ol>{game.players.map((player, index) => <li key={index}><span>{player.position}. {player.name}</span><strong>{number.format(player.score)} pt</strong></li>)}</ol></details>
        </li>)}</ol>
      </>}
      <p className="personal-stats-note">{es ? `Cuentan las partidas de ${gameName} que empiezas con tu cuenta y completas. Los empates se cuentan aparte. No cuentan abandonos ni partidas con bots.` : `${gameName} games count when you sign in before starting and complete the game. Draws count separately. Abandoned games and games with bots do not count.`}</p>
    </>}
  </section>
}
