import { useState } from 'react'
import { SPANISH_RANKS_40, SPANISH_RANKS_48 } from '@shared/pochaTypes'
import type { PochaGameState, PochaCard, PochaDeckSize, PochaPlayer, SpanishSuit } from '@shared/pochaTypes'

function makeId(): string {
  return Math.random().toString(36).slice(2, 11)
}

function makeCard(suit: SpanishSuit, rank: number): PochaCard {
  return { id: makeId(), suit, rank }
}

/** Build a mock Pocha game state for development (bidding or playing phase). */
export function usePochaMockState(
  options: { phase?: 'bidding' | 'playing'; playerCount?: number; deckSize?: PochaDeckSize } = {}
) {
  const { phase = 'playing', playerCount = 4, deckSize = 40 } = options
  const [state, setState] = useState<PochaGameState>(() =>
    buildMockState(phase, playerCount, deckSize)
  )

  const socketId = state.players[0]?.id ?? null

  const onBid = (tricks: number) => {
    if (!socketId || state.phase !== 'bidding') return
    setState((prev) => {
      const next = { ...prev, bids: { ...prev.bids, [socketId]: tricks } }
      const bidCount = Object.keys(next.bids).length
      if (bidCount >= prev.players.length) {
        next.phase = 'playing'
      } else {
        next.currentPlayerIndex = (prev.currentPlayerIndex + 1) % prev.players.length
      }
      return next
    })
  }

  const onPlayCard = (cardId: string) => {
    if (!socketId || state.phase !== 'playing') return
    const player = state.players.find((p) => p.id === socketId)
    const card = player?.hand.find((c) => c.id === cardId)
    if (!player || !card) return

    setState((prev) => {
      const next = { ...prev }
      const pi = next.players.findIndex((p) => p.id === socketId)
      if (pi === -1) return prev
      const current = next.players[pi]
      if (!current) return prev
      next.players = [...next.players]
      next.players[pi] = {
        ...current,
        hand: current.hand.filter((c) => c.id !== cardId),
      }
      next.currentTrick = [...next.currentTrick, { playerId: socketId, card }]

      const trickSize = next.currentTrick.length
      if (trickSize >= next.players.length) {
        next.currentTrick = []
        next.leadPlayerIndex = (next.leadPlayerIndex + 1) % next.players.length
        next.currentPlayerIndex = next.leadPlayerIndex
      } else {
        next.currentPlayerIndex = (next.currentPlayerIndex + 1) % next.players.length
      }
      return next
    })
  }

  const reset = (nextDeckSize: PochaDeckSize) => {
    setState(buildMockState(phase, playerCount, nextDeckSize))
  }

  return { state, socketId, onBid, onPlayCard, reset }
}

function buildMockState(
  phase: 'bidding' | 'playing',
  playerCount: number,
  deckSize: PochaDeckSize
): PochaGameState {
  const names = ['You', 'Maria', 'Luis', 'Ana', 'Pablo'].slice(0, playerCount)
  const suits: SpanishSuit[] = ['oros', 'copas', 'espadas', 'bastos']
  const ranks = deckSize === 48 ? SPANISH_RANKS_48 : SPANISH_RANKS_40
  const cardsPerHand = Math.floor(deckSize / playerCount)

  const players: PochaPlayer[] = names.map((name, i) => {
    const hand: PochaCard[] = []
    for (let c = 0; c < cardsPerHand; c++) {
      const s = suits[(i * 3 + c) % 4] ?? 'oros'
      const r = ranks[(i * 2 + c) % ranks.length] ?? 1
      hand.push(makeCard(s, r))
    }
    return {
      id: `player-${i}`,
      name: name,
      score: [12, 8, 5, 3][i] ?? 0,
      hand,
      connected: true,
      seatIndex: i,
      bid: phase === 'bidding' ? null : (i % (cardsPerHand + 1)),
      tricksWon: 0,
    }
  })

  const trump: SpanishSuit = 'oros'
  const trumpCard = makeCard(trump, 5)

  const bids: Record<string, number> = {}
  if (phase === 'playing') {
    players.forEach((p, i) => {
      bids[p.id] = i % (cardsPerHand + 1)
    })
  }

  return {
    roomId: 'mock-pocha',
    phase,
    handNumber: 3,
    cardsPerHand,
    deckSize,
    trump,
    trumpCard,
    players,
    dealerIndex: 0,
    leadPlayerIndex: 1,
    currentTrick:
      phase === 'playing' && players[1]
        ? [
            {
              playerId: players[1].id,
              card: makeCard('copas', 3),
            },
          ]
        : [],
    bids,
    currentPlayerIndex: phase === 'bidding' ? 1 : 0,
  }
}
