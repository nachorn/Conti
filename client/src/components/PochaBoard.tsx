import { useState } from 'react'
import type { PochaGameState, PochaPlayer } from '@shared/pochaTypes'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { SpanishCard, SpanishCardBack, POCHA_SUIT_LABEL } from './pocha'
import './PochaBoard.css'

const SEAT_COUNT = 6

function seatPosition(displayIndex: number, radius = 48): { x: number; y: number } {
  const angleDeg = displayIndex * (360 / SEAT_COUNT) - 90
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: 50 + radius * Math.cos(rad),
    y: 50 + radius * Math.sin(rad),
  }
}

function getSeatsAroundTable(
  players: PochaPlayer[],
  myId: string | null
): (PochaPlayer | null)[] {
  const seatByPlayerId = new Map<string, number>()
  players.forEach((p) => {
    const si = p.seatIndex ?? -1
    if (si >= 0 && si < SEAT_COUNT) seatByPlayerId.set(p.id, si)
  })
  const used = new Set(seatByPlayerId.values())
  let next = 0
  players.forEach((p) => {
    if (!seatByPlayerId.has(p.id)) {
      while (used.has(next)) next++
      seatByPlayerId.set(p.id, next)
      used.add(next)
    }
  })
  const mySeat = myId ? seatByPlayerId.get(myId) ?? 0 : 0
  const seats: (PochaPlayer | null)[] = []
  for (let d = 0; d < SEAT_COUNT; d++) {
    const seatIndex = (mySeat + d) % SEAT_COUNT
    seats.push(
      players.find((p) => seatByPlayerId.get(p.id) === seatIndex) ?? null
    )
  }
  return seats
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
  const me = state.players.find((p) => p.id === socketId)
  const myHand = me?.hand ?? []
  const isBidding = state.phase === 'bidding'
  const isPlaying = state.phase === 'playing'
  const isMyTurn =
    isPlaying && state.players[state.currentPlayerIndex]?.id === socketId
  const isMyBid =
    isBidding && state.players[state.currentPlayerIndex]?.id === socketId
  const totalTricks = state.cardsPerHand
  const blockedBid =
    me && isBidding
      ? null
      : null /* could compute dealerBidsBlocked if we had it on client */

  const handlePlay = () => {
    if (selectedCardId && onPlayCard && isMyTurn) {
      onPlayCard(selectedCardId)
      setSelectedCardId(null)
    }
  }

  return (
    <div className="pocha-board">
      <div className="pocha-top-row">
        <button type="button" className="pocha-back-btn" onClick={onLeave}>
          {t(lang, 'backToMenu')}
        </button>
        <div className="pocha-lang">
          <button
            type="button"
            className={lang === 'es' ? 'active' : ''}
            onClick={() => setLang('es')}
          >
            ES
          </button>
          <button
            type="button"
            className={lang === 'en' ? 'active' : ''}
            onClick={() => setLang('en')}
          >
            EN
          </button>
        </div>
      </div>

      <div className="pocha-info">
        <span className="pocha-hand-info">
          {lang === 'es' ? 'Mano' : 'Hand'} {state.handNumber} ·{' '}
          {state.cardsPerHand}{' '}
          {lang === 'es' ? 'cartas' : 'cards'}
        </span>
        {state.trump && (
          <span className="pocha-trump-badge">
            {lang === 'es' ? 'Triunfo' : 'Trump'}: {POCHA_SUIT_LABEL[state.trump]}
          </span>
        )}
        {(isMyBid || isMyTurn) && (
          <span className="pocha-turn-badge">
            {isMyBid
              ? lang === 'es'
                ? 'Tu apuesta'
                : 'Your bid'
              : lang === 'es'
                ? 'Tu turno'
                : 'Your turn'}
          </span>
        )}
      </div>

      <div className="pocha-table-wrap">
        <div className="pocha-table-oval">
          <div className="pocha-table-center">
            {state.trumpCard && (
              <div className="pocha-trump-card">
                <SpanishCard card={state.trumpCard} isTrump />
              </div>
            )}
            <div className="pocha-current-trick">
              {state.currentTrick.map((tc) => (
                <SpanishCard key={tc.card.id} card={tc.card} />
              ))}
            </div>
          </div>
          {getSeatsAroundTable([...state.players], socketId).map((player, d) => {
            const pos = seatPosition(d)
            const isMe = player?.id === socketId
            return (
              <div
                key={d}
                className={`pocha-seat ${!player ? 'pocha-seat-empty' : ''} ${isMe ? 'pocha-seat-me' : ''}`}
                style={{
                  left: `${pos.x}%`,
                  top: `${pos.y}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                {player ? (
                  <>
                    <span className="pocha-seat-name">{player.name}</span>
                    {isMe ? (
                      <span className="pocha-seat-you">{t(lang, 'you')}</span>
                    ) : (
                      <SpanishCardBack width={44} height={62} count={player.hand.length} />
                    )}
                    {player.bid != null && (
                      <span className="pocha-seat-bid">
                        {player.bid} {lang === 'es' ? 'baza' : 'trick'}
                        {player.bid !== 1 ? 's' : ''}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="pocha-seat-empty-label" />
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
                  onClick={() =>
                    isPlaying
                      ? setSelectedCardId((id) => (id === c.id ? null : c.id))
                      : undefined
                  }
                />
              </div>
            ))}
        </div>
        <div className="pocha-actions">
          {isBidding && isMyBid && onBid && (
            <div className="pocha-bid-buttons">
              <span className="pocha-actions-label">
                {lang === 'es' ? '¿Cuántas bazas?' : 'How many tricks?'}
              </span>
              {Array.from({ length: totalTricks + 1 }, (_, n) => (
                <button
                  key={n}
                  type="button"
                  className="pocha-bid-btn"
                  onClick={() => onBid(n)}
                  disabled={blockedBid === n}
                  title={
                    blockedBid === n && me
                      ? lang === 'es'
                        ? 'El repartidor no puede apostar este número'
                        : "Dealer can't bid this number"
                      : undefined
                  }
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {isPlaying && isMyTurn && onPlayCard && (
            <>
              <span className="pocha-actions-label">
                {lang === 'es' ? 'Juega una carta' : 'Play a card'}
              </span>
              <button
                type="button"
                className="pocha-play-btn"
                disabled={!selectedCardId}
                onClick={handlePlay}
              >
                {lang === 'es' ? 'Jugar' : 'Play'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="pocha-scoreboard">
        <h3 className="pocha-scoreboard-title">{t(lang, 'scoreboard')}</h3>
        <div className="pocha-scoreboard-list">
          {state.players
            .slice()
            .sort((a, b) => b.score - a.score)
            .map((p, i) => (
              <div key={p.id} className="pocha-scoreboard-row">
                <span className="pocha-scoreboard-rank">{i + 1}.</span>
                <span className="pocha-scoreboard-name">{p.name}</span>
                <span className="pocha-scoreboard-score">{p.score}</span>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
