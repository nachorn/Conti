import { useState } from 'react'
import type { Card, GameState, Meld } from './types'

function makeId(): string {
  return Math.random().toString(36).slice(2, 11)
}

function makeCard(suit: Card['suit'], rank: number, isWild = false): Card {
  return { id: makeId(), suit, rank, ...(isWild ? { isWild: true } : {}) }
}

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades']

/** Build a mock Continental game state for dev testing (round 1, 2 players). */
export function useContinentalMockState() {
  const [state, setState] = useState<GameState>(() => buildMockState())

  const socketId = state.players[0]?.id ?? null

  const draw = (fromDiscard: boolean) => {
    setState((prev) => {
      const next = { ...prev }
      const me = next.players[0]
      if (!me || next.phase !== 'playing' || next.currentPlayerIndex !== 0) return prev
      if (fromDiscard && next.topDiscard) {
        next.players[0] = { ...me, hand: [...me.hand, next.topDiscard!] }
        next.discardPile = next.discardPile.slice(0, -1)
        next.topDiscard = (next.discardPile as Card[]).slice(-1)[0] ?? null
      } else {
        const stockCard = makeCard('hearts', (prev.stockCount % 13) || 1)
        next.players[0] = { ...me, hand: [...me.hand, stockCard] }
        next.stockCount = Math.max(0, next.stockCount - 1)
      }
      next.currentPlayerIndex = 1
      return next
    })
  }

  const discard = (cardId: string) => {
    setState((prev) => {
      const next = { ...prev }
      const me = next.players[0]
      if (!me || next.phase !== 'playing' || next.currentPlayerIndex !== 0) return prev
      const card = me.hand.find((c) => c.id === cardId)
      if (!card) return prev
      next.players[0] = { ...me, hand: me.hand.filter((c) => c.id !== cardId) }
      next.discardPile = [...next.discardPile, card]
      next.topDiscard = card
      next.currentPlayerIndex = 1
      next.discarderIndex = 0
      return next
    })
  }

  const playMelds = (melds: { type: 'trio' | 'straight'; cards: Card[] }[]) => {
    setState((prev) => {
      const next = { ...prev }
      const me = next.players[0]
      if (!me || next.phase !== 'playing' || next.currentPlayerIndex !== 0) return prev
      const newMelds: Meld[] = melds.map((m) => ({
        id: makeId(),
        type: m.type,
        cards: m.cards,
        ownerId: me.id,
      }))
      const usedIds = new Set(melds.flatMap((m) => m.cards.map((c) => c.id)))
      next.players[0] = { ...me, hand: me.hand.filter((c) => !usedIds.has(c.id)) }
      next.melds = [...next.melds, ...newMelds]
      return next
    })
  }

  const addToMeld = (meldId: string, cards: Card[]) => {
    setState((prev) => {
      const next = { ...prev }
      const me = next.players[0]
      const meld = next.melds.find((m) => m.id === meldId)
      if (!me || !meld || next.phase !== 'playing' || next.currentPlayerIndex !== 0) return prev
      const usedIds = new Set(cards.map((c) => c.id))
      next.players[0] = { ...me, hand: me.hand.filter((c) => !usedIds.has(c.id)) }
      next.melds = next.melds.map((m) =>
        m.id === meldId ? { ...m, cards: [...m.cards, ...cards] } : m
      )
      return next
    })
  }

  const swapJoker = (_meldId: string, _cardId: string) => {
    setState((prev) => prev)
  }

  const takeDiscard = () => {
    draw(true)
  }

  const passDiscard = () => {
    setState((prev) => {
      const next = { ...prev }
      next.discardOptionPlayerIndex = null
      next.discarderIndex = null
      next.discardOptionAvailableAt = null
      next.currentPlayerIndex = (next.currentPlayerIndex + 1) % next.players.length
      return next
    })
  }

  const start = (opts?: { deckCount?: 2 | 3 }) => {
    setState((prev) => (prev.phase === 'lobby' ? buildMockState(opts?.deckCount) : prev))
  }

  const nextRound = () => {
    setState((prev) =>
      prev.phase === 'round_end' ? buildMockState(prev.deckCount, prev.round + 1) : prev
    )
  }

  const debugSkipRound = () => {
    setState((prev) => {
      if (prev.phase !== 'playing') return prev
      const roundScores: Record<string, number> = {}
      prev.players.forEach((p) => { roundScores[p.id] = 0 })
      return { ...prev, phase: 'round_end' as const, roundScores }
    })
  }

  const setSeat = (_seatIndex: number) => {}

  const leave = () => {}

  return {
    state,
    socketId,
    start,
    draw,
    playMelds,
    addToMeld,
    swapJoker,
    discard,
    takeDiscard,
    passDiscard,
    leave,
    nextRound,
    debugSkipRound,
    setSeat,
  }
}

function buildMockState(deckCount: 2 | 3 = 2, round = 1): GameState {
  const myId = 'dev-player-1'
  const otherId = 'dev-player-2'
  const cardsThisRound = 7 + round - 1
  // Continental ranks: 2–10, J=11, Q=12, K=13, A=14. Joker=0.
  const myHand: Card[] = []
  for (let i = 0; i < cardsThisRound; i++) {
    myHand.push(makeCard(SUITS[i % 4] ?? 'hearts', (i % 13) + 2))
  }
  myHand.push(makeCard('joker', 0, true))
  const otherHand: Card[] = []
  for (let i = 0; i < cardsThisRound; i++) {
    otherHand.push(makeCard(SUITS[(i + 2) % 4] ?? 'hearts', ((i + 5) % 13) + 2))
  }
  const topDiscard = makeCard('spades', 7)
  const totalCards = (deckCount === 2 ? 108 : 162) - cardsThisRound * 2 - 1
  return {
    roomId: 'dev-conti',
    phase: 'playing',
    round,
    contract: {
      round,
      minCards: cardsThisRound,
      requirements: [
        { type: 'trio', minLength: 3 },
        { type: 'straight', minLength: 3 },
      ],
    },
    players: [
      { id: myId, name: 'You', score: 0, hand: myHand, connected: true, seatIndex: 0 },
      { id: otherId, name: 'Opponent', score: 0, hand: otherHand, connected: true, seatIndex: 1 },
    ],
    currentPlayerIndex: 0,
    melds: [],
    stockCount: Math.max(0, totalCards),
    discardPile: [topDiscard],
    topDiscard,
    dealerIndex: 0,
    roundScores: {},
    deckCount,
  }
}
