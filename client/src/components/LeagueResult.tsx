import type { Lang } from '../i18n'
import { leagueAccountHash } from '../lib/leagueLinks'
import { isLeagueResultReceipt } from '../lib/leagues'
import { platformAccountHref } from '../lib/platform'
import { useLeagueRead } from '../useLeagueRead'
import './Leagues.css'

export function LeagueResult({ token, matchId, roomId, lang }: {
  token: string | null; matchId: string | null; roomId: string | null; lang: Lang
}) {
  const es = lang === 'es'
  const path = matchId && roomId ? `/results/${encodeURIComponent(matchId)}?roomId=${encodeURIComponent(roomId)}` : null
  const result = useLeagueRead(token, path, isLeagueResultReceipt)
  if (!token || !path) return null
  if (result.loading) return <p className="league-result" role="status">{es ? 'Comprobando resultado de liga…' : 'Checking league result…'}</p>
  const receipt = result.data
  if (!receipt || receipt.matchId !== matchId) {
    return <div className="league-result" role="status">
      <p>{es ? 'No se pudo comprobar el resultado de liga.' : 'We could not check the league result.'}</p>
      {result.error !== 'unauthorized' && <button type="button" onClick={result.retry}>{es ? 'Reintentar' : 'Try again'}</button>}
    </div>
  }
  const href = platformAccountHref() + leagueAccountHash({ kind: 'league', gameType: receipt.league.gameType,
    id: receipt.league.id, seasonId: receipt.season?.id })
  return <section className="league-result" aria-label={es ? 'Resultado de liga' : 'League result'} aria-live="polite">
    {receipt.status === 'counted' ? <><strong>{es ? 'Esta partida contó para tu liga' : 'This game counted for your league'}</strong>
      <RatingChange rating={receipt.rating} lang={lang} />
    </> : <><strong>{es ? 'Esta partida no contó para la liga' : 'This game did not count for the league'}</strong>
      <p>{receipt.reason === 'participants_changed'
        ? (es ? 'Los jugadores de la mesa cambiaron después de empezar.' : 'The players at the table changed after the game began.')
        : (es ? 'El resultado de la liga no quedó guardado.' : 'The league result was not saved.')}</p>
    </>}
    <a href={href}>{es ? 'Ver clasificación de' : 'View standings for'} {receipt.league.name}</a>
    {receipt.season?.name && <small>{receipt.season.name}</small>}
  </section>
}

function RatingChange({ rating, lang }: { rating: { before: number; after: number; change: number }; lang: Lang }) {
  const es = lang === 'es'
  const number = new Intl.NumberFormat(lang, { maximumFractionDigits: 2 })
  const signed = new Intl.NumberFormat(lang, { maximumFractionDigits: 2, signDisplay: 'exceptZero' })
  return <p className="league-result-rating" aria-label={es
    ? `Tu nivel pasó de ${number.format(rating.before)} a ${number.format(rating.after)}`
    : `Your rating went from ${number.format(rating.before)} to ${number.format(rating.after)}`}>
    {number.format(rating.before)} <span aria-hidden="true">→</span> {number.format(rating.after)} <span>({signed.format(rating.change)})</span>
  </p>
}
