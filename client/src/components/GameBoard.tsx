import { useState, useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import type { Card as CardType, GameState, Meld, Player } from '../types'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { Card } from './Card'
import { ReportBugButton } from './ReportBugButton'
import { CardBack } from './cards/CardBack'
import { rankLabel, SUIT_SYMBOL } from './cards'
import { findMeldsForContract } from '../lib/meld'
import { GameShell } from './GameShell'
import './GameBoard.css'

/** Short label for a card (e.g. "7♥") for toasts. */
function cardLabel(c: CardType): string {
  if (c.suit === 'joker' || c.rank === 0) return 'Joker'
  return rankLabel(c.rank) + SUIT_SYMBOL[c.suit]
}

const CARDS_ROUND_1 = 7
const POKER_SEAT_COUNT = 10

/** Seat positions around an oval, with display index 0 anchored at the bottom. */
function seatPosition(displayIndex: number, radius = 48, seatCount = POKER_SEAT_COUNT): { x: number; y: number } {
  const slots = Math.max(1, seatCount)
  const angleDeg = displayIndex * (360 / slots) + 90
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: 50 + radius * Math.cos(rad),
    y: 50 + radius * Math.sin(rad),
  }
}

/** Keep table order, but remove unused seats once play starts so active players spread evenly. */
function getActivePlayersAroundTable(players: Player[], myId: string | null): Player[] {
  return getSeatsAroundTable(players, myId).filter((player): player is Player => player !== null)
}

/** Build 10 slots with me at position 0 (bottom). Resolves seatIndex without mutating. */
function getSeatsAroundTable(players: Player[], myId: string | null): (Player | null)[] {
  const seatByPlayerId = new Map<string, number>()
  players.forEach((p) => {
    const si = p.seatIndex ?? -1
    if (si >= 0 && si < POKER_SEAT_COUNT) seatByPlayerId.set(p.id, si)
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
  const mySeat = myId ? (seatByPlayerId.get(myId) ?? 0) : 0
  const seats: (Player | null)[] = []
  for (let d = 0; d < POKER_SEAT_COUNT; d++) {
    const seatIndex = (mySeat + d) % POKER_SEAT_COUNT
    seats.push(players.find((p) => seatByPlayerId.get(p.id) === seatIndex) ?? null)
  }
  return seats
}

function cardsPerPlayerForRound(round: number): number {
  return CARDS_ROUND_1 + round - 1
}

/** Sort hand by custom order (card IDs); cards not in order go at the end. */
function sortHandByOrder(hand: CardType[], order: string[]): CardType[] {
  const byId = new Map(hand.map((c) => [c.id, c]))
  const result: CardType[] = []
  const seen = new Set<string>()
  for (const id of order) {
    const c = byId.get(id)
    if (c && !seen.has(id)) {
      result.push(c)
      seen.add(id)
    }
  }
  for (const c of hand) {
    if (!seen.has(c.id)) result.push(c)
  }
  return result
}

interface GameBoardProps {
  state: GameState
  socketId: string | null
  lang: Lang
  setLang: (lang: Lang) => void
  error?: string | null
  onStart: (opts?: { deckCount?: 2 | 3; discardOptionDelaySeconds?: number; secondsPerTurn?: number }) => void
  onDraw: (fromDiscard: boolean) => void
  onPlayMelds: (melds: { type: 'trio' | 'straight'; cards: CardType[] }[]) => void
  onAddToMeld: (meldId: string, cards: CardType[]) => void
  onSwapJoker: (meldId: string, cardId: string) => void
  onDiscard: (cardId: string) => void
  onTakeDiscard: () => void
  onPassDiscard: () => void
  onLeave: () => void
  onNextRound: () => void
  onDebugSkipRound?: () => void
  onSetSeat?: (seatIndex: number) => void
}

export function GameBoard({
  state,
  socketId,
  lang,
  setLang,
  error: serverError,
  onStart,
  onDraw,
  onPlayMelds,
  onAddToMeld,
  onSwapJoker,
  onDiscard,
  onTakeDiscard,
  onPassDiscard,
  onLeave,
  onNextRound,
  onDebugSkipRound,
  onSetSeat,
}: GameBoardProps) {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set())
  const [selectedMeldId, setSelectedMeldId] = useState<string | null>(null)
  const [handOrder, setHandOrder] = useState<string[]>([])
  const [lobbyDeckCount, setLobbyDeckCount] = useState<2 | 3>(state.deckCount ?? 2)
  const [lobbyDiscardDelay, setLobbyDiscardDelay] = useState(state.discardOptionDelaySeconds ?? 10)
  const [lobbyTurnSecs, setLobbyTurnSecs] = useState(state.secondsPerTurn ?? 0)
  const [dealAnimKey, setDealAnimKey] = useState<number | null>(null)
  const [shuffleActive, setShuffleActive] = useState(false)
  const [dealingPhase, setDealingPhase] = useState(false)
  const [dealingIndex, setDealingIndex] = useState(0)
  const [justDrawnIds, setJustDrawnIds] = useState<Set<string>>(new Set())
  const [expandedMeldIds, setExpandedMeldIds] = useState<Set<string>>(new Set())
  const [reportCopied, setReportCopied] = useState(false)
  const [roomLinkCopied, setRoomLinkCopied] = useState(false)
  const [animationsOn, setAnimationsOn] = useState(true)
  const [jokerToast, setJokerToast] = useState<string | null>(null)
  const jokerToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevPhaseRef = useRef<string>(state.phase)
  const prevRoundRef = useRef(state.round)
  const prevHandIdsRef = useRef<string[]>([])
  useEffect(() => () => { if (jokerToastTimerRef.current) clearTimeout(jokerToastTimerRef.current) }, [])
  const me = state.players.find((p) => p.id === socketId)
  const myIndex = me ? state.players.findIndex((p) => p.id === socketId) : -1
  const discardOptionIndex = state.discardOptionPlayerIndex ?? null
  const turnPlayerIndex = discardOptionIndex !== null ? discardOptionIndex : state.currentPlayerIndex
  const turnPlayer = state.players[turnPlayerIndex]
  const isMyTurn = turnPlayer?.id === socketId
  const isHost = state.players[0]?.id === socketId
  const isMyDiscardOption = discardOptionIndex !== null && state.players[discardOptionIndex]?.id === socketId

  const rawHand = me?.hand ?? []
  const myHand = sortHandByOrder(rawHand, handOrder)
  const n = state.players.length
  const discarderIndex = state.discarderIndex ?? null
  const hasPriority =
    isMyDiscardOption &&
    discarderIndex !== null &&
    (discarderIndex + 1) % n === discardOptionIndex
  const handIdsKey = rawHand.map((c) => c.id).sort().join(',')
  useEffect(() => {
    const ids = rawHand.map((c) => c.id)
    setHandOrder((prev) => {
      const kept = prev.filter((id) => ids.includes(id))
      const added = ids.filter((id) => !prev.includes(id))
      return [...kept, ...added]
    })
  }, [state.round, handIdsKey])
  const cardsThisRound = cardsPerPlayerForRound(state.round)
  const currentPlayerHasDrawn = state.currentPlayerHasDrawn ?? (myHand.length !== cardsThisRound)
  const needToDraw = state.currentPlayerHasDrawn != null ? !state.currentPlayerHasDrawn : (myHand.length === cardsThisRound)
  const canDraw = state.phase === 'playing' && discardOptionIndex === null && state.currentPlayerIndex === myIndex && needToDraw
  const everyoneHadTurn = (state.hasHadTurn?.length === n && state.hasHadTurn.every(Boolean)) ?? false
  const canDiscard =
    state.phase === 'playing' &&
    discardOptionIndex === null &&
    state.currentPlayerIndex === myIndex &&
    currentPlayerHasDrawn &&
    myHand.length >= 1
  const canPlayMeld = canDiscard && everyoneHadTurn

  const hasPlayedMelds = state.melds.some((m) => m.ownerId === socketId)

  const discardOptionAvailableAt = state.discardOptionAvailableAt ?? null
  const turnDeadline = state.turnDeadline ?? null
  const [clockNow, setClockNow] = useState(Date.now())
  useEffect(() => {
    if (discardOptionAvailableAt === null && turnDeadline === null) return
    setClockNow(Date.now())
    const timer = setInterval(() => setClockNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [discardOptionAvailableAt, turnDeadline])
  const now = clockNow
  const discardDelayRemaining = discardOptionAvailableAt != null && now < discardOptionAvailableAt
    ? Math.ceil((discardOptionAvailableAt - now) / 1000)
    : 0
  const canTakeOrPass = isMyDiscardOption && !discardDelayRemaining

  const secondsPerTurn = state.secondsPerTurn ?? 0
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null)
  useEffect(() => {
    if (!isMyTurn) {
      setTurnSecondsLeft(null)
      return
    }
    if (state.phase !== 'playing' || secondsPerTurn <= 0 || turnDeadline === null) {
      setTurnSecondsLeft(null)
      return
    }
    const updateCountdown = () => {
      const left = Math.ceil((turnDeadline - Date.now()) / 1000)
      setTurnSecondsLeft(left <= 0 ? 0 : left)
    }
    updateCountdown()
    const t = setInterval(updateCountdown, 500)
    return () => clearInterval(t)
  }, [state.phase, isMyTurn, secondsPerTurn, turnDeadline])


  // Show a short sample deal, regardless of the number of cards in the round.
  const totalToDeal = n * cardsThisRound
  const animatedDealCount = Math.min(totalToDeal, n * 2)
  const dealCardDurationMs = Math.min(160, 1600 / Math.max(1, animatedDealCount))

  useEffect(() => {
    const prevPhase = prevPhaseRef.current
    const prevRound = prevRoundRef.current
    prevPhaseRef.current = state.phase
    prevRoundRef.current = state.round
    const roundJustStarted = prevPhase !== 'playing' || prevRound !== state.round
    // Cancellation must clear the visual state too: CSS animation events may
    // never fire when animations are disabled or the page changes phase.
    setShuffleActive(false)
    setDealingPhase(false)
    setDealingIndex(0)
    setDealAnimKey(null)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (state.phase !== 'playing' || !animationsOn || reduceMotion || !roundJustStarted) return

    let dealTimer: ReturnType<typeof setInterval> | undefined
    let handTimer: ReturnType<typeof setTimeout> | undefined
    const finishDeal = () => {
      if (dealTimer) clearInterval(dealTimer)
      setDealingPhase(false)
      setDealAnimKey(Date.now())
      handTimer = setTimeout(() => setDealAnimKey(null), 1200)
    }

    setShuffleActive(true)
    const shuffleTimer = setTimeout(() => {
      setShuffleActive(false)
      if (animatedDealCount === 0) {
        finishDeal()
        return
      }
      const startedAt = Date.now()
      setDealingPhase(true)
      dealTimer = setInterval(() => {
        const next = Math.floor((Date.now() - startedAt) / dealCardDurationMs)
        if (next >= animatedDealCount) finishDeal()
        else setDealingIndex(next)
      }, dealCardDurationMs)
    }, 450)
    return () => {
      clearTimeout(shuffleTimer)
      if (dealTimer) clearInterval(dealTimer)
      if (handTimer) clearTimeout(handTimer)
    }
  }, [state.phase, state.round, animatedDealCount, dealCardDurationMs, animationsOn])

  // "Just drawn" animation when hand gains a new card
  useEffect(() => {
    const ids = rawHand.map((c) => c.id)
    const prev = prevHandIdsRef.current
    prevHandIdsRef.current = ids
    if (prev.length === 0 || ids.length <= prev.length) return
    const newIds = ids.filter((id) => !prev.includes(id))
    if (newIds.length === 0) return
    setJustDrawnIds(new Set(newIds))
    const t = setTimeout(() => setJustDrawnIds(new Set()), 700)
    return () => clearTimeout(t)
  }, [handIdsKey, rawHand.length])

  const toggleCard = (id: string) => {
    if (!canDiscard && !canDraw) return
    setSelectedCards((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDrawStock = () => {
    if (!canDraw) return
    onDraw(false)
  }

  const handleDrawDiscard = () => {
    if (!canDraw || !state.topDiscard) return
    onDraw(true)
  }

  const handlePlayMelds = () => {
    if (!canPlayMeld || selectedCards.size < 3) return
    const cards = myHand.filter((c) => selectedCards.has(c.id))
    if (cards.length < state.contract.minCards) return
    const melds = findMeldsForContract(cards, state.contract)
    if (melds && melds.length > 0) {
      onPlayMelds(melds)
      setSelectedCards(new Set())
    }
  }

  const handleAddToMeld = () => {
    if (!canDiscard || !selectedMeldId || selectedCards.size === 0) return
    const cards = myHand.filter((c) => selectedCards.has(c.id))
    if (cards.length === 0) return
    onAddToMeld(selectedMeldId, cards)
    setSelectedCards(new Set())
    setSelectedMeldId(null)
  }

  const handleDiscardSelected = () => {
    if (!canDiscard || selectedCards.size !== 1) return
    const [cardId] = selectedCards
    if (!cardId) return
    onDiscard(cardId)
    setSelectedCards(new Set())
  }

  if (state.phase === 'lobby') {
    const lobbySeats = getSeatsAroundTable([...state.players], socketId)
    return (
      <div className="game-board game-lobby">
        <GameShell
          backLabel={t(lang, 'backToMenu')}
          onBack={onLeave}
          lang={lang}
          setLang={setLang}
          error={serverError}
          rightSlot={
            <ReportBugButton
              lang={lang}
              reportCopied={reportCopied}
              setReportCopied={setReportCopied}
              context={{ roomId: state.roomId, phase: state.phase, players: state.players.length }}
            />
          }
        />
        <div className="game-lobby-header">
          <h2>{t(lang, 'room')} {state.roomId}</h2>
          <p className="game-lobby-sub">{t(lang, 'chooseSeat')} · {state.players.length}/10 {t(lang, 'players')}</p>
          <button
            type="button"
            className="game-copy-room-link-btn"
            onClick={() => {
              const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/room/${state.roomId}`
              navigator.clipboard?.writeText(url).then(() => {
                setRoomLinkCopied(true)
                setTimeout(() => setRoomLinkCopied(false), 2000)
              })
            }}
          >
            {roomLinkCopied ? t(lang, 'roomLinkCopied') : t(lang, 'copyRoomLink')}
          </button>
        </div>
        <div className="poker-table-wrap poker-table-lobby">
          <div className="poker-table-oval" />
          {lobbySeats.map((player, d) => {
            const pos = seatPosition(d)
            const seatIndex = ((me?.seatIndex ?? 0) + d) % POKER_SEAT_COUNT
            const isMe = player?.id === socketId
            const isEmpty = !player
            return (
              <div
                key={d}
                className={`poker-seat ${isEmpty ? 'poker-seat-empty' : ''} ${isMe ? 'poker-seat-me' : ''}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
                onClick={() => {
                  if (isEmpty && onSetSeat) onSetSeat(seatIndex)
                }}
                role={isEmpty && onSetSeat ? 'button' : undefined}
                tabIndex={isEmpty && onSetSeat ? 0 : undefined}
                aria-label={isEmpty ? `${t(lang, 'sitHere')} ${seatIndex + 1}` : undefined}
                onKeyDown={(event) => {
                  if (isEmpty && onSetSeat && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    onSetSeat(seatIndex)
                  }
                }}
              >
                {player ? (
                <>
                  <span className="poker-seat-name">{player.name}</span>
                  {isMe && <span className="poker-seat-you">{t(lang, 'you')}</span>}
                </>
              ) : (
                <span className="poker-seat-sit">{t(lang, 'sitHere')}</span>
              )}
              </div>
            )
          })}
        </div>
        <div className="game-lobby-box game-lobby-options">
          {isHost && (
            <>
              <label className="lobby-deck-label">
                {t(lang, 'decks')}
                <select value={lobbyDeckCount} onChange={(e) => setLobbyDeckCount(Number(e.target.value) as 2 | 3)}>
                  <option value={2}>2 {t(lang, 'decks').toLowerCase()}</option>
                  <option value={3}>3 {t(lang, 'decks').toLowerCase()}</option>
                </select>
              </label>
              <label className="lobby-deck-label">
                {t(lang, 'discardDelay')}
                <select value={lobbyDiscardDelay} onChange={(e) => setLobbyDiscardDelay(Number(e.target.value))}>
                  <option value={0}>0</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                </select>
              </label>
              <label className="lobby-deck-label">
                {t(lang, 'turnTime')}
                <select value={lobbyTurnSecs} onChange={(e) => setLobbyTurnSecs(Number(e.target.value))}>
                  <option value={0}>{t(lang, 'noLimit')}</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                  <option value={90}>90</option>
                </select>
              </label>
              <button
                onClick={() =>
                  onStart({
                    deckCount: lobbyDeckCount,
                    discardOptionDelaySeconds: lobbyDiscardDelay,
                    secondsPerTurn: lobbyTurnSecs,
                  })
                }
                disabled={state.players.length < 2}
              >
                {t(lang, 'startGame')} ({state.players.length} {t(lang, 'players')})
              </button>
            </>
          )}
          {(!isHost || state.players.length < 2) && (
            <p className="game-wait-host-msg" role="status">
              {t(lang, isHost ? 'waitingForPlayers' : 'waitingForGameStart')}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (state.phase === 'round_end') {
    return (
      <div className="game-board game-round-end">
        <GameShell
          backLabel={t(lang, 'backToMenu')}
          onBack={onLeave}
          lang={lang}
          setLang={setLang}
          error={serverError}
          rightSlot={
            <>
              <ReportBugButton
                lang={lang}
                reportCopied={reportCopied}
                setReportCopied={setReportCopied}
                context={{ roomId: state.roomId, phase: state.phase, round: state.round }}
              />
              <Scoreboard state={state} lang={lang} />
            </>
          }
        />
        <div className="game-round-end-box">
          <h2>{t(lang, 'round')} {state.round} {t(lang, 'roundOver')}</h2>
          <p>{t(lang, 'thisRound')}</p>
          <ul>
            {state.players.map((p) => (
              <li key={p.id}>
                {p.name}: {state.roundScores[p.id] ?? 0} {t(lang, 'points')}
              </li>
            ))}
          </ul>
          {state.round < 7 && isHost && (
            <button className="game-next-round-btn" onClick={onNextRound}>{t(lang, 'nextRound')}</button>
          )}
          {state.round < 7 && !isHost && (
            <p className="game-wait-host-msg">{t(lang, 'waitingForHost')}</p>
          )}
          {state.round >= 7 && <p className="game-over-msg">{t(lang, 'gameOverLowest')}</p>}
        </div>
      </div>
    )
  }

  if (state.phase === 'game_end') {
    const winner = state.players.reduce((a, b) => (a.score <= b.score ? a : b))
    return (
      <div className="game-board game-round-end">
        <GameShell
          backLabel={t(lang, 'backToMenu')}
          onBack={onLeave}
          lang={lang}
          setLang={setLang}
          error={serverError}
          rightSlot={
            <>
              <ReportBugButton
                lang={lang}
                reportCopied={reportCopied}
                setReportCopied={setReportCopied}
                context={{ roomId: state.roomId, phase: state.phase }}
              />
              <Scoreboard state={state} lang={lang} />
            </>
          }
        />
        <div className="game-round-end-box">
          <h2>{t(lang, 'gameOver')}</h2>
          <p>{t(lang, 'winner')}: {winner.name} {t(lang, 'with')} {winner.score} {t(lang, 'points')}</p>
          <ul>
            {state.players.map((p) => (
              <li key={p.id}>{p.name}: {p.score} {t(lang, 'points')}</li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  const isDealingActive = dealingPhase && dealingIndex < animatedDealCount
  const playingSeats = getActivePlayersAroundTable([...state.players], socketId)
  const playingSeatCount = playingSeats.length

  return (
    <div className={`game-board game-board-playing ${isDealingActive ? 'dealing-cards' : ''} ${!animationsOn ? 'animations-off' : ''}`}>
      <GameShell
        title="Continental"
        backLabel={t(lang, 'backToMenu')}
        onBack={onLeave}
        hideBack
        lang={lang}
        setLang={setLang}
        hideLang
        error={serverError}
        toast={jokerToast}
        toastSuccess
        rightSlot={
          <>
            <OptionsMenu
              lang={lang}
              animationsOn={animationsOn}
              toggleAnimations={() => setAnimationsOn((v) => !v)}
              onBack={onLeave}
              onDebugSkipRound={state.phase === 'playing' ? onDebugSkipRound : undefined}
              setLang={setLang}
            />
            <Scoreboard state={state} lang={lang} />
          </>
        }
      />
      <div className="game-info">
        <div className="game-info-main">
          <span className="game-meta-pill">{t(lang, 'room')} {state.roomId}</span>
          <span className="game-meta-pill">{t(lang, 'round')} {state.round}</span>
          <span className="game-contract-text">
            <strong>{t(lang, 'contract')}:</strong>{' '}
            {state.contract.requirements.map((r) => `${r.minLength}+ ${r.type === 'trio' ? t(lang, 'trioNum') : t(lang, 'straightNum')}`).join(', ')}
          </span>
        </div>
        <div className="game-turn-status" role="status" aria-live="polite">
          {turnPlayer && (
            <span className={`turn-badge ${isMyTurn ? 'turn-badge-you' : ''}`}>
              {isMyTurn ? t(lang, 'yourTurn') : `${turnPlayer.name}${t(lang, 'turn')}`}
            </span>
          )}
          {turnSecondsLeft != null && secondsPerTurn > 0 && (
            <span className="turn-timer">{turnSecondsLeft}{t(lang, 's')}</span>
          )}
          {isMyDiscardOption && discardDelayRemaining > 0 && (
            <span className="turn-badge discard-delay-badge">{t(lang, 'takePassIn')} {discardDelayRemaining}{t(lang, 's')}</span>
          )}
          {hasPriority && canTakeOrPass && (
            <span className="turn-badge priority-badge">{t(lang, 'youHavePriority')}</span>
          )}
          {state.swappedJokerPlayerId === socketId && state.swappedJokerCardId && (
            <span className="turn-badge discard-delay-badge">{t(lang, 'playJokerFirst')}</span>
          )}
        </div>
      </div>

      <div className={`poker-table-wrap poker-table-playing ${shuffleActive ? 'table-shuffle-active' : ''} ${dealingPhase ? 'dealing-cards' : ''}`}>
        {shuffleActive && (
          <div className="deal-overlay" aria-hidden>
            <span className="deal-overlay-text">
              {t(lang, 'shuffling')}… {t(lang, 'round')} {state.round}
            </span>
          </div>
        )}
        {dealingPhase && dealingIndex < animatedDealCount && (() => {
          const playerIndexToDisplayIndex: number[] = []
          for (let pi = 0; pi < n; pi++) {
            const player = state.players[pi]
            const d = player ? playingSeats.findIndex((p) => p.id === player.id) : -1
            playerIndexToDisplayIndex[pi] = d >= 0 ? d : 0
          }
          const firstTurnIndex = state.firstTurnIndex ?? state.dealerIndex ?? 0
          const targetPlayerIndex = (firstTurnIndex + dealingIndex) % n
          const displayIndex = playerIndexToDisplayIndex[targetPlayerIndex] ?? 0
          const pos = seatPosition(displayIndex, 40, playingSeatCount)
          return (
            <div
              key={dealingIndex}
              className="flying-deal-card"
              style={{ '--end-x': pos.x, '--end-y': pos.y, animationDuration: `${dealCardDurationMs}ms` } as React.CSSProperties}
            >
              <CardBack width={72} height={100} />
            </div>
          )
        })()}
        <div className="poker-table-oval">
          <div className="game-table-center">
            {canDiscard && (
              <button
                type="button"
                className="game-discard-zone"
                aria-label={t(lang, 'dropToDiscard')}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={(e) => {
                  e.preventDefault()
                  const cardId = e.dataTransfer.getData('cardId')
                  if (cardId) {
                    onDiscard(cardId)
                    setSelectedCards(new Set())
                  }
                }}
                onClick={handleDiscardSelected}
              >
                <span className="discard-zone-label">{t(lang, 'dropToDiscard')}</span>
              </button>
            )}
            <div className="game-piles">
              <button
                type="button"
                className={`game-stock ${shuffleActive ? 'shuffle-animate' : ''}`}
                onClick={handleDrawStock}
                disabled={!canDraw}
                aria-label={`${t(lang, 'drawFromStock')}: ${state.stockCount}`}
              >
                <Card card={{ id: '', suit: 'joker', rank: 0 }} faceDown size="normal" />
                <span className="stock-count">{state.stockCount}</span>
              </button>
              <button
                type="button"
                className={`game-discard ${state.topDiscard ? 'discard-has-card' : ''}`}
                onClick={handleDrawDiscard}
                disabled={!canDraw || !state.topDiscard}
                aria-label={t(lang, 'drawDiscard')}
                data-clickable={canDraw && !!state.topDiscard}
              >
                {state.topDiscard ? (
                  <div key={state.topDiscard.id} className="discard-card-wrap">
                    <Card card={state.topDiscard} size="normal" />
                  </div>
                ) : (
                  <div className="discard-placeholder" />
                )}
              </button>
            </div>
          </div>
        </div>
        {/* Meld zones: one per seat, in front of each player (inner radius) */}
        {playingSeats.map((player, d) => {
          const meldsForSeat = state.melds.filter((m) => m.ownerId === player.id)
          const pos = seatPosition(d, 27, playingSeatCount)
          let trioNum = 0
          let straightNum = 0
          return (
            <div
              key={`meld-${d}`}
              className="poker-seat-melds"
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              {meldsForSeat.map((meld) => {
                const isTrio = meld.type === 'trio'
                const labelNum = isTrio ? ++trioNum : ++straightNum
                const showLabel = isTrio
                  ? `${t(lang, 'trioNum')} #${labelNum}`
                  : `${t(lang, 'straightNum')} #${labelNum}`
                const expanded = expandedMeldIds.has(meld.id)
                const meldHasJoker = meld.cards.some((c) => c.suit === 'joker')
                const oneCardSelected = selectedCards.size === 1
                const canAddOrSwap = canDiscard && hasPlayedMelds && selectedCards.size > 0
                const canSwap = canAddOrSwap && oneCardSelected && meldHasJoker
                return (
                  <div
                    key={meld.id}
                    className={`meld-row-wrap ${canAddOrSwap ? 'meld-row-can-add' : ''} ${selectedMeldId === meld.id ? 'meld-row-selected' : ''} ${canSwap ? 'meld-row-can-swap' : ''} ${expanded ? 'meld-row-expanded' : 'meld-row-collapsed'}`}
                    onClick={(e) => {
                      if (!expanded && (e.target as HTMLElement).closest('.meld-show-btn')) {
                        setExpandedMeldIds((prev) => new Set(prev).add(meld.id))
                        return
                      }
                      if (expanded && (e.target as HTMLElement).closest('.meld-hide-btn')) {
                        setExpandedMeldIds((prev) => {
                          const next = new Set(prev)
                          next.delete(meld.id)
                          return next
                        })
                        return
                      }
                      if (!canAddOrSwap || selectedCards.size === 0) return
                      if (oneCardSelected && meldHasJoker) {
                        const [cardId] = Array.from(selectedCards)
                        if (cardId) {
                          const card = myHand.find((c) => c.id === cardId)
                          onSwapJoker(meld.id, cardId)
                          setSelectedCards(new Set())
                          if (card) {
                            setJokerToast(`${t(lang, 'jokerReplacedWith')} ${cardLabel(card)}`)
                            if (jokerToastTimerRef.current) clearTimeout(jokerToastTimerRef.current)
                            jokerToastTimerRef.current = setTimeout(() => {
                              setJokerToast(null)
                              jokerToastTimerRef.current = null
                            }, 3000)
                          }
                        }
                      } else {
                        setSelectedMeldId((id) => (id === meld.id ? null : meld.id))
                      }
                    }}
                    title={canSwap ? t(lang, 'swapJokerWith') : undefined}
                  >
                    {expanded ? (
                      <>
                        <div className="meld-row-header">
                          {canAddOrSwap ? (
                            <button
                              type="button"
                              className="meld-row-title meld-select-btn"
                              aria-label={`${t(lang, canSwap ? 'swapJoker' : 'selectMeld')}: ${showLabel}`}
                              aria-pressed={canSwap ? undefined : selectedMeldId === meld.id}
                            >
                              {showLabel}
                            </button>
                          ) : <span className="meld-row-title">{showLabel}</span>}
                          <button type="button" className="meld-hide-btn" onClick={(e) => { e.stopPropagation(); setExpandedMeldIds((prev) => { const n = new Set(prev); n.delete(meld.id); return n }); }} aria-label={t(lang, 'hide')}>
                            {t(lang, 'hide')}
                          </button>
                        </div>
                        <MeldRow meld={meld} />
                      </>
                    ) : (
                      <button type="button" className="meld-show-btn">
                        {showLabel}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}
        {playingSeats.map((player, d) => {
          const pos = seatPosition(d, 40, playingSeatCount)
          const isMe = player.id === socketId
          return (
            <div
              key={player.id}
              className={`poker-seat poker-seat-playing ${isMe ? 'poker-seat-me' : ''} ${player.id === turnPlayer?.id ? 'poker-seat-current' : ''}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              <span className="poker-seat-name" title={player.name}>{player.name}</span>
              {isMe ? (
                <span className="poker-seat-you">{t(lang, 'you')}</span>
              ) : (
                <div className="opponent-cards opponent-cards-single">
                  <span className="opponent-cards-label" aria-label={`${player.hand.length} ${t(lang, 'cards')}`}>
                    <span className="opponent-card-count">{player.hand.length}</span>{' '}
                    <span className="opponent-cards-word">{t(lang, 'cards')}</span>
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="game-hand-area">
        <div className="game-hand" aria-label={`${myHand.length} ${t(lang, 'cards')}`}>
          {myHand.map((c, i) => (
            <div
              key={c.id}
              className={`game-hand-card-wrap ${dealAnimKey != null ? 'deal-in' : ''} ${justDrawnIds.has(c.id) ? 'card-just-drawn' : ''}`}
              style={dealAnimKey != null ? { animationDelay: `${i * (totalToDeal > 20 ? 30 : 55)}ms` } : undefined}
              data-card-id={c.id}
              onDragOver={(e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                e.currentTarget.classList.add('drop-target')
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove('drop-target')}
              onDrop={(e) => {
                e.preventDefault()
                e.currentTarget.classList.remove('drop-target')
                const draggedId = e.dataTransfer.getData('cardId')
                const targetId = e.currentTarget.dataset.cardId
                if (!draggedId || !targetId || draggedId === targetId) return
                setHandOrder((prev) => {
                  const next = prev.filter((id) => id !== draggedId)
                  const idx = next.indexOf(targetId)
                  if (idx === -1) return [...next, draggedId]
                  next.splice(idx, 0, draggedId)
                  return next
                })
              }}
            >
              <Card
                card={c}
                selected={selectedCards.has(c.id)}
                onClick={() => toggleCard(c.id)}
                draggable={state.phase === 'playing'}
                onDragStart={(e) => {
                  e.dataTransfer.setData('cardId', c.id)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                hideBottomCorner
              />
            </div>
          ))}
        </div>
        <div className="game-hand-toolbar">
          <span className="hand-toolbar-label">{t(lang, 'sort')}</span>
          <button
            type="button"
            className="hand-sort-btn"
            onClick={() =>
              setHandOrder(
                [...myHand]
                  .sort((a, b) => a.rank - b.rank || String(a.suit).localeCompare(String(b.suit)))
                  .map((c) => c.id)
              )
            }
          >
            {t(lang, 'rank')}
          </button>
          <button
            type="button"
            className="hand-sort-btn"
            onClick={() =>
              setHandOrder(
                [...myHand]
                  .sort((a, b) => String(a.suit).localeCompare(String(b.suit)) || a.rank - b.rank)
                  .map((c) => c.id)
              )
            }
          >
            {t(lang, 'suit')}
          </button>
        </div>
        <div className="game-actions">
          {isMyDiscardOption && (
            <>
              <span className="game-actions-label">{t(lang, 'wantTheTopCard')}</span>
              <button onClick={onTakeDiscard} disabled={!canTakeOrPass}>{t(lang, 'takeDiscard')}</button>
              <button
                onClick={onPassDiscard}
                disabled={!canTakeOrPass}
                title={!canTakeOrPass && discardDelayRemaining > 0 ? `${t(lang, 'passAvailableIn')} ${discardDelayRemaining}${t(lang, 's')}` : undefined}
              >
                {t(lang, 'pass')}
              </button>
            </>
          )}
          {canDraw && (
            <>
              <span className="game-actions-label">
                {state.topDiscard ? t(lang, 'takeTopOrDraw') : t(lang, 'drawCard')}
              </span>
              <button onClick={handleDrawStock}>{t(lang, 'drawFromStock')}</button>
              <button onClick={handleDrawDiscard} disabled={!state.topDiscard}>
                {t(lang, 'drawDiscard')}
              </button>
            </>
          )}
          {canDiscard && !everyoneHadTurn && (
            <p className="game-meld-wait-msg" role="status">{t(lang, 'everyoneMustHaveTurn')}</p>
          )}
          {canPlayMeld && (
            <>
              <button
                onClick={handlePlayMelds}
                disabled={selectedCards.size < 3}
                title={t(lang, 'playFullContract')}
              >
                {t(lang, 'playMelds')}
              </button>
              {hasPlayedMelds && state.melds.length > 0 && selectedCards.size > 0 && (
                <button
                  onClick={handleAddToMeld}
                  disabled={!selectedMeldId}
                  title={t(lang, 'selectMeldThenAdd')}
                >
                  {t(lang, 'addToMeld')}
                </button>
              )}
            </>
          )}
          {canDiscard && (
            <button
              type="button"
              className="game-discard-action"
              onClick={handleDiscardSelected}
              disabled={selectedCards.size !== 1}
              title={t(lang, 'discardSelected')}
            >
              {t(lang, 'discardSelected')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Scoreboard({ state, lang }: { state: GameState; lang: Lang }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current
    const appRoot = document.getElementById('root')
    const wasInert = appRoot?.inert ?? false
    const previousOverflow = document.body.style.overflow
    if (appRoot) appRoot.inert = true
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus({ preventScroll: true })

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable?.[0]
      const last = focusable?.[focusable.length - 1]
      if (!first || !last) {
        event.preventDefault()
        panelRef.current?.focus()
      } else if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (appRoot) appRoot.inert = wasInert
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [open])

  const sorted = [...state.players].sort((a, b) => a.score - b.score)
  const hasRoundScores = state.roundScores && Object.keys(state.roundScores).length > 0
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="scoreboard scoreboard-btn"
        onClick={() => setOpen(true)}
        title={t(lang, 'viewAll')}
        aria-label={t(lang, 'scoreboard')}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <h3 className="scoreboard-title">{t(lang, 'scoreboard')}</h3>
        <div className="scoreboard-list">
          {sorted.slice(0, 3).map((p, i) => (
            <div key={p.id} className="scoreboard-row">
              <span className="scoreboard-rank">{i + 1}.</span>
              <span className="scoreboard-name">{p.name}</span>
              <span className="scoreboard-score">{p.score}</span>
            </div>
          ))}
        </div>
        <span className="scoreboard-expand-hint">{t(lang, 'viewAll')}</span>
      </button>
      {open && createPortal(
        <div className="scoreboard-overlay" role="dialog" aria-modal="true" aria-label={t(lang, 'scoreboard')}>
          <div className="scoreboard-backdrop" onClick={() => setOpen(false)} aria-hidden />
          <div ref={panelRef} className="scoreboard-panel" tabIndex={-1}>
            <div className="scoreboard-panel-header">
              <h2 className="scoreboard-panel-title">{t(lang, 'scoreboard')}</h2>
              <button ref={closeRef} type="button" className="scoreboard-close" onClick={() => setOpen(false)} aria-label={t(lang, 'close')}>
                ×
              </button>
            </div>
            <div className="scoreboard-panel-body">
              <section className="scoreboard-section">
                <h3 className="scoreboard-section-title">{t(lang, 'totalPoints')}</h3>
                <div className="scoreboard-panel-list">
                  {sorted.map((p, i) => (
                    <div key={p.id} className="scoreboard-panel-row">
                      <span className="scoreboard-rank">{i + 1}.</span>
                      <span className="scoreboard-name">{p.name}</span>
                      <span className="scoreboard-score">{p.score}</span>
                    </div>
                  ))}
                </div>
              </section>
              {hasRoundScores && (
                <section className="scoreboard-section">
                  <h3 className="scoreboard-section-title">
                    {`${t(lang, 'roundPoints')} ${state.round}`}
                  </h3>
                  <div className="scoreboard-panel-list">
                    {state.players.map((p) => {
                      const pts = state.roundScores[p.id] ?? 0
                      return (
                        <div key={p.id} className="scoreboard-panel-row scoreboard-round-row">
                          <span className="scoreboard-name">{p.name}</span>
                          <span className={`scoreboard-score ${pts >= 0 ? 'score-positive' : 'score-negative'}`}>
                            {pts >= 0 ? '+' : ''}{pts}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  )
}

function MeldRow({ meld }: { meld: Meld }) {
  return (
    <div className="meld-row" data-type={meld.type}>
      {meld.cards.map((c) => (
        <Card key={c.id} card={c} size="small" />
      ))}
    </div>
  )
}

interface OptionsMenuProps {
  lang: Lang
  animationsOn: boolean
  toggleAnimations: () => void
  onBack: () => void
  onDebugSkipRound?: () => void
  setLang: (lang: Lang) => void
}

function OptionsMenu({ lang, animationsOn, toggleAnimations, onBack, onDebugSkipRound, setLang }: OptionsMenuProps) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: Event) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('focusin', closeOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('focusin', closeOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={menuRef} className="options-menu">
      <button
        ref={triggerRef}
        type="button"
        className="options-menu-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        {t(lang, 'room')} ▾
      </button>
      {open && (
        <div id={panelId} className="options-menu-panel">
          <button type="button" onClick={onBack}>
            {t(lang, 'backToMenu')}
          </button>
          <button
            type="button"
            onClick={toggleAnimations}
          >
            {animationsOn ? t(lang, 'hideAnimations') : t(lang, 'showAnimations')}
          </button>
          <div className="options-menu-lang" role="group" aria-label={t(lang, 'language')}>
            <button
              type="button"
              className={lang === 'en' ? 'active' : ''}
              onClick={() => setLang('en')}
              aria-label={t(lang, 'langEn')}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={lang === 'es' ? 'active' : ''}
              onClick={() => setLang('es')}
              aria-label={t(lang, 'langEs')}
              aria-pressed={lang === 'es'}
            >
              ES
            </button>
          </div>
          {onDebugSkipRound && (
            <button type="button" onClick={onDebugSkipRound}>
              {t(lang, 'skipRoundDebug')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
