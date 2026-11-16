import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PochaAction, PochaDeckSize, PochaGameState, PochaLobbyUpdate, PochaSettings, SpanishSuit } from '@shared/pochaTypes'
import { POCHA_DECK_SIZES, POCHA_TRICK_ORDER, POCHA_TRICK_REVIEW_MS } from '@shared/pochaTypes'
import { isPochaAuctionRound, legalCards, pochaScoring, roundSchedule, winningCard } from '@shared/pochaRules'
import { t, type Lang } from '../i18n'
import type { ActionResult } from '../types'
import { GameShell } from './GameShell'
import { SpanishCard, POCHA_SUIT_LABEL } from './pocha'
import { SpanishSuitIcon } from './pocha/SpanishSuitIcon'
import { SpanishCardBack } from './pocha/SpanishCardBack'
import { pochaRankLong } from './pocha/pochaCardUtils'
import './PochaBoard.css'

export interface PochaBoardProps {
  state: PochaGameState
  socketId: string | null
  lang: Lang
  setLang: (l: Lang) => void
  onLeave: () => void
  onAction?: (action: PochaAction) => Promise<ActionResult>
  onStart?: (settings: PochaSettings) => void
  onConfigure?: (update: PochaLobbyUpdate) => Promise<ActionResult>
  onNextRound?: () => void
  onRematch?: () => void
  onBid?: (tricks: number) => void
  onPlayCard?: (cardId: string) => void
  isConnected?: boolean
  error?: string | null
  lobbyExtra?: ReactNode
}

export function PochaBoard({ state, socketId, lang, setLang, onLeave, onAction, onStart, onConfigure, onNextRound, onRematch,
  onBid, onPlayCard, isConnected = true, error, lobbyExtra }: PochaBoardProps) {
  const L = (es: string, en: string) => lang === 'es' ? es : en
  const [selected, setSelected] = useState<string | null>(null)
  const [bid, setBid] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [, refreshClock] = useState(0)
  const clockOffset = useMemo(() => state.serverTime === undefined ? 0 : state.serverTime - Date.now(), [state.serverTime])
  // Keeps an already-open table readable while an older server is being updated.
  const fallbackReviewUntil = useMemo(() => state.lastTrick ? Date.now() + POCHA_TRICK_REVIEW_MS : 0,
    [state.roomId, state.lastTrick?.cards[0]?.card.id])
  const reviewUntil = state.trickReviewUntil == null ? fallbackReviewUntil : state.trickReviewUntil - clockOffset
  const reviewSeconds = Math.max(0, Math.ceil((reviewUntil - Date.now()) / 1000))
  const reviewing = !!state.lastTrick && reviewSeconds > 0
  useEffect(() => {
    if (reviewUntil <= Date.now()) return
    const timer = window.setInterval(() => {
      refreshClock(n => n + 1)
      if (Date.now() >= reviewUntil) window.clearInterval(timer)
    }, 100)
    return () => window.clearInterval(timer)
  }, [reviewUntil])
  const me = state.players.find(p => p.id === socketId)
  const current = state.players[state.currentPlayerIndex]
  const isHost = state.hostId === socketId
  const mine = current?.id === socketId
  const ended = !reviewing && (state.phase === 'hand_end' || state.phase === 'game_end')
  const active = state.phase !== 'lobby' && !ended
  const available = isConnected && !pending && !reviewing
  const hand = [...(me?.hand ?? [])].sort((a, b) => ['oros', 'copas', 'espadas', 'bastos'].indexOf(a.suit) - ['oros', 'copas', 'espadas', 'bastos'].indexOf(b.suit) || (POCHA_TRICK_ORDER[b.rank] ?? 0) - (POCHA_TRICK_ORDER[a.rank] ?? 0))
  const legal = state.legalCardIds ?? (state.trump ? legalCards(hand, state.currentTrick, state.trump).map(c => c.id) : [])
  const chosen = hand.find(c => c.id === selected)
  const totalBids = Object.values(state.bids).reduce((a, b) => a + b, 0)
  const bestOffer = Math.max(-1, ...state.auction.map(a => a.value ?? -1))
  const showCompletedTrick = !!state.lastTrick && state.currentTrick.length === 0 && state.phase !== 'bidding'
  const displayedTrick = showCompletedTrick ? state.lastTrick!.cards : state.currentTrick
  const winner = showCompletedTrick ? state.lastTrick!.winnerId : state.trump ? winningCard(state.currentTrick, state.trump)?.playerId : null
  const winningPlay = displayedTrick.find(tc => tc.playerId === winner)
  const name = (id: string | null | undefined) => state.players.find(p => p.id === id)?.name ?? ''
  const phaseLabel = state.phase === 'auction' ? L('Subasta · una sola vuelta', 'Auction · one turn each')
    : state.phase === 'choosing_trump' ? L('Elegir triunfo', 'Choose trump')
    : state.phase === 'bidding' ? L('Pedir bazas', 'Predict tricks') : L('Jugar la baza', 'Play a trick')

  useEffect(() => { setSelected(null); setBid(null); setLocalError(null) }, [state.handNumber, state.phase, state.currentPlayerIndex, state.currentTrick.length])
  async function act(action: PochaAction) {
    if (!available) return
    setPending(true); setLocalError(null)
    try {
      if (onAction) { const result = await onAction(action); if (!result.ok) setLocalError(result.error ?? L('No se pudo completar la acción', 'Action failed')) }
      else if (action.type === 'bid') onBid?.(action.value)
      else if (action.type === 'play') onPlayCard?.(action.cardId)
    } finally { setPending(false) }
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(window.location.origin + '/room/' + state.roomId); setCopied(true) }
    catch { setLocalError(L('Comparte el código de sala que aparece arriba.', 'Share the room code shown above.')) }
  }
  const turnText = !isConnected ? L('Reconectando… Conservamos tu sitio.', 'Reconnecting… Your seat is saved.')
    : reviewing ? L('Baza terminada', 'Trick complete') : mine ? L('Te toca', 'Your turn') : L('Turno de ', 'Waiting for ') + current?.name

  return <div className="pocha-board">
    <GameShell backLabel={L('Salir', 'Leave')} onBack={onLeave} lang={lang} setLang={setLang}
      rightSlot={<span className="pocha-room-code">{L('Sala', 'Room')} <strong>{state.roomId}</strong></span>} />
    {(error || localError) && <p className="pocha-notice" role="alert">{localError || error}</p>}
    {state.phase === 'lobby' ? <main className="pocha-lobby">
      <header className="pocha-title"><span className="pocha-eyebrow">{L('LA MESA ESTÁ ABIERTA', 'THE TABLE IS OPEN')}</span>
        <h1>La Pocha</h1><p>{L('Pide con cabeza. Juega tus cartas.', 'Make your prediction. Play your hand.')}</p></header>
      {lobbyExtra}
      <div className="pocha-lobby-grid">
        <section className="pocha-panel">
          <h2>{L('Tu mesa', 'Your table')} <small>{state.players.length}/10</small></h2>
          <p>{L('Comparte el enlace o el código para invitar a tus amigos.', 'Share the link or room code to invite friends.')}</p>
          <button className="pocha-secondary" onClick={copyInvite}>{copied ? L('Enlace copiado', 'Link copied') : L('Copiar invitación', 'Copy invite link')}</button>
          <ol className="pocha-guests">{[...state.players].sort((a,b) => a.seatIndex-b.seatIndex).map(p => <li key={p.id}>
            <span>{p.name}{p.id === socketId ? L(' · tú', ' · you') : ''}</span>
            <small>{!p.connected ? L('Sin conexión', 'Offline') : p.id === state.hostId ? L('Admin', 'Host') : L('En la mesa', 'Joined')}</small>
          </li>)}</ol>
          <p className="pocha-muted">{L('La primera mano se elige al azar en cada partida. Después, el turno rota hacia la derecha siguiendo esta lista.', 'The opening lead is chosen at random each game. After that, the lead rotates to the right following this list.')}</p>
        </section>
        <PochaSetup key={state.roomId} state={state} isHost={isHost} available={available} lang={lang} onStart={onStart} onConfigure={onConfigure} />
      </div>
    </main> : <main className="pocha-game">
      <header className="pocha-round-header">
        <div><span className="pocha-eyebrow">LA POCHA · {state.settings.mode === 'subastada' ? L('SUBASTADA', 'AUCTION') : 'NORMAL'}</span>
          <h1>{L('Ronda', 'Round')} {state.handNumber}<span> / {state.schedule.length}</span></h1></div>
        <div className="pocha-round-meta"><strong>{state.cardsPerHand} {L(state.cardsPerHand === 1 ? 'carta por jugador' : 'cartas por jugador', state.cardsPerHand === 1 ? 'card each' : 'cards each')}</strong>
          <span>{L('Postre', 'Dealer')}: {state.players[state.dealerIndex]?.name}</span></div>
      </header>

      <div className="pocha-roster" aria-label={L('Jugadores en orden de juego', 'Players in play order')}>
        {state.players.map(p => <div key={p.id} className={'pocha-player ' + (reviewing && winner === p.id ? 'is-trick-winner ' : active && !reviewing && current?.id === p.id ? 'is-current ' : '') + (p.id === socketId ? 'is-me' : '')}>
          <div><strong title={p.name}>{p.name}{p.id === socketId ? L(' · tú', ' · you') : ''}</strong><span>{p.score} pt</span></div>
          <small>{!p.connected ? L('Sin conexión', 'Offline') : p.bid === null ? L('Por pedir', 'No prediction') : L('Bazas: ', 'Tricks: ') + p.tricksWon + ' / ' + p.bid}
            {reviewing && winner === p.id ? L(' · Ganó la baza', ' · Won the trick') : p.id === state.auctionWinnerId ? ' · ★' : ''}</small>
          {active && p.id !== socketId && (p.handCount ?? p.hand.length) > 0 && <div className="pocha-opponent-hand"><span aria-hidden="true"><SpanishCardBack width={22} height={30} /></span><small>{p.handCount ?? p.hand.length} {L('cartas', 'cards')}</small></div>}
        </div>)}
      </div>

      <div className="pocha-game-grid">
        <section className="pocha-stage">
          {ended ? <div className="pocha-result">
            <span className="pocha-eyebrow">{state.phase === 'game_end' ? L('PARTIDA TERMINADA', 'GAME OVER') : L('RONDA COMPLETADA', 'ROUND COMPLETE')}</span>
            <h2>{state.phase === 'game_end' ? state.players.filter(p => p.score === Math.max(...state.players.map(q => q.score))).map(p => p.name).join(' & ') : L('Así queda la ronda', 'Round results')}</h2>
            {state.phase === 'game_end' && <p>{L('Mayor puntuación · ', 'Top score · ')}{Math.max(...state.players.map(p => p.score))} pt</p>}
            {state.lastTrick && <p className="pocha-result-last-winner">{L('Última baza para ', 'Last trick won by ')}<strong>{name(state.lastTrick.winnerId)}</strong></p>}
            <ResultTable state={state} lang={lang} />
            {state.phase === 'game_end' && lobbyExtra}
            {isHost ? <button className="pocha-primary" disabled={!available} onClick={state.phase === 'game_end' ? onRematch : onNextRound}>
              {state.phase === 'game_end' ? L('Preparar otra partida', 'Set up another game') : L('Siguiente ronda', 'Next round') + ' · ' + state.schedule[state.handNumber] + L(' cartas', ' cards')}</button>
              : <p>{L('El administrador continuará la partida.', 'The host will continue the game.')}</p>}
          </div> : <>
            <div className={'pocha-turn ' + (mine && !reviewing ? 'is-mine' : '')} role="status" aria-live="polite">
              <strong>{turnText}</strong><span>{reviewing ? L('Mira quién se la lleva', 'See who won') : phaseLabel}</span>
            </div>
            {state.phase === 'auction' || state.phase === 'choosing_trump' ? <div className="pocha-auction">
              <span className="pocha-eyebrow">{L('EL GANADOR ELIGE TRIUNFO', 'THE WINNER CHOOSES TRUMP')}</span>
              <h2>{bestOffer < 0 ? L('Abre la subasta', 'Open the auction') : bestOffer + L(bestOffer === 1 ? ' baza' : ' bazas', bestOffer === 1 ? ' trick' : ' tricks')}</h2>
              <p>{state.auctionWinnerId ? name(state.auctionWinnerId) : L('La mano debe ofrecer una cantidad, incluso 0.', 'The first player must offer a number, including 0.')}</p>
              <div className="pocha-auction-log">{state.auction.map(a => <span key={a.playerId}>{name(a.playerId)} <b>{a.value === null ? L('pasa', 'passes') : a.value}</b></span>)}</div>
              <p className="pocha-muted">{L('Una oportunidad por jugador. Supera la oferta o pasa.', 'One opportunity each. Raise the offer or pass.')}</p>
            </div> : <div className="pocha-felt">
              <div className="pocha-table-caption"><span>{state.phase === 'bidding' ? L('Las predicciones', 'Predictions') : L('Baza', 'Trick') + ' ' + (state.players.reduce((sum,p) => sum+p.tricksWon,0) + (showCompletedTrick ? 0 : 1))}</span>
                <span>{L('Pedidas', 'Predicted')}: {totalBids} / {state.cardsPerHand}</span></div>
              <PochaTrump state={state} lang={lang} />
              {showCompletedTrick && <div className="pocha-trick-result" role="status" aria-live="polite" key={state.lastTrick!.cards[0]?.card.id}>
                <span className="pocha-eyebrow">{L('BAZA PARA', 'TRICK WON BY')}</span>
                <strong>{winner === socketId ? L('¡Tú, ', 'You, ') + name(winner) + '!' : name(winner)}</strong>
                {winningPlay && <span>{L('Gana con ', 'Wins with ') + pochaRankLong(winningPlay.card.rank) + ' de ' + POCHA_SUIT_LABEL[winningPlay.card.suit]}</span>}
                <small>{L('Lleva ', 'Won ') + state.players.find(p => p.id === winner)?.tricksWon + L(' de ', ' of ') + state.players.find(p => p.id === winner)?.bid + L(' pedidas', ' predicted')}</small>
              </div>}
              {displayedTrick.length ? <div className={'pocha-trick ' + (showCompletedTrick ? 'is-complete' : '')}>{displayedTrick.map(tc => <div key={tc.card.id} className={'pocha-played ' + (winner === tc.playerId ? 'is-winning' : '')}>
                <span>{name(tc.playerId)}</span><SpanishCard card={tc.card} isTrump={tc.card.suit === state.trump} />
                <small>{winner === tc.playerId ? showCompletedTrick ? L('Ganadora · +1 baza', 'Winner · +1 trick') : L('Va ganando', 'Winning') : ' '}</small>
              </div>)}</div> : <div className="pocha-empty-table"><span className="pocha-table-mark">P</span>
                <p>{state.phase === 'bidding' ? L('Mira tus cartas y predice tus bazas.', 'Look at your cards and predict your tricks.') : name(current?.id) + L(' abre la baza.', ' leads the trick.')}</p>
                {state.phase === 'bidding' && state.auctionWinnerId && <small>{L('Se pide desde la mano original, saltando al ganador de la subasta.', 'Predictions follow the original order, skipping the auction winner.')}</small>}
                {state.lastTrick && <small>{L('Última baza: ', 'Last trick: ')}{name(state.lastTrick.winnerId)}</small>}
              </div>}
              {reviewing && <div className="pocha-review-countdown" aria-hidden="true">{L('Continuamos en ', 'Continuing in ') + reviewSeconds + ' s'}<span key={state.lastTrick!.cards[0]?.card.id} /></div>}
              {!reviewing && showCompletedTrick && <p className="pocha-next-lead">{name(winner) + L(' abre la siguiente baza.', ' leads the next trick.')}</p>}
              {!showCompletedTrick && state.lastTrick && <p className="pocha-previous-winner">{L('Última baza para ', 'Last trick: ')}<strong>{name(state.lastTrick.winnerId)}</strong></p>}
            </div>}
          </>}
        </section>
        <aside className="pocha-sidebar">
          <details className="pocha-panel"><summary>{L('Clasificación', 'Standings')}</summary>
            {[...state.players].sort((a,b) => b.score-a.score).map(p => <div className="pocha-score-row" key={p.id}><span>{p.name}</span><strong>{p.score} pt</strong></div>)}
          </details>
          <details className="pocha-panel"><summary>{L('Recorrido', 'Round schedule')} · {state.schedule.length}</summary>
            <div className="pocha-schedule">{state.schedule.map((n,i) => <span key={i} aria-current={i+1 === state.handNumber ? 'step' : undefined}
              className={i+1 === state.handNumber ? 'current' : i+1 < state.handNumber ? 'complete' : ''}>{n}</span>)}</div>
          </details>
          {state.lastTrick && <details className="pocha-panel"><summary>{L('Última baza', 'Last trick')} · {name(state.lastTrick.winnerId)}</summary>
            <div className="pocha-last-trick">{state.lastTrick.cards.map(tc => <div key={tc.card.id}><SpanishCard card={tc.card} width={48} height={68}/><small>{name(tc.playerId)}</small></div>)}</div>
          </details>}
          <details className="pocha-panel"><summary>{L('Historial de puntos', 'Score history')}</summary>
            {!state.history.length && <p>{L('Aparecerá al terminar la primera ronda.', 'Available after the first round.')}</p>}
            {state.history.map(h => <div className="pocha-history-round" key={h.handNumber}><b>{L('Ronda ', 'Round ')}{h.handNumber} · {h.cardsPerHand} {L('cartas', 'cards')}</b>
              {h.players.map(p => <div className="pocha-score-row" key={p.id}><span>{p.name} · {p.tricksWon}/{p.bid}</span><strong>{p.points > 0 ? '+' : ''}{p.points}</strong></div>)}</div>)}
          </details>
          <PochaHelp lang={lang} settings={state.settings} />
        </aside>
      </div>
      {active && (!reviewing || hand.length > 0) && <section className="pocha-hand-area" aria-label={L('Tu mano y acciones', 'Your hand and actions')}>
        <div className="pocha-hand-label"><strong>{L('Tu mano', 'Your hand')} · {hand.length}</strong>
          <span>{me?.bid !== null && me?.bid !== undefined ? L('Llevas ', 'Won ') + me.tricksWon + L(' de ', ' of ') + me.bid + L(' pedidas', ' predicted') : L('Ordenada por palo y valor', 'Sorted by suit and strength')}</span></div>
        <div className="pocha-hand">{hand.map(c => <div key={c.id} className={'pocha-hand-card ' + (mine && state.phase === 'playing' && !legal.includes(c.id) ? 'is-illegal' : '')}>
          <SpanishCard card={c} isTrump={c.suit === state.trump} selected={selected === c.id}
            ariaLabel={pochaRankLong(c.rank) + ' de ' + POCHA_SUIT_LABEL[c.suit] + (mine && state.phase === 'playing' && !legal.includes(c.id) ? L(', no se puede jugar', ', cannot be played') : '')}
            onClick={mine && state.phase === 'playing' && available && legal.includes(c.id) ? () => setSelected(c.id === selected ? null : c.id) : undefined} />
        </div>)}</div>
        <div className="pocha-action-area">
          {reviewing ? <p className="pocha-wait">{L('Baza para ', 'Trick won by ') + name(winner) + L('. Enseguida seguimos.', '. Play resumes shortly.')}</p> : mine && (state.phase === 'bidding' || state.phase === 'auction') ? <>
            <p>{state.phase === 'auction' ? L('¿Cuántas ofreces?', 'Your offer?') : L('¿Cuántas bazas vas a ganar?', 'How many tricks will you win?')}
              {state.phase === 'bidding' && state.blockedBid != null && <small>{L('No puedes pedir ', 'You cannot predict ') + state.blockedBid + L(': el total sería igual a ', ': the total would equal ') + state.cardsPerHand + '.'}</small>}</p>
            <div className="pocha-bids" role="group" aria-label={L('Número de bazas', 'Number of tricks')}>{Array.from({length: state.cardsPerHand + 1}, (_,n) => <button key={n}
              disabled={!available || (state.phase === 'auction' ? n <= bestOffer : n === state.blockedBid)} aria-pressed={bid === n}
              title={n === state.blockedBid ? L('El total no puede cuadrar', 'Predictions cannot match the total') : undefined} onClick={() => setBid(n)}>{n}</button>)}</div>
            <div className="pocha-confirm">
              {state.phase === 'auction' && state.auction.length > 0 && <button className="pocha-secondary" disabled={!available} onClick={() => void act({type: 'auction', value: null})}>{L('Pasar', 'Pass')}</button>}
              <button className="pocha-primary" disabled={!available || bid === null} onClick={() => bid !== null && void act({type: state.phase === 'auction' ? 'auction' : 'bid', value: bid})}>
                {pending ? L('Enviando…', 'Sending…') : (state.phase === 'auction' ? L('Ofrecer', 'Offer') : L('Pedir', 'Predict')) + (bid === null ? '' : ' ' + bid + L(' bazas', ' tricks'))}</button>
            </div>
          </> : mine && state.phase === 'choosing_trump' ? <>
            <p>{L('Has ganado la subasta. Elige el palo que triunfa.', 'You won the auction. Choose the trump suit.')}</p>
            <div className="pocha-suit-choices">{(['oros','copas','espadas','bastos'] as SpanishSuit[]).map(suit => <button key={suit} disabled={!available} onClick={() => void act({type:'trump',suit})}><SpanishSuitIcon suit={suit} size={1.25}/>{POCHA_SUIT_LABEL[suit]}</button>)}</div>
          </> : mine && state.phase === 'playing' ? <div className="pocha-play-action"><p>
            {state.currentTrick.length ? L('Asiste al palo y supera si puedes. Sin ese palo, juega un triunfo que gane; si no puedes, tira lo que quieras.', 'Follow suit and beat the winner if possible. Without that suit, play a winning trump if you can; otherwise play any card.') : L('Abres la baza: puedes jugar cualquier carta.', 'You lead: play any card.')}
            <small>{L('Selecciona una carta y confirma para jugar.', 'Select a card, then confirm to play.')}</small></p>
            <button className="pocha-primary" disabled={!available || !chosen || !legal.includes(chosen.id)} onClick={() => chosen && void act({type:'play', cardId: chosen.id})}>
              {chosen ? L('Jugar ', 'Play ') + pochaRankLong(chosen.rank) + ' · ' + POCHA_SUIT_LABEL[chosen.suit] : L('Elige una carta', 'Choose a card')}</button></div>
            : <p className="pocha-wait" role="status">{turnText} · {phaseLabel}</p>}
        </div>
      </section>}
    </main>}
  </div>
}

function PochaTrump({ state, lang }: { state: PochaGameState; lang: Lang }) {
  if (!state.trump) return null
  const suitName = POCHA_SUIT_LABEL[state.trump]
  const trumpName = state.trumpCard ? `${state.trumpCard.rank} de ${suitName}` : suitName
  const auctionWinner = state.players.find(p => p.id === state.auctionWinnerId)
  return <div className="pocha-table-trump" role="group" aria-label={(lang === 'es' ? 'Triunfo de la ronda: ' : 'Round trump: ') + trumpName}>
    <div className="pocha-trump-face">{state.trumpCard ? <SpanishCard card={state.trumpCard} isTrump />
      : <div className="pocha-trump-symbol"><SpanishSuitIcon suit={state.trump} size={2.3} /></div>}</div>
    <div className="pocha-trump-heading"><span>{lang === 'es' ? 'PINTAN' : 'TRUMP'}</span><strong>{trumpName}</strong>
      <small>{auctionWinner ? (lang === 'es' ? 'Elegido por ' : 'Chosen by ') + auctionWinner.name : lang === 'es' ? 'Triunfo de esta ronda' : 'Trump for this round'}</small></div>
  </div>
}

function PochaSetup({ state, isHost, available, lang, onStart, onConfigure }: {
  state: PochaGameState; isHost: boolean; available: boolean; lang: Lang;
  onStart?: (settings: PochaSettings) => void; onConfigure?: (update: PochaLobbyUpdate) => Promise<ActionResult>
}) {
  const L = (es: string, en: string) => lang === 'es' ? es : en
  const n = Math.max(2, state.players.length)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [configError, setConfigError] = useState<string | null>(null)
  const settings = state.settings
  const { exactBidPoints, trickPoints, missPenalty } = pochaScoring(settings)
  const [scoreDraft, setScoreDraft] = useState(() => ({ exactBidPoints: String(exactBidPoints), trickPoints: String(trickPoints), missPenalty: String(missPenalty) }))
  useEffect(() => {
    setScoreDraft({ exactBidPoints: String(exactBidPoints), trickPoints: String(trickPoints), missPenalty: String(missPenalty) })
  }, [exactBidPoints, trickPoints, missPenalty])
  const scoringChanged = scoreDraft.exactBidPoints.trim() === '' || scoreDraft.trickPoints.trim() === '' || scoreDraft.missPenalty.trim() === '' ||
    Number(scoreDraft.exactBidPoints) !== exactBidPoints || Number(scoreDraft.trickPoints) !== trickPoints || Number(scoreDraft.missPenalty) !== missPenalty
  const schedule = roundSchedule(settings, n, state.deckSize)
  const auctionCount = schedule.filter(c => isPochaAuctionRound(settings, c)).length
  const canEdit = isHost && available && !saving && !!onConfigure
  async function update(change: PochaLobbyUpdate) {
    if (!canEdit || savingRef.current || !onConfigure) return
    savingRef.current = true; setSaving(true); setConfigError(null)
    try {
      const result = await onConfigure(change)
      if (!result.ok) setConfigError(result.error ?? L('No se pudieron guardar los cambios. Inténtalo de nuevo.', 'Could not save changes. Please try again.'))
    } catch { setConfigError(L('No se pudieron guardar los cambios. Inténtalo de nuevo.', 'Could not save changes. Please try again.')) }
    finally { savingRef.current = false; setSaving(false) }
  }
  return <section className="pocha-panel pocha-setup"><h2>{L('A vuestro ritmo', 'At your own pace')}</h2>
    <p>{isHost ? L('Puedes cambiar la baraja, las rondas y los puntos sin salir de la sala. Todos verán los cambios.', 'Change the deck, rounds and points without leaving the room. Everyone will see the changes.') : L('El anfitrión configura la partida. Sus cambios se muestran aquí.', 'The host sets up the game. Changes appear here for everyone.')}</p>
      <label className="pocha-deck-field">{L('Baraja', 'Deck')}
        <select value={state.deckSize} disabled={!canEdit} onChange={e => void update({ deckSize: Number(e.target.value) as PochaDeckSize })}>
          {POCHA_DECK_SIZES.map(size => <option key={size} value={size}>{t(lang, `pochaDeck${size}`)}</option>)}
        </select>
      </label>
      <fieldset disabled={!canEdit}><legend>{L('Modalidad', 'Game mode')}</legend><div className="pocha-mode-options">
        <button type="button" aria-pressed={settings.mode === 'normal'} onClick={() => void update({ settings: { mode: 'normal' } })}><strong>Normal</strong><small>{L('El triunfo lo marca una carta.', 'A card determines trump.')}</small></button>
        <button type="button" aria-pressed={settings.mode === 'subastada'} onClick={() => void update({ settings: { mode: 'subastada' } })}><strong>{L('Subastada', 'Auction')}</strong><small>{L('Se subastan las rondas del máximo, aunque sobren cartas.', 'Auction the peak rounds, even with undealt cards.')}</small></button>
      </div></fieldset>
      <fieldset disabled={!canEdit}><legend>{L('Rondas', 'Rounds')}</legend><div className="pocha-setting-fields">{([
        ['maxCards', L('Máximo de cartas', 'Maximum cards'), Math.floor(state.deckSize/n)],
        ['oneCardRounds', settings.maxCards === 1 ? L('Rondas de 1 carta', 'One-card rounds') : L('Rondas de 1 carta al inicio', 'One-card rounds at the start'), n],
        ['oneCardRoundsEnd', L('Rondas de 1 carta al final', 'One-card rounds at the end'), n],
        ['peakRounds', L('Rondas en el máximo', 'Rounds at the maximum'), n],
      ] as const).filter(([key]) => (key !== 'peakRounds' && key !== 'oneCardRoundsEnd') || settings.maxCards > 1).map(([key,label,max]) => <label key={key}>{label}
        <select value={settings[key] ?? settings.oneCardRounds} onChange={e => void update({ settings: {
          [key]: Number(e.target.value),
          // Pin the current final block when editing the start of a legacy setup.
          ...(key === 'oneCardRounds' ? { oneCardRoundsEnd: settings.oneCardRoundsEnd ?? settings.oneCardRounds } : {}),
        } })}>{Array.from({length:max},(_,i) => <option key={i+1}>{i+1}</option>)}</select>
      </label>)}</div></fieldset>
      <form className="pocha-scoring-form" onSubmit={event => {
        event.preventDefault()
        void update({ settings: { exactBidPoints: Number(scoreDraft.exactBidPoints), trickPoints: Number(scoreDraft.trickPoints), missPenalty: Number(scoreDraft.missPenalty) } })
      }}>
        <fieldset disabled={!canEdit}><legend>{L('Puntuación', 'Scoring')}</legend>
          <div className="pocha-setting-fields">{([
            ['exactBidPoints', L('Por acertar la predicción', 'For an exact prediction')],
            ['trickPoints', L('Por cada baza, si aciertas', 'Per trick, when correct')],
            ['missPenalty', L('Penalización por cada baza de diferencia', 'Penalty per trick of difference')],
          ] as const).map(([key, label]) => <label key={key}>{label}
            <span className="pocha-points-input"><span aria-hidden="true">{key === 'missPenalty' ? '−' : '+'}</span>
              <input name={key} type="number" inputMode="numeric" min="0" max="100" step="1" required value={scoreDraft[key]}
                onChange={event => setScoreDraft(previous => ({ ...previous, [key]: event.target.value }))} />
            </span>
          </label>)}</div>
          <p className="pocha-scoring-note">{L('Si fallas, solo se resta la penalización. Puedes elegir de 0 a 100 puntos en cada campo.', 'A missed prediction only subtracts the penalty. Choose from 0 to 100 points in each field.')}</p>
          {isHost && scoringChanged && <button type="submit" className="pocha-secondary">{L('Guardar puntuación', 'Save scoring')}</button>}
        </fieldset>
        {isHost && scoringChanged && <p className="pocha-scoring-unsaved" role="status">{L('Guarda la puntuación para poder empezar.', 'Save scoring before starting.')}</p>}
      </form>
      <div className="pocha-preview"><strong>{schedule.length} {L('rondas', 'rounds')} · {state.deckSize} {L('cartas en la baraja', 'cards in deck')}</strong>
        <div className="pocha-schedule">{schedule.map((c,i) => <span key={i} className={isPochaAuctionRound(settings, c) ? 'auction-round' : ''}>{c}</span>)}</div>
        <p>{settings.mode === 'subastada' ? auctionCount + L(auctionCount === 1 ? ' ronda con subasta, marcada en dorado.' : ' rondas con subasta, marcadas en dorado.', auctionCount === 1 ? ' auction round, highlighted in gold.' : ' auction rounds, highlighted in gold.') : L('Triunfo por carta levantada, o por la última repartida si no sobran cartas.', 'Trump is the turned-up card, or the last dealt card when none remain.')}</p>
        {settings.maxCards === 1 && <p>{L('Solo 1 carta: un único bloque de rondas.', 'One card only: a single block of rounds.')}</p>}
      </div>
      {saving && <p className="pocha-muted" role="status">{L('Guardando cambios…', 'Saving changes…')}</p>}
      {configError && <p className="pocha-notice" role="alert">{configError}</p>}
      {isHost && <button className="pocha-primary" disabled={!available || saving || scoringChanged || state.players.length < 2 || state.players.some(p => !p.connected)} onClick={() => onStart?.(settings)}>{state.players.length < 2 ? L('Esperando a otro jugador', 'Waiting for another player') : L('Empezar partida', 'Start game')}</button>}
    <PochaHelp lang={lang} settings={settings} />
  </section>
}
function ResultTable({ state, lang }: { state: PochaGameState; lang: Lang }) {
  const results = state.history[state.history.length - 1]?.players ?? []
  return <div className="pocha-results-scroll"><table><thead><tr>{(lang === 'es' ? ['Jugador','Pidió','Ganó','Puntos','Total'] : ['Player','Bid','Won','Points','Total']).map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{[...results].sort((a,b) => b.total-a.total).map(p => <tr key={p.id}><th scope="row">{p.name}</th><td>{p.bid}</td><td>{p.tricksWon}</td><td className={p.points < 0 ? 'negative' : 'positive'}>{p.points > 0 ? '+' : ''}{p.points}</td><td><b>{p.total}</b></td></tr>)}</tbody></table></div>
}
function PochaHelp({lang, settings}: {lang: Lang; settings: PochaSettings}) {
  const { exactBidPoints, trickPoints, missPenalty } = pochaScoring(settings)
  const penalty = missPenalty === 0 ? '0' : '−' + missPenalty
  return <details className="pocha-panel pocha-help"><summary>{lang === 'es' ? 'Reglas de esta mesa' : 'Table rules'}</summary>
    {lang === 'es' ? <><p>Acierto exacto: {exactBidPoints} + {trickPoints} por baza. Fallo: {penalty} por cada baza de diferencia, sin puntos de acierto ni de bazas. Acertar 0 da {exactBidPoints} puntos.</p><p>Asiste al palo de salida y supera la carta ganadora si puedes; si no, elige cualquier carta de ese palo. Si no tienes el palo de salida, debes jugar un triunfo que gane si tienes alguno. Si no puedes ganar con triunfo, puedes tirar cualquier carta, incluido un triunfo inferior. Quien gana sale después.</p><p>As › 3 › rey › caballo › sota › 9 › 8 › 7 › 6 › 5 › 4 › 2. La baraja de 48 está completa. La de 40 no tiene 8 ni 9; la de 36 tampoco tiene cuatros, y la de 32 tampoco tiene doses.</p><p>La primera mano se sortea al empezar cada partida. El último en pedir no puede cuadrar el total. La subasta es una sola vuelta: su ganador fija su predicción, elige triunfo y sale. Los demás piden desde la mano original, siguiendo el orden y saltando al ganador. La siguiente ronda conserva la rotación original.</p></> :
    <><p>Exact prediction: {exactBidPoints} + {trickPoints} per trick. Miss: {penalty} per trick of difference, with no exact-prediction or trick points. Predicting and winning 0 earns {exactBidPoints}.</p><p>Follow the led suit and beat the winning card if possible; otherwise choose any card of that suit. Without the led suit, you must play a winning trump if you have one. If you cannot win with trump, you may play any card, including a lower trump. The winner leads next.</p><p>Ace › 3 › king › knight › jack › 9 › 8 › 7 › 6 › 5 › 4 › 2. The 48-card deck is complete. The 40-card deck omits 8s and 9s; the 36-card deck also omits 4s, and the 32-card deck also omits 2s.</p><p>The opening lead is chosen at random each game. The last prediction cannot match the total tricks. Auctions last one turn each. The winner keeps their offer as their prediction, chooses trump, and leads. Everyone else predicts in the original order, starting with the original opening player and skipping the winner. The next round keeps the original rotation.</p></>}
  </details>
}
