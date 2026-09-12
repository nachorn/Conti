import { useEffect, useMemo, useState } from 'react'
import type { PochaAction, PochaGameState, PochaSettings, SpanishSuit } from '@shared/pochaTypes'
import { POCHA_TRICK_ORDER, POCHA_TRICK_REVIEW_MS } from '@shared/pochaTypes'
import { defaultPochaSettings, isPochaAuctionRound, legalCards, roundSchedule, winningCard } from '@shared/pochaRules'
import type { Lang } from '../i18n'
import type { ActionResult } from '../types'
import { GameShell } from './GameShell'
import { SpanishCard, POCHA_SUIT_LABEL } from './pocha'
import { SpanishSuitIcon } from './pocha/SpanishSuitIcon'
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
  onNextRound?: () => void
  onRematch?: () => void
  onBid?: (tricks: number) => void
  onPlayCard?: (cardId: string) => void
  isConnected?: boolean
  error?: string | null
}

export function PochaBoard({ state, socketId, lang, setLang, onLeave, onAction, onStart, onNextRound, onRematch,
  onBid, onPlayCard, isConnected = true, error }: PochaBoardProps) {
  const L = (es: string, en: string) => lang === 'es' ? es : en
  const [selected, setSelected] = useState<string | null>(null)
  const [bid, setBid] = useState<number | null>(null)
  const [pending, setPending] = useState(false)
  const [leaving, setLeaving] = useState(false)
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
    <GameShell backLabel={L('Salir', 'Leave')} onBack={() => setLeaving(true)} lang={lang} setLang={setLang}
      rightSlot={<span className="pocha-room-code">{L('Sala', 'Room')} <strong>{state.roomId}</strong></span>} />
    {leaving && <div className="pocha-notice" role="alert">
      <span>{L('Si abandonas, la mesa vuelve a la sala y se reinicia la partida. Para volver más tarde, cierra la pestaña sin abandonar.', 'Leaving returns everyone to the lobby and resets the game. To return later, close the tab without leaving.')}</span>
      <button onClick={() => setLeaving(false)}>{L('Seguir jugando', 'Keep playing')}</button>
      <button disabled={!available} onClick={onLeave}>{L('Abandonar partida', 'Leave game')}</button>
    </div>}
    {(error || localError) && <p className="pocha-notice" role="alert">{localError || error}</p>}
    {state.phase === 'lobby' ? <main className="pocha-lobby">
      <header className="pocha-title"><span className="pocha-eyebrow">{L('LA MESA ESTÁ ABIERTA', 'THE TABLE IS OPEN')}</span>
        <h1>La Pocha</h1><p>{L('Pide con cabeza. Juega tus cartas.', 'Make your prediction. Play your hand.')}</p></header>
      <div className="pocha-lobby-grid">
        <section className="pocha-panel">
          <h2>{L('Tu mesa', 'Your table')} <small>{state.players.length}/10</small></h2>
          <p>{L('Comparte el enlace o el código para invitar a tus amigos.', 'Share the link or room code to invite friends.')}</p>
          <button className="pocha-secondary" onClick={copyInvite}>{copied ? L('Enlace copiado', 'Link copied') : L('Copiar invitación', 'Copy invite link')}</button>
          <ol className="pocha-guests">{[...state.players].sort((a,b) => a.seatIndex-b.seatIndex).map(p => <li key={p.id}>
            <span>{p.name}{p.id === socketId ? L(' · tú', ' · you') : ''}</span>
            <small>{!p.connected ? L('Sin conexión', 'Offline') : p.id === state.hostId ? L('Admin', 'Host') : L('En la mesa', 'Joined')}</small>
          </li>)}</ol>
          <p className="pocha-muted">{L('El orden de esta lista sigue el juego hacia la derecha. La primera persona será mano.', 'This list follows play to the right. The first player leads the opening round.')}</p>
        </section>
        <PochaSetup key={state.roomId + ':' + state.deckSize} state={state} isHost={isHost} available={available} lang={lang} onStart={onStart} />
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
          <PochaHelp lang={lang} />
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
            {state.currentTrick.length ? L('Asiste al palo; si no tienes, juega triunfo. Supera si puedes.', 'Follow suit; otherwise play trump. Beat the winner if possible.') : L('Abres la baza: puedes jugar cualquier carta.', 'You lead: play any card.')}
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

function PochaSetup({ state, isHost, available, lang, onStart }: { state: PochaGameState; isHost: boolean; available: boolean; lang: Lang; onStart?: (settings: PochaSettings) => void }) {
  const L = (es: string, en: string) => lang === 'es' ? es : en
  const n = Math.max(2, state.players.length)
  const [overrides, setOverrides] = useState<Partial<PochaSettings>>({})
  const defaults = defaultPochaSettings(n, state.deckSize)
  const settings: PochaSettings = { ...defaults, ...overrides, maxCards: Math.min(overrides.maxCards ?? defaults.maxCards, Math.floor(state.deckSize / n)), oneCardRounds: Math.min(overrides.oneCardRounds ?? n, n), peakRounds: Math.min(overrides.peakRounds ?? n, n) }
  const schedule = roundSchedule(settings, n, state.deckSize)
  const auctionCount = schedule.filter(c => isPochaAuctionRound(settings, c)).length
  const update = (key: keyof PochaSettings, value: string | number) => setOverrides(s => ({ ...s, [key]: value }))
  return <section className="pocha-panel pocha-setup"><h2>{L('A vuestro ritmo', 'At your own pace')}</h2>
    <p>{isHost ? L('Tú decides la modalidad y la duración.', 'You choose the mode and length.') : L('El administrador elegirá las rondas y la modalidad antes de empezar.', 'The host chooses rounds and mode before starting.')}</p>
    {isHost && <>
      <fieldset disabled={!available}><legend>{L('Modalidad', 'Game mode')}</legend><div className="pocha-mode-options">
        <button aria-pressed={settings.mode === 'normal'} onClick={() => update('mode','normal')}><strong>Normal</strong><small>{L('El triunfo lo marca una carta.', 'A card determines trump.')}</small></button>
        <button aria-pressed={settings.mode === 'subastada'} onClick={() => update('mode','subastada')}><strong>{L('Subastada', 'Auction')}</strong><small>{L('Se subastan las rondas del máximo, aunque sobren cartas.', 'Auction the peak rounds, even with undealt cards.')}</small></button>
      </div></fieldset>
      <div className="pocha-setting-fields">{([
        ['maxCards', L('Máximo de cartas', 'Maximum cards'), Math.floor(state.deckSize/n)],
        ['oneCardRounds', settings.maxCards === 1 ? L('Rondas de 1 carta', 'One-card rounds') : L('Rondas de 1 al inicio y al final', 'One-card rounds at each end'), n],
        ['peakRounds', L('Rondas en el máximo', 'Rounds at the maximum'), n],
      ] as const).filter(([key]) => key !== 'peakRounds' || settings.maxCards > 1).map(([key,label,max]) => <label key={key}>{label}
        <select value={settings[key]} disabled={!available} onChange={e => update(key, Number(e.target.value))}>{Array.from({length:max},(_,i) => <option key={i+1}>{i+1}</option>)}</select>
      </label>)}</div>
      <div className="pocha-preview"><strong>{schedule.length} {L('rondas', 'rounds')} · {state.deckSize} {L('cartas en la baraja', 'cards in deck')}</strong>
        <div className="pocha-schedule">{schedule.map((c,i) => <span key={i} className={isPochaAuctionRound(settings, c) ? 'auction-round' : ''}>{c}</span>)}</div>
        <p>{settings.mode === 'subastada' ? auctionCount + L(auctionCount === 1 ? ' ronda con subasta, marcada en dorado.' : ' rondas con subasta, marcadas en dorado.', auctionCount === 1 ? ' auction round, highlighted in gold.' : ' auction rounds, highlighted in gold.') : L('Triunfo por carta levantada, o por la última repartida si no sobran cartas.', 'Trump is the turned-up card, or the last dealt card when none remain.')}</p>
        {settings.maxCards === 1 && <p>{L('Solo 1 carta: un único bloque de rondas.', 'One card only: a single block of rounds.')}</p>}
      </div>
      <button className="pocha-primary" disabled={!available || state.players.length < 2 || state.players.some(p => !p.connected)} onClick={() => onStart?.(settings)}>{state.players.length < 2 ? L('Esperando a otro jugador', 'Waiting for another player') : L('Empezar partida', 'Start game')}</button>
    </>}
    <PochaHelp lang={lang} />
  </section>
}
function ResultTable({ state, lang }: { state: PochaGameState; lang: Lang }) {
  const results = state.history[state.history.length - 1]?.players ?? []
  return <div className="pocha-results-scroll"><table><thead><tr>{(lang === 'es' ? ['Jugador','Pidió','Ganó','Puntos','Total'] : ['Player','Bid','Won','Points','Total']).map(h => <th key={h}>{h}</th>)}</tr></thead>
    <tbody>{[...results].sort((a,b) => b.total-a.total).map(p => <tr key={p.id}><th scope="row">{p.name}</th><td>{p.bid}</td><td>{p.tricksWon}</td><td className={p.points < 0 ? 'negative' : 'positive'}>{p.points > 0 ? '+' : ''}{p.points}</td><td><b>{p.total}</b></td></tr>)}</tbody></table></div>
}
function PochaHelp({lang}: {lang: Lang}) {
  return <details className="pocha-panel pocha-help"><summary>{lang === 'es' ? 'Reglas de esta mesa' : 'Table rules'}</summary>
    {lang === 'es' ? <><p>Acierto exacto: 5 + 2 por baza. Fallo: −2 por cada baza de diferencia. Acertar 0 da 5 puntos.</p><p>Asiste al palo de salida. Si no tienes, juega triunfo. Dentro de esa obligación, supera la carta ganadora si puedes; si no, elige cualquiera. Quien gana sale después.</p><p>As › 3 › rey › caballo › sota › 9 › 8 › 7 › 6 › 5 › 4 › 2. La baraja de 40 no tiene 8 ni 9.</p><p>El último en pedir no puede cuadrar el total. La subasta es una sola vuelta: su ganador fija su predicción, elige triunfo y sale. La siguiente ronda conserva la rotación original.</p></> :
    <><p>Exact prediction: 5 + 2 per trick. Miss: −2 per trick of difference. Predicting and winning 0 earns 5.</p><p>Follow the led suit, otherwise play trump. Beat the winning card if possible within that obligation. The winner leads next.</p><p>Ace › 3 › king › knight › jack › 9 › 8 › 7 › 6 › 5 › 4 › 2. The 40-card deck omits 8 and 9.</p><p>The last prediction cannot match the total tricks. Auctions last one turn each. The winner keeps their offer as their prediction, chooses trump, and leads. The next round keeps the original rotation.</p></>}
  </details>
}
