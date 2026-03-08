import { useState } from 'react'
import type { Card as CardType, GameState, Meld } from '../types'
import { Card } from './Card'
import './GameBoard.css'

interface GameBoardProps {
  state: GameState
  socketId: string | null
  onStart: () => void
  onDraw: (fromDiscard: boolean) => void
  onPlayMelds: (melds: { type: 'trio' | 'straight'; cards: CardType[] }[]) => void
  onDiscard: (cardId: string) => void
  onNextRound: () => void
}

export function GameBoard({
  state,
  socketId,
  onStart,
  onDraw,
  onPlayMelds,
  onDiscard,
  onNextRound,
}: GameBoardProps) {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set())
  const me = state.players.find((p) => p.id === socketId)
  const isMyTurn = state.players[state.currentPlayerIndex]?.id === socketId
  const isHost = state.players[0]?.id === socketId

  const myHand = me?.hand ?? []
  const CARDS_AFTER_DEAL = 6
  const needToDraw = isMyTurn && myHand.length === CARDS_AFTER_DEAL
  const canDraw = state.phase === 'playing' && needToDraw
  const canDiscard = state.phase === 'playing' && isMyTurn && myHand.length > CARDS_AFTER_DEAL

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

  const handleDiscard = () => {
    if (!canDiscard || selectedCards.size !== 1) return
    const [cardId] = selectedCards
    if (cardId) {
      onDiscard(cardId)
      setSelectedCards(new Set())
    }
  }

  const handlePlayMelds = () => {
    if (!canDiscard || selectedCards.size < 3) return
    const cards = myHand.filter((c) => selectedCards.has(c.id))
    if (cards.length < 3) return
    const trios = cards.filter((c) => cards.filter((x) => x.rank === c.rank).length >= 3)
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
            <button onClick={onStart} disabled={state.players.length < 2}>
              Start game ({state.players.length} players)
            </button>
          )}
        </div>
      </div>
    )
  }

  if (state.phase === 'round_end') {
    return (
      <div className="game-board game-round-end">
        <div className="game-round-end-box">
          <h2>Round {state.round} over</h2>
          <p>Penalties this round:</p>
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
      <div className="game-info">
        <span>Room {state.roomId.toUpperCase()}</span>
        <span>Round {state.round}</span>
        <span>
          Contract: {state.contract.requirements.map((r) => `${r.minLength}+ ${r.type}`).join(', ')}
        </span>
        {isMyTurn && <span className="turn-badge">Your turn</span>}
      </div>

      <div className="game-table">
        <div className="game-melds">
          {state.melds.map((meld) => (
            <MeldRow key={meld.id} meld={meld} />
          ))}
        </div>

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
            />
          ))}
        </div>
        <div className="game-actions">
          {canDraw && (
            <>
              <button onClick={handleDrawStock}>Draw from stock</button>
              <button onClick={handleDrawDiscard} disabled={!state.topDiscard}>
                Draw discard
              </button>
            </>
          )}
          {canDiscard && (
            <>
              <button
                onClick={handlePlayMelds}
                disabled={selectedCards.size < 3}
                title="Play selected cards as trios (same rank)"
              >
                Play melds
              </button>
              <button onClick={handleDiscard} disabled={selectedCards.size !== 1}>
                Discard (pick 1)
              </button>
            </>
          )}
        </div>
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
