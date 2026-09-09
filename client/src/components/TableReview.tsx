import type { GameState, RoundResult } from '../types'
import type { Lang } from '../i18n'
import { Card } from './Card'
import { actionSummary, meldSummary } from '../lib/tableSummary'
import { orderMeldCardsForDisplay } from '../lib/meldTargeting'
import { cardLabel } from '../lib/cardActivity'

export function PublicTable({ state, lang, updatedId }: { state: GameState; lang: Lang; updatedId: string | null }) {
  const actions = [...(state.activity ?? [])].reverse()
  const latest = actions.find(a => a.kind !== 'pass')
  return <section className="public-table" aria-label={lang === 'es' ? 'Bajadas y jugadas' : 'Melds and recent play'}>
    <details className="public-activity">
      <summary>{lang === 'es' ? 'Jugadas recientes' : 'Recent play'}<span role="status" aria-atomic="true">{latest ? ` · ${actionSummary(latest, lang)}` : ''}</span></summary>
      {actions.length ? <ol>{actions.map(action => <li key={action.id}>{actionSummary(action, lang)}</li>)}</ol>
        : <p>{lang === 'es' ? 'Las jugadas aparecerán aquí.' : 'New actions will appear here.'}</p>}
    </details>
    <details className="public-melds" open>
      <summary>{lang === 'es' ? 'Bajadas de la mesa' : 'Table melds'} · {state.melds.length}</summary>
      <div className="public-meld-list">
        {state.melds.length === 0 && <p>{lang === 'es' ? 'Aún no hay bajadas.' : 'No melds played yet.'}</p>}
        {Array.from(new Set(state.melds.map(m => m.ownerId))).map(ownerId => <section key={ownerId} className="public-player-melds">
          <h3>{state.players.find(p => p.id === ownerId)?.name ?? (lang === 'es' ? 'Jugador que salió' : 'Player who left')}</h3>
          {state.melds.filter(m => m.ownerId === ownerId).map(meld => <details key={meld.id} className={`public-meld ${updatedId === meld.id ? 'meld-row-updated' : ''}`}>
            <summary>{meldSummary(meld, lang)}</summary>
            <div className="public-meld-cards" role="list" aria-label={meldSummary(meld, lang)}>
              {orderMeldCardsForDisplay(meld).map(card => <span key={card.id} role="listitem" aria-label={cardLabel(card, lang)}><Card card={card} size="small" /></span>)}
            </div>
          </details>)}
        </section>)}
      </div>
    </details>
  </section>
}

export function ScoreHistory({ state, lang }: { state: GameState; lang: Lang }) {
  const history = [...(state.roundHistory ?? [])]
  // A game restored from an older save may only have its latest round's points.
  if ((state.phase === 'round_end' || state.phase === 'game_end') && Object.keys(state.roundScores).length && !history.some(r => r.round === state.round)) {
    history.push({ round: state.round, winnerId: null, sameTurnWin: false, scores: state.roundScores,
      totals: Object.fromEntries(state.players.map(p => [p.id, p.score])),
      names: Object.fromEntries(state.players.map(p => [p.id, p.name])),
    })
  }
  const ids = [...new Set([...state.players.map(p => p.id), ...history.flatMap(r => Object.keys(r.names))])]
  const players = ids.map(id => ({ id, name: state.players.find(p => p.id === id)?.name ?? history.find(r => r.names[id])?.names[id],
    score: state.players.find(p => p.id === id)?.score ?? [...history].reverse().find(r => r.totals[id] !== undefined)?.totals[id] ?? 0,
  })).sort((a, b) => a.score - b.score)
  return <div className="score-history" role="region" aria-label={lang === 'es' ? 'Puntos por ronda' : 'Round-by-round scores'} tabIndex={0}>
    <table>
      <caption>{lang === 'es' ? 'Clasificación · gana el menor total' : 'Standings · lowest total wins'}</caption>
      <thead><tr><th scope="col">{lang === 'es' ? 'Jugador' : 'Player'}</th>{history.map(r => <th scope="col" key={r.round}>R{r.round}</th>)}<th scope="col">Total</th></tr></thead>
      <tbody>{players.map(player => <tr key={player.id}>
        <th scope="row" title={player.name}>{player.name}</th>
        {history.map(r => <td key={r.round} className={r.winnerId === player.id ? 'round-winner-score' : undefined}>{r.scores[player.id] ?? '—'}</td>)}
        <td><strong>{player.score}</strong></td>
      </tr>)}</tbody>
    </table>
    {history.length > 3 && <p className="score-history-hint">{lang === 'es' ? 'Desliza la tabla para ver todas las rondas.' : 'Scroll the table sideways to see every round.'}</p>}
    {!history.length && <p>{lang === 'es' ? 'El historial se guardará al terminar la próxima ronda.' : 'Round history will be saved when the next round ends.'}</p>}
  </div>
}

export function RoundRecap({ result, lang }: { result: RoundResult | undefined; lang: Lang }) {
  if (!result) return null
  const winner = result.winnerId ? result.names[result.winnerId] : null
  return <section className="round-recap">
    <p className="game-final-winner">{winner ? `★ ${winner} ${lang === 'es' ? 'ganó la ronda' : 'won the round'}` : (lang === 'es' ? 'Ronda terminada sin ganador' : 'Round ended without a winner')}</p>
    {result.closingAction && <p>{actionSummary(result.closingAction, lang)}</p>}
    {winner && <p>{lang === 'es' ? 'Bonificación por ganar' : 'Winner’s bonus'}: <strong>{result.scores[result.winnerId!]}</strong> · {result.sameTurnWin
      ? (lang === 'es' ? `Cerró al bajar su contrato (−10 × ronda ${result.round}).` : `Went out on the turn they played their contract (−10 × round ${result.round}).`)
      : (lang === 'es' ? 'Cerró en un turno posterior (−10).' : 'Went out on a later turn (−10).')}</p>}
    <p className="scoring-explanation">{lang === 'es' ? 'Los demás suman sus cartas restantes: 2–10 = valor, J/Q/K = 10, A = 20, comodín = 50.' : 'Everyone else scores the cards left in hand: 2–10 = face value, J/Q/K = 10, A = 20, Joker = 50.'}</p>
  </section>
}
