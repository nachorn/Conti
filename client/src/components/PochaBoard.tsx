import { useEffect, useMemo, useState } from 'react'
import type { PochaGameState, PochaPlayer } from '@shared/pochaTypes'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { GameShell } from './GameShell'
import { ReportBugButton } from './ReportBugButton'
import { SpanishCard, SpanishCardBack, POCHA_SUIT_LABEL } from './pocha'
import './PochaBoard.css'

/**
 * Place the local player at six o'clock and distribute only active players
 * around the whole table. CSS screen coordinates increase downwards, so
 * +90deg is the bottom of the ellipse.
 */
function seatPosition(displayIndex: number, playerCount: number): { x: number; y: number } {
  if (playerCount <= 1) return { x: 50, y: 88 }
  const angleDeg = 90 + displayIndex * (360 / playerCount)
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: 50 + 42 * Math.cos(rad),
    y: 50 + 42 * Math.sin(rad),
  }
}

function getPlayersAroundTable(
  players: PochaPlayer[],
  myId: string | null
): PochaPlayer[] {
  const bySeat = [...players].sort(
    (a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0)
  )
  const myIndex = myId ? bySeat.findIndex((player) => player.id === myId) : -1
  if (myIndex <= 0) return bySeat
  return [...bySeat.slice(myIndex), ...bySeat.slice(0, myIndex)]
}

export interface PochaBoardProps {
  state: PochaGameState
  socketId: string | null
  lang: Lang
  setLang: (l: Lang) => void
  onLeave: () => void
  onBid?: (tricks: number) => void
  onPlayCard?: (cardId: string) => void
}

export function PochaBoard({
  state,
  socketId,
  lang,
  setLang,
  onLeave,
  onBid,
  onPlayCard,
}: PochaBoardProps) {
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [reportCopied, setReportCopied] = useState(false)
  const me = state.players.find((p) => p.id === socketId)
  const myHand = me?.hand ?? []
  const isBidding = state.phase === 'bidding'
  const isPlaying = state.phase === 'playing'
  const isMyTurn =
    isPlaying && state.players[state.currentPlayerIndex]?.id === socketId
  const isMyBid =
    isBidding && state.players[state.currentPlayerIndex]?.id === socketId
  const currentPlayer = state.players[state.currentPlayerIndex]
  const dealer = state.players[state.dealerIndex]
  const tablePlayers = useMemo(
    () => getPlayersAroundTable(state.players, socketId),
    [state.players, socketId]
  )
  const totalTricks = state.cardsPerHand
  const blockedBid =
    me && isBidding
      ? null
      : null /* could compute dealerBidsBlocked if we had it on client */

  useEffect(() => {
    if (!isMyTurn || (selectedCardId && !myHand.some((card) => card.id === selectedCardId))) {
      setSelectedCardId(null)
    }
  }, [isMyTurn, myHand, selectedCardId])

  const handlePlay = () => {
    if (selectedCardId && onPlayCard && isMyTurn) {
      onPlayCard(selectedCardId)
      setSelectedCardId(null)
    }
  }

  return (
    <div className="pocha-board">
      <GameShell
        backLabel={t(lang, 'backToMenu')}
        onBack={onLeave}
        lang={lang}
        setLang={setLang}
        rightSlot={
          <ReportBugButton
            lang={lang}
            reportCopied={reportCopied}
            setReportCopied={setReportCopied}
            context={{ game: 'pocha', phase: state.phase, handNumber: state.handNumber, deckSize: state.deckSize, players: state.players.length }}
          />
        }
      />
      <div className="pocha-info">
        <span className="pocha-hand-info">Pocha · {t(lang, 'localPreview')}</span>
        <span className="pocha-hand-info">
          {t(lang, 'pochaHand')} {state.handNumber} · {state.cardsPerHand} {t(lang, 'cards')}
        </span>
        <span className="pocha-hand-info">{t(lang, 'pochaDeck')}: {state.deckSize}</span>
        {state.trump && (
          <span className="pocha-trump-badge">
            {t(lang, 'pochaTrump')}: {POCHA_SUIT_LABEL[state.trump]}
          </span>
        )}
        {(isBidding || isPlaying) && currentPlayer && (
          <span
            className={`pocha-turn-badge ${isMyBid || isMyTurn ? 'pocha-turn-badge-me' : ''}`}
            role="status"
            aria-live="polite"
          >
            {isMyBid
              ? t(lang, 'pochaYourBid')
              : isMyTurn
                ? t(lang, 'yourTurn')
                : `${currentPlayer.name} · ${isBidding ? (lang === 'es' ? 'apuesta' : 'bidding') : (lang === 'es' ? 'turno' : 'turn')}`}
          </span>
        )}
      </div>

      <PochaScoreboard state={state} lang={lang} />

      <div className="pocha-table-wrap">
        <div className="pocha-table-oval">
          <div className="pocha-table-center">
            {state.trumpCard && (
              <div className="pocha-trump-card">
                <SpanishCard card={state.trumpCard} isTrump />
              </div>
            )}
            <div className="pocha-current-trick">
              {state.currentTrick.map((tc) => {
                const trickPlayer = state.players.find((player) => player.id === tc.playerId)
                return (
                  <div key={tc.card.id} className="pocha-trick-card">
                    <SpanishCard card={tc.card} />
                    {trickPlayer && <span>{trickPlayer.name}</span>}
                  </div>
                )
              })}
            </div>
          </div>
          {tablePlayers.map((player, d) => {
            const pos = seatPosition(d, tablePlayers.length)
            const isMe = player.id === socketId
            const isDealer = dealer?.id === player.id
            const isCurrent = currentPlayer?.id === player.id && (isBidding || isPlaying)
            const dealerLabel = lang === 'es' ? 'Repartidor' : 'Dealer'
            const trickStatus = lang === 'es'
              ? `${player.tricksWon} bazas ganadas de ${player.bid ?? 0} apostadas`
              : `${player.tricksWon} tricks won of ${player.bid ?? 0} bid`
            return (
              <div
                key={player.id}
                className={`pocha-seat ${isMe ? 'pocha-seat-me' : ''} ${isCurrent ? 'pocha-seat-current' : ''} ${!player.connected ? 'pocha-seat-disconnected' : ''}`}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {isDealer && (
                  <span className="pocha-seat-dealer" title={dealerLabel} aria-label={dealerLabel}>
                    {lang === 'es' ? 'R' : 'D'}
                  </span>
                )}
                <span className="pocha-seat-name" title={player.name}>{player.name}</span>
                {isMe ? (
                  <span className="pocha-seat-you">{t(lang, 'you')}</span>
                ) : (
                  <SpanishCardBack width={40} height={56} count={player.hand.length} />
                )}
                {player.bid != null && (
                  <span className="pocha-seat-bid" aria-label={isPlaying ? trickStatus : undefined}>
                    {isPlaying
                      ? `${player.tricksWon}/${player.bid}`
                      : `${player.bid} ${player.bid === 1 ? t(lang, 'pochaTrick') : t(lang, 'pochaTricks')}`}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <div className="pocha-hand-area">
        <div className="pocha-hand">
          {myHand
            .slice()
            .sort(
              (a, b) =>
                a.suit.localeCompare(b.suit) || a.rank - b.rank
            )
            .map((c) => (
              <div
                key={c.id}
                className="pocha-hand-card-wrap"
                data-selected={selectedCardId === c.id}
              >
                <SpanishCard
                  card={c}
                  isTrump={state.trump === c.suit}
                  selected={selectedCardId === c.id}
                  onClick={isMyTurn && onPlayCard
                    ? () => setSelectedCardId((id) => (id === c.id ? null : c.id))
                    : undefined}
                />
              </div>
            ))}
        </div>
        <div className="pocha-actions">
          {isBidding && isMyBid && onBid && (
            <div className="pocha-bid-buttons">
              <span className="pocha-actions-label">
                {t(lang, 'pochaHowManyTricks')}
              </span>
              {Array.from({ length: totalTricks + 1 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  className="pocha-bid-btn"
                  onClick={() => onBid(n)}
                  disabled={blockedBid === n}
                  title={blockedBid === n && me ? t(lang, 'pochaDealerCantBid') : undefined}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {isPlaying && isMyTurn && onPlayCard && (
            <>
              <span className="pocha-actions-label">
                {t(lang, 'pochaPlayACard')}
              </span>
              <button
                type="button"
                className="pocha-play-btn"
                disabled={!selectedCardId}
                onClick={handlePlay}
              >
                {t(lang, 'pochaPlay')}
              </button>
            </>
          )}
        </div>
      </div>

    </div>
  )
}

function PochaScoreboard({ state, lang }: { state: PochaGameState; lang: Lang }) {
  return (
    <section className="pocha-scoreboard" aria-label={t(lang, 'scoreboard')}>
      <h3 className="pocha-scoreboard-title">{t(lang, 'scoreboard')}</h3>
      <div className="pocha-scoreboard-list">
        {state.players
          .slice()
          .sort((a, b) => b.score - a.score)
          .map((player, index) => (
            <div key={player.id} className="pocha-scoreboard-row">
              <span className="pocha-scoreboard-rank">{index + 1}.</span>
              <span className="pocha-scoreboard-name" title={player.name}>{player.name}</span>
              <span className="pocha-scoreboard-score">{player.score}</span>
            </div>
          ))}
      </div>
    </section>
  )
}
