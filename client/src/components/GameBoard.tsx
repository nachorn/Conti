import { useState, useEffect, useRef } from 'react'
import type { Card as CardType, GameState, Meld } from '../types'
import { Card } from './Card'
import './GameBoard.css'

const CARDS_ROUND_1 = 7

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
  onStart: (opts?: { deckCount?: 2 | 3; discardOptionDelaySeconds?: number; secondsPerTurn?: number }) => void
  onDraw: (fromDiscard: boolean) => void
  onPlayMelds: (melds: { type: 'trio' | 'straight'; cards: CardType[] }[]) => void
  onDiscard: (cardId: string) => void
  onTakeDiscard: () => void
  onPassDiscard: () => void
  onLeave: () => void
  onNextRound: () => void
}

export function GameBoard({
  state,
  socketId,
  onStart,
  onDraw,
  onPlayMelds,
  onDiscard,
  onTakeDiscard,
  onPassDiscard,
  onLeave,
  onNextRound,
}: GameBoardProps) {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set())
  const [handOrder, setHandOrder] = useState<string[]>([])
  const [lobbyDeckCount, setLobbyDeckCount] = useState<2 | 3>(state.deckCount ?? 2)
  const [lobbyDiscardDelay, setLobbyDiscardDelay] = useState(state.discardOptionDelaySeconds ?? 10)
  const [lobbyTurnSecs, setLobbyTurnSecs] = useState(state.secondsPerTurn ?? 0)
  const me = state.players.find((p) => p.id === socketId)
  const myIndex = me ? state.players.findIndex((p) => p.id === socketId) : -1
  const discardOptionIndex = state.discardOptionPlayerIndex ?? null
  const turnPlayerIndex = discardOptionIndex !== null ? discardOptionIndex : state.currentPlayerIndex
  const turnPlayer = state.players[turnPlayerIndex]
  const isMyTurn = turnPlayer?.id === socketId
  const isHost = state.players[0]?.id === socketId
  const isMyDiscardOption = discardOptionIndex !== null && state.players[discardOptionIndex]?.id === socketId
  const isMyNormalTurn = discardOptionIndex === null && state.players[state.currentPlayerIndex]?.id === socketId

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
  const canDraw = state.phase === 'playing' && discardOptionIndex === null && state.currentPlayerIndex === myIndex && myHand.length === cardsThisRound
  const canDiscard = state.phase === 'playing' && discardOptionIndex === null && state.currentPlayerIndex === myIndex && myHand.length > cardsThisRound

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
    const byRank = new Map<number, CardType[]>()
    for (const c of cards) {
      if (c.rank === 0 || c.isWild) continue
      const list = byRank.get(c.rank) ?? []
      list.push(c)
      byRank.set(c.rank, list)
    }
    const melds: { type: 'trio' | 'straight'; cards: CardType[] }[] = []
    for (const [, list] of byRank) {
      if (list.length >= 3) melds.push({ type: 'trio', cards: list.slice(0, 3) })
    }
    if (melds.length > 0) {
      onPlayMelds(melds)
      setSelectedCards(new Set())
    }
  }

  if (state.phase === 'lobby') {
    return (
      <div className="game-board game-lobby">
        <button type="button" className="game-back-btn" onClick={onLeave}>
          ← Back to menu
        </button>
        <div className="game-lobby-box">
          <h2>Room {state.roomId.toUpperCase()}</h2>
          <p>Players ({state.players.length}/10):</p>
          <ul>
            {state.players.map((p) => (
              <li key={p.id}>
                {p.name} {p.id === socketId && '(you)'}
              </li>
            ))}
          </ul>
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
                Start game ({state.players.length} players)
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
        <button type="button" className="game-back-btn" onClick={onLeave}>
          ← Back to menu
        </button>
        <Scoreboard state={state} />
        <div className="game-round-end-box">
          <h2>Round {state.round} over</h2>
          <p>This round:</p>
          <ul>
            {state.players.map((p) => (
              <li key={p.id}>
                {p.name}: {state.roundScores[p.id] ?? 0} pts
              </li>
            ))}
          </ul>
          {state.round < 7 && isHost && (
            <button onClick={onNextRound}>Next round</button>
          )}
          {state.round >= 7 && <p className="game-over-msg">Game over. Lowest total score wins.</p>}
        </div>
      </div>
    )
  }

  if (state.phase === 'game_end') {
    const winner = state.players.reduce((a, b) => (a.score <= b.score ? a : b))
    return (
      <div className="game-board game-round-end">
        <button type="button" className="game-back-btn" onClick={onLeave}>
          ← Back to menu
        </button>
        <Scoreboard state={state} />
        <div className="game-round-end-box">
          <h2>Game over</h2>
          <p>Winner: {winner.name} with {winner.score} points</p>
          <ul>
            {state.players.map((p) => (
              <li key={p.id}>{p.name}: {p.score} pts</li>
            ))}
          </ul>
        </div>
      </div>
    )
  }

  return (
    <div className="game-board">
      <button type="button" className="game-back-btn" onClick={onLeave}>
        ← Back to menu
      </button>
      <Scoreboard state={state} />
      <div className="game-info">
        <span>Room {state.roomId.toUpperCase()}</span>
        <span>Round {state.round}</span>
        <span>
          Contract: {state.contract.requirements.map((r) => `${r.minLength}+ ${r.type}`).join(', ')}
        </span>
        {turnPlayer && (
          <span className={`turn-badge ${isMyTurn ? 'turn-badge-you' : ''}`}>
            {isMyTurn ? 'Your turn' : `${turnPlayer.name}'s turn`}
          </span>
        )}
        {turnSecondsLeft != null && secondsPerTurn > 0 && (
          <span className="turn-timer">{turnSecondsLeft}s</span>
        )}
        {isMyDiscardOption && discardDelayRemaining > 0 && (
          <span className="turn-badge discard-delay-badge">Take/pass in {discardDelayRemaining}s</span>
        )}
        {hasPriority && canTakeOrPass && (
          <span className="turn-badge priority-badge">You have priority</span>
        )}
      </div>

      <div className="game-table">
        <div className="game-melds">
          {state.melds.map((meld) => (
            <MeldRow key={meld.id} meld={meld} />
          ))}
        </div>

        {/* Drop zone: drag a card here to discard (or tap here when one card selected) */}
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
            <span className="discard-zone-label">Drop here to discard</span>
          </div>
        )}

        <div className="game-piles">
          <div className="game-stock" onClick={canDraw ? handleDrawStock : undefined}>
            <Card card={{ id: '', suit: 'joker', rank: 0 }} faceDown size="normal" />
            <span className="stock-count">{state.stockCount}</span>
          </div>
          <div
            className="game-discard"
            onClick={canDraw ? handleDrawDiscard : undefined}
            data-clickable={canDraw && !!state.topDiscard}
          >
            {state.topDiscard ? (
              <Card card={state.topDiscard} size="normal" />
            ) : (
              <div className="discard-placeholder" />
            )}
          </div>
        </div>

        <div className="game-opponents">
          {state.players
            .filter((p) => p.id !== socketId)
            .map((p) => (
              <div key={p.id} className="opponent">
                <span className="opponent-name">{p.name}</span>
                <div className="opponent-cards">
                  {p.hand.map((c) => (
                    <Card key={c.id} card={c} faceDown size="small" />
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>

      <div className="game-hand-area">
        <div className="game-hand">
          {myHand.map((c) => (
            <div
              key={c.id}
              className="game-hand-card-wrap"
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
              />
            </div>
          ))}
        </div>
        <div className="game-hand-toolbar">
          <span className="hand-toolbar-label">Sort:</span>
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
            Rank
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
            Suit
          </button>
        </div>
        <div className="game-actions">
          {isMyDiscardOption && (
            <>
              <button onClick={onTakeDiscard} disabled={!canTakeOrPass}>Take discard</button>
              <button onClick={onPassDiscard} disabled={!canTakeOrPass}>
                {canTakeOrPass ? 'Pass' : `Wait ${discardDelayRemaining}s`}
              </button>
            </>
          )}
          {canDraw && (
            <>
              <button onClick={handleDrawStock}>Draw from stock</button>
              <button onClick={handleDrawDiscard} disabled={!state.topDiscard}>
                Draw discard
              </button>
            </>
          )}
          {canDiscard && (
            <button
              onClick={handlePlayMelds}
              disabled={selectedCards.size < 3}
              title="Play full contract only (e.g. 2 trios for round 1)"
            >
              Play melds
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Scoreboard({ state }: { state: GameState }) {
  return (
    <div className="scoreboard">
      <h3 className="scoreboard-title">Scoreboard</h3>
      <div className="scoreboard-list">
        {state.players
          .slice()
          .sort((a, b) => a.score - b.score)
          .map((p, i) => (
            <div key={p.id} className="scoreboard-row">
              <span className="scoreboard-rank">{i + 1}.</span>
              <span className="scoreboard-name">{p.name}</span>
              <span className="scoreboard-score">{p.score}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

function MeldRow({ meld }: { meld: Meld }) {
  return (
    <div className="meld-row" data-type={meld.type}>
      {meld.cards.map((c) => (
        <Card key={c.id} card={c} size="normal" />
      ))}
    </div>
  )
}
