import { useState } from 'react'
import type { Card as CardType, GameState, Meld } from '../types'
import { Card } from './Card'
import './GameBoard.css'

const CARDS_ROUND_1 = 7

function cardsPerPlayerForRound(round: number): number {
  return CARDS_ROUND_1 + round - 1
}

interface GameBoardProps {
  state: GameState
  socketId: string | null
  onStart: (deckCount?: 2 | 3) => void
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
  const [lobbyDeckCount, setLobbyDeckCount] = useState<2 | 3>(state.deckCount ?? 2)
  const me = state.players.find((p) => p.id === socketId)
  const isMyTurn = state.players[state.currentPlayerIndex]?.id === socketId
  const isHost = state.players[0]?.id === socketId
  const discardOptionIndex = state.discardOptionPlayerIndex ?? null
  const isMyDiscardOption = discardOptionIndex !== null && state.players[discardOptionIndex]?.id === socketId

  const myHand = me?.hand ?? []
  const cardsThisRound = cardsPerPlayerForRound(state.round)
  const needToDraw = isMyTurn && myHand.length === cardsThisRound
  const canDraw = state.phase === 'playing' && needToDraw && !isMyDiscardOption
  const canDiscard = state.phase === 'playing' && isMyTurn && myHand.length > cardsThisRound && !isMyDiscardOption

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
              <button onClick={() => onStart(lobbyDeckCount)} disabled={state.players.length < 2}>
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
        {isMyTurn && !isMyDiscardOption && <span className="turn-badge">Your turn</span>}
        {isMyDiscardOption && <span className="turn-badge discard-option-badge">Take or pass discard</span>}
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
            <Card
              key={c.id}
              card={c}
              selected={selectedCards.has(c.id)}
              onClick={() => toggleCard(c.id)}
              draggable={canDiscard}
              onDragStart={canDiscard ? (e) => { e.dataTransfer.setData('cardId', c.id); e.dataTransfer.effectAllowed = 'move' } : undefined}
            />
          ))}
        </div>
        <div className="game-actions">
          {isMyDiscardOption && (
            <>
              <button onClick={onTakeDiscard}>Take discard</button>
              <button onClick={onPassDiscard}>Pass</button>
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
