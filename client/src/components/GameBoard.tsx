import { useState, useEffect, useRef } from 'react'
import type { Card as CardType, GameState, Meld, Player } from '../types'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { Card } from './Card'
import { ReportBugButton } from './ReportBugButton'
import { CardBack } from './cards/CardBack'
import { rankLabel, SUIT_SYMBOL } from './cards'
import { GameShell } from './GameShell'
import './GameBoard.css'

/** Short label for a card (e.g. "7♥") for toasts. */
function cardLabel(c: CardType): string {
  if (c.suit === 'joker' || c.rank === 0) return 'Joker'
  return rankLabel(c.rank) + SUIT_SYMBOL[c.suit]
}

const CARDS_ROUND_1 = 7
const POKER_SEAT_COUNT = 10

/** Seat positions around oval: angle in degrees (0 = bottom). radius in % from center (default 48). */
function seatPosition(displayIndex: number, radius = 48): { x: number; y: number } {
  const angleDeg = displayIndex * (360 / POKER_SEAT_COUNT) - 90
  const rad = (angleDeg * Math.PI) / 180
  return {
    x: 50 + radius * Math.cos(rad),
    y: 50 + radius * Math.sin(rad),
  }
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
  const handCountOkToDraw = myHand.length === cardsThisRound
  const canDraw = state.phase === 'playing' && discardOptionIndex === null && state.currentPlayerIndex === myIndex && handCountOkToDraw
  const canDiscard =
    state.phase === 'playing' &&
    discardOptionIndex === null &&
    state.currentPlayerIndex === myIndex &&
    myHand.length >= 1 &&
    myHand.length !== cardsThisRound

  const hasPlayedMelds = state.melds.some((m) => m.ownerId === socketId)

  const discardOptionAvailableAt = state.discardOptionAvailableAt ?? null
  const now = Date.now()
  const discardDelayRemaining = discardOptionAvailableAt != null && now < discardOptionAvailableAt
    ? Math.ceil((discardOptionAvailableAt - now) / 1000)
    : 0
  const canTakeOrPass = isMyDiscardOption && !discardDelayRemaining

  const secondsPerTurn = state.secondsPerTurn ?? 0
  const [turnSecondsLeft, setTurnSecondsLeft] = useState<number | null>(null)
  const autoActedRef = useRef(false)
  const onPassDiscardRef = useRef(onPassDiscard)
  const onDrawRef = useRef(() => onDraw(false))
  onPassDiscardRef.current = onPassDiscard
  onDrawRef.current = () => onDraw(false)
  useEffect(() => {
    if (!isMyTurn) {
      setTurnSecondsLeft(null)
      autoActedRef.current = false
      return
    }
    if (state.phase !== 'playing' || secondsPerTurn <= 0) {
      setTurnSecondsLeft(null)
      return
    }
    const endAt = Date.now() + secondsPerTurn * 1000
    setTurnSecondsLeft(secondsPerTurn)
    const t = setInterval(() => {
      const left = Math.ceil((endAt - Date.now()) / 1000)
      setTurnSecondsLeft(left <= 0 ? 0 : left)
      if (left <= 0 && !autoActedRef.current) {
        autoActedRef.current = true
        if (discardOptionIndex !== null) onPassDiscardRef.current()
        else onDrawRef.current()
      }
    }, 500)
    return () => clearInterval(t)
  }, [state.phase, state.currentPlayerIndex, discardOptionIndex, isMyTurn, secondsPerTurn])

  const handleCopyRoomLink = async () => {
    if (typeof window === 'undefined') return
    const base = window.location.origin
    const url = `${base}/room/${state.roomId}`
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        const textArea = document.createElement('textarea')
        textArea.value = url
        textArea.style.position = 'fixed'
        textArea.style.left = '-9999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
      }
      setRoomLinkCopied(true)
      setTimeout(() => setRoomLinkCopied(false), 2000)
    } catch {
      // ignore copy errors
    }
  }

  // Shuffle then circular deal when round starts or game enters playing
  const totalToDeal = n * cardsThisRound

  useEffect(() => {
    const prevPhase = prevPhaseRef.current
    const prevRound = prevRoundRef.current
    prevPhaseRef.current = state.phase
    prevRoundRef.current = state.round
    if (state.phase !== 'playing') return
    const roundJustStarted = prevPhase !== 'playing' || prevRound !== state.round
    if (!roundJustStarted) return
    setDealAnimKey(null)
    if (!animationsOn) {
      setDealAnimKey(Date.now())
      const t = setTimeout(() => setDealAnimKey(null), 500)
      return () => clearTimeout(t)
    }
    setShuffleActive(true)
    setDealingPhase(false)
    setDealingIndex(0)
    const t1 = setTimeout(() => {
      setShuffleActive(false)
      if (totalToDeal > 0) {
        setDealingPhase(true)
        setDealingIndex(0)
      } else {
        setDealAnimKey(Date.now())
      }
    }, 1200)
    return () => clearTimeout(t1)
  }, [state.phase, state.round, totalToDeal, animationsOn])

  const handleDealCardAnimationEnd = () => {
    setDealingIndex((prev) => {
      const next = prev + 1
      if (next >= totalToDeal) {
        queueMicrotask(() => {
          setDealingPhase(false)
          setDealAnimKey(Date.now())
          setTimeout(() => setDealAnimKey(null), 2200)
        })
      }
      return next
    })
  }

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
    if (!canDiscard || selectedCards.size < 3) return
    const cards = myHand.filter((c) => selectedCards.has(c.id))
    if (cards.length < 3) return
    const wilds = cards.filter((c) => c.rank === 0 || c.isWild || c.suit === 'joker')
    const byRank = new Map<number, CardType[]>()
    for (const c of cards) {
      if (c.rank === 0 || c.isWild || c.suit === 'joker') continue
      const list = byRank.get(c.rank) ?? []
      list.push(c)
      byRank.set(c.rank, list)
    }
    const melds: { type: 'trio' | 'straight'; cards: CardType[] }[] = []
    let wildsUsed = 0
    for (const [, list] of byRank) {
      const availableWilds = wilds.length - wildsUsed
      if (list.length >= 3) {
        melds.push({ type: 'trio', cards: list.slice(0, 3) })
      } else if (list.length + availableWilds >= 3) {
        const fillCount = 3 - list.length
        const trio = [...list.slice(0, 3), ...wilds.slice(wildsUsed, wildsUsed + fillCount)]
        wildsUsed += fillCount
        melds.push({ type: 'trio', cards: trio })
      }
    }
    if (melds.length > 0) {
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

  if (state.phase === 'lobby') {
    const lobbySeats = getSeatsAroundTable([...state.players], socketId)
    return (
      <div className="game-board game-lobby">
        <div className="game-top-row">
          <button type="button" className="game-back-btn" onClick={onLeave}>
            {t(lang, 'backToMenu')}
          </button>
          <div className="game-lang">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')}>ES</button>
          </div>
          <ReportBugButton
            lang={lang}
            reportCopied={reportCopied}
            setReportCopied={setReportCopied}
            context={{ roomId: state.roomId, phase: state.phase, players: state.players.length }}
          />
        </div>
        <div className="game-lobby-header">
          <h2>{t(lang, 'room')} {state.roomId}</h2>
          <button
            type="button"
            className="game-copy-room-link-btn"
            onClick={handleCopyRoomLink}
            title={roomLinkCopied ? t(lang, 'roomLinkCopied') : t(lang, 'copyRoomLink')}
          >
            {roomLinkCopied ? t(lang, 'roomLinkCopied') : t(lang, 'copyRoomLink')}
          </button>
          <p className="game-lobby-sub">{t(lang, 'chooseSeat')} · {state.players.length}/10 {t(lang, 'players')}</p>
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
                role={isEmpty ? 'button' : undefined}
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
                Decks:
                <select value={lobbyDeckCount} onChange={(e) => setLobbyDeckCount(Number(e.target.value) as 2 | 3)}>
                  <option value={2}>2 decks</option>
                  <option value={3}>3 decks</option>
                </select>
              </label>
              <label className="lobby-deck-label">
                Delay before take/pass (s):
                <select value={lobbyDiscardDelay} onChange={(e) => setLobbyDiscardDelay(Number(e.target.value))}>
                  <option value={0}>0</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={15}>15</option>
                </select>
              </label>
              <label className="lobby-deck-label">
                Seconds per turn (0 = none):
                <select value={lobbyTurnSecs} onChange={(e) => setLobbyTurnSecs(Number(e.target.value))}>
                  <option value={0}>No limit</option>
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
        </div>
      </div>
    )
  }

  if (state.phase === 'round_end') {
    return (
      <div className="game-board game-round-end">
        <div className="game-round-end-top">
          <button type="button" className="game-back-btn" onClick={onLeave}>
            {t(lang, 'backToMenu')}
          </button>
          <div className="game-lang">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')}>ES</button>
          </div>
          <ReportBugButton
            lang={lang}
            reportCopied={reportCopied}
            setReportCopied={setReportCopied}
            context={{ roomId: state.roomId, phase: state.phase, round: state.round }}
          />
        </div>
        <Scoreboard state={state} lang={lang} />
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
        <div className="game-round-end-top">
          <button type="button" className="game-back-btn" onClick={onLeave}>
            {t(lang, 'backToMenu')}
          </button>
          <div className="game-lang">
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
            <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')}>ES</button>
          </div>
          <ReportBugButton
            lang={lang}
            reportCopied={reportCopied}
            setReportCopied={setReportCopied}
            context={{ roomId: state.roomId, phase: state.phase }}
          />
        </div>
        <Scoreboard state={state} lang={lang} />
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

  const isDealingActive = dealingPhase && dealingIndex < totalToDeal

  return (
    <div className={`game-board ${isDealingActive ? 'dealing-cards' : ''} ${!animationsOn ? 'animations-off' : ''}`}>
      <GameShell
        backLabel={t(lang, 'backToMenu')}
        onBack={onLeave}
        lang={lang}
        setLang={setLang}
        error={serverError}
        toast={jokerToast}
        toastSuccess
        debugSlot={
          <>
            <button
              type="button"
              className="game-debug-btn"
              onClick={() => setAnimationsOn((v) => !v)}
              title={animationsOn ? t(lang, 'hideAnimations') : t(lang, 'showAnimations')}
            >
              {animationsOn ? t(lang, 'noAnim') : t(lang, 'anim')}
            </button>
            {onDebugSkipRound && state.phase === 'playing' && (
              <button type="button" className="game-debug-btn game-debug-skip" onClick={onDebugSkipRound}>
                {t(lang, 'skipRoundDebug')}
              </button>
            )}
          </>
        }
        rightSlot={
          <>
            <Scoreboard state={state} lang={lang} />
            <ReportBugButton
              lang={lang}
              reportCopied={reportCopied}
              setReportCopied={setReportCopied}
              context={{
                roomId: state.roomId,
                phase: state.phase,
                round: state.round,
                players: state.players.length,
                myId: socketId ?? undefined,
                currentPlayerIndex: state.currentPlayerIndex,
                discardOptionPlayerIndex: state.discardOptionPlayerIndex ?? undefined,
                stockCount: state.stockCount,
                topDiscard: state.topDiscard ? `${state.topDiscard.rank}/${state.topDiscard.suit}` : null,
                myHandLength: me?.hand.length ?? 0,
                meldsCount: state.melds.length,
              }}
            />
          </>
        }
      />
      <div className="game-info">
        <span>{t(lang, 'room')} {state.roomId}</span>
        <button
          type="button"
          className="game-copy-room-link-btn"
          onClick={handleCopyRoomLink}
          title={roomLinkCopied ? t(lang, 'roomLinkCopied') : t(lang, 'copyRoomLink')}
        >
          {roomLinkCopied ? t(lang, 'roomLinkCopied') : t(lang, 'copyRoomLink')}
        </button>
        <span>{t(lang, 'round')} {state.round}</span>
        <span>
          {t(lang, 'contract')}: {state.contract.requirements.map((r) => `${r.minLength}+ ${r.type === 'trio' ? t(lang, 'trioNum') : t(lang, 'straightNum')}`).join(', ')}
        </span>
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

      <div className={`poker-table-wrap poker-table-playing ${shuffleActive ? 'table-shuffle-active' : ''} ${dealingPhase ? 'dealing-cards' : ''}`}>
        {shuffleActive && (
          <div className="deal-overlay" aria-hidden>
            <span className="deal-overlay-text">
              {t(lang, 'shuffling')}… {t(lang, 'round')} {state.round}
            </span>
          </div>
        )}
        {dealingPhase && dealingIndex < totalToDeal && (() => {
          const seats = getSeatsAroundTable([...state.players], socketId)
          const playerIndexToDisplayIndex: number[] = []
          for (let pi = 0; pi < n; pi++) {
            const player = state.players[pi]
            const d = player ? seats.findIndex((p) => p?.id === player.id) : -1
            playerIndexToDisplayIndex[pi] = d >= 0 ? d : 0
          }
          const targetPlayerIndex = dealingIndex % n
          const displayIndex = playerIndexToDisplayIndex[targetPlayerIndex] ?? 0
          const pos = seatPosition(displayIndex)
          return (
            <div
              key={dealingIndex}
              className="flying-deal-card"
              style={{ '--end-x': pos.x, '--end-y': pos.y } as React.CSSProperties}
              onAnimationEnd={handleDealCardAnimationEnd}
            >
              <CardBack width={72} height={100} />
            </div>
          )
        })()}
        <div className="poker-table-oval">
          <div className="game-table-center">
            {canDiscard && (
              <div
                className="game-discard-zone"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
                onDrop={(e) => {
                  e.preventDefault()
                  const cardId = e.dataTransfer.getData('cardId')
                  if (cardId) {
                    onDiscard(cardId)
                    setSelectedCards(new Set())
                  }
                }}
                onClick={() => {
                  if (selectedCards.size === 1) {
                    const [cardId] = selectedCards
                    if (cardId) {
                      onDiscard(cardId)
                      setSelectedCards(new Set())
                    }
                  }
                }}
              >
                <span className="discard-zone-label">{t(lang, 'dropToDiscard')}</span>
              </div>
            )}
            <div className="game-piles">
              <div
                className={`game-stock ${shuffleActive ? 'shuffle-animate' : ''}`}
                onClick={canDraw ? handleDrawStock : undefined}
              >
                <Card card={{ id: '', suit: 'joker', rank: 0 }} faceDown size="normal" />
                <span className="stock-count">{state.stockCount}</span>
              </div>
              <div
                className={`game-discard ${state.topDiscard ? 'discard-has-card' : ''}`}
                onClick={canDraw ? handleDrawDiscard : undefined}
                data-clickable={canDraw && !!state.topDiscard}
              >
                {state.topDiscard ? (
                  <div key={state.topDiscard.id} className="discard-card-wrap">
                    <Card card={state.topDiscard} size="normal" />
                  </div>
                ) : (
                  <div className="discard-placeholder" />
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Meld zones: one per seat, in front of each player (inner radius) */}
        {getSeatsAroundTable([...state.players], socketId).map((player, d) => {
          const meldsForSeat = player ? state.melds.filter((m) => m.ownerId === player.id) : []
          const pos = seatPosition(d, 32)
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
                    role={canAddOrSwap ? 'button' : undefined}
                    title={canSwap ? t(lang, 'swapJokerWith') : undefined}
                  >
                    {expanded ? (
                      <>
                        <div className="meld-row-header">
                          <span className="meld-row-title">{showLabel}</span>
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
        {getSeatsAroundTable([...state.players], socketId).map((player, d) => {
          const pos = seatPosition(d)
          const isMe = player?.id === socketId
          return (
            <div
              key={d}
              className={`poker-seat poker-seat-playing ${!player ? 'poker-seat-empty' : ''} ${isMe ? 'poker-seat-me' : ''}`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
            >
              {player ? (
                <>
                  <span className="poker-seat-name">{player.name}</span>
                  {isMe ? (
                    <span className="poker-seat-you">{t(lang, 'you')}</span>
                  ) : (
                    <div className="opponent-cards opponent-cards-single">
                      <span className="opponent-cards-label" aria-label={`${player.hand.length} ${t(lang, 'cards')}`}>
                        {player.hand.length} {t(lang, 'cards')}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                <span className="poker-seat-empty-label" />
              )}
            </div>
          )
        })}
      </div>

      <div className="game-hand-area">
        <div className="game-hand">
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
          {canDiscard && (
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
        </div>
      </div>
    </div>
  )
}

function Scoreboard({ state, lang }: { state: GameState; lang: Lang }) {
  const [open, setOpen] = useState(false)
  const sorted = [...state.players].sort((a, b) => a.score - b.score)
  const hasRoundScores = state.roundScores && Object.keys(state.roundScores).length > 0
  return (
    <>
      <button
        type="button"
        className="scoreboard scoreboard-btn"
        onClick={() => setOpen(true)}
        title={t(lang, 'viewAll')}
        aria-label={t(lang, 'scoreboard')}
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
      {open && (
        <div className="scoreboard-overlay" role="dialog" aria-modal="true" aria-label={t(lang, 'scoreboard')}>
          <div className="scoreboard-backdrop" onClick={() => setOpen(false)} aria-hidden />
          <div className="scoreboard-panel">
            <div className="scoreboard-panel-header">
              <h2 className="scoreboard-panel-title">{t(lang, 'scoreboard')}</h2>
              <button type="button" className="scoreboard-close" onClick={() => setOpen(false)} aria-label={t(lang, 'close')}>
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
        </div>
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
