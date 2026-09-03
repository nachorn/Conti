import { useState } from 'react'
import { CONTINENTAL_ROUNDS } from '@shared/types'
import type { ActionResult, Card, GameState, Meld } from './types'
import {
  findMeldsForContract,
  isValidMeld,
  replaceAndMoveJokerToStraightEnd,
  replaceJokerInStraight,
} from './lib/meld'

function makeId(): string {
  return Math.random().toString(36).slice(2, 11)
}

function makeCard(suit: Card['suit'], rank: number, isWild = false): Card {
  const wild = isWild || suit === 'joker'
  return { id: makeId(), suit, rank, ...(wild ? { isWild: true } : {}) }
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
      if ((next.currentPlayerHasDrawn ?? false)) return prev
      if (fromDiscard && next.topDiscard) {
        next.players[0] = { ...me, hand: [...me.hand, next.topDiscard!] }
        next.discardPile = next.discardPile.slice(0, -1)
        next.topDiscard = (next.discardPile as Card[]).slice(-1)[0] ?? null
      } else {
        const stockCard = makeCard('hearts', (prev.stockCount % 13) + 2)
        next.players[0] = { ...me, hand: [...me.hand, stockCard] }
        next.stockCount = Math.max(0, next.stockCount - 1)
      }
      next.currentPlayerHasDrawn = true
      next.hasHadTurn = [...(next.hasHadTurn ?? [false, false])]
      next.hasHadTurn[0] = true
      next.currentPlayerIndex = 1
      next.discardOptionPlayerIndex = null
      next.discarderIndex = null
      return next
    })
  }

  const discard = (cardId: string) => {
    setState((prev) => {
      const next = { ...prev }
      const me = next.players[0]
      if (!me || next.phase !== 'playing' || next.currentPlayerIndex !== 0) return prev
      if (!(next.currentPlayerHasDrawn ?? true)) return prev
      const card = me.hand.find((c) => c.id === cardId)
      if (!card) return prev
      next.players[0] = { ...me, hand: me.hand.filter((c) => c.id !== cardId) }
      next.discardPile = [...next.discardPile, card]
      next.topDiscard = card
      next.currentPlayerIndex = 1
      next.discarderIndex = 0
      next.discardOptionPlayerIndex = 1
      next.currentPlayerHasDrawn = false
      return next
    })
  }

  const playMelds = (melds: { type: 'trio' | 'straight'; cards: Card[] }[]) => {
    setState((prev) => {
      const next = { ...prev }
      const me = next.players[0]
      if (!me || next.phase !== 'playing' || next.currentPlayerIndex !== 0) return prev
      if (next.melds.some((meld) => meld.ownerId === me.id)) return prev
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

  const addToMeld = async (meldId: string, cards: Card[]): Promise<ActionResult> => {
    if (state.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (state.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const playerIndex = state.players.findIndex((player) => player.id === socketId)
    const me = state.players[playerIndex]
    if (!me || state.currentPlayerIndex !== playerIndex) return { ok: false, error: 'Not your turn' }
    if (!state.currentPlayerHasDrawn) return { ok: false, error: 'Draw first before adding to a meld' }
    if (!state.melds.some((item) => item.ownerId === me.id)) {
      return { ok: false, error: 'You must play your melds before adding to melds' }
    }
    const targetMeld = state.melds.find((item) => item.id === meldId)
    if (!targetMeld) return { ok: false, error: 'Meld not found' }
    if (!Array.isArray(cards) || cards.length === 0) return { ok: false, error: 'No cards submitted' }

    const selectedIds = new Set<string>()
    const selectedCards: Card[] = []
    for (const submittedCard of cards) {
      if (!submittedCard || typeof submittedCard.id !== 'string') {
        return { ok: false, error: 'Invalid card payload' }
      }
      if (selectedIds.has(submittedCard.id)) return { ok: false, error: 'Card submitted more than once' }
      const actualCard = me.hand.find((card) => card.id === submittedCard.id)
      if (!actualCard) return { ok: false, error: 'Card not in hand' }
      selectedIds.add(actualCard.id)
      selectedCards.push(actualCard)
    }

    const combined = [...targetMeld.cards, ...selectedCards]
    if (!isValidMeld(targetMeld.type, combined)) {
      return { ok: false, error: 'Invalid meld with new cards' }
    }

    const players = [...state.players]
    players[playerIndex] = { ...me, hand: me.hand.filter((card) => !selectedIds.has(card.id)) }
    const melds = state.melds.map((item) =>
      item.id === meldId ? { ...item, cards: combined } : item
    )
    const playedOutstandingJoker =
      state.swappedJokerPlayerId === me.id &&
      state.swappedJokerCardId != null &&
      selectedIds.has(state.swappedJokerCardId)

    setState({
      ...state,
      players,
      melds,
      ...(playedOutstandingJoker
        ? { swappedJokerCardId: null, swappedJokerPlayerId: null }
        : {}),
    })
    return { ok: true }
  }

  const swapJoker = async (
    meldId: string,
    cardId: string,
    jokerCardId: string
  ): Promise<ActionResult> => {
    if (state.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (state.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const playerIndex = state.players.findIndex((player) => player.id === socketId)
    const me = state.players[playerIndex]
    if (!me || state.currentPlayerIndex !== playerIndex) return { ok: false, error: 'Not your turn' }
    if (!state.currentPlayerHasDrawn) return { ok: false, error: 'Draw first before swapping a joker' }
    if (state.swappedJokerPlayerId === me.id && state.swappedJokerCardId != null) {
      return { ok: false, error: 'Play the joker you already took before swapping another one' }
    }
    const hasPlayedMeld = state.melds.some((item) => item.ownerId === me.id)

    const targetMeld = state.melds.find((item) => item.id === meldId)
    if (!targetMeld) return { ok: false, error: 'Meld not found' }
    if (targetMeld.type !== 'straight') return { ok: false, error: 'Jokers can only be swapped from straights' }
    const jokerIndex = targetMeld.cards.findIndex((card) => card.id === jokerCardId)
    const joker = targetMeld.cards[jokerIndex]
    if (jokerIndex < 0 || !joker || joker.suit !== 'joker') {
      return { ok: false, error: 'Joker not found in meld' }
    }

    const replacementCard = me.hand.find((card) => card.id === cardId)
    if (!replacementCard) return { ok: false, error: 'Card not in hand' }
    if (replacementCard.suit === 'joker' || replacementCard.rank === 0) {
      return { ok: false, error: 'Select a natural card to replace the joker' }
    }
    const players = [...state.players]
    if (hasPlayedMeld) {
      const relocatedCards = replaceAndMoveJokerToStraightEnd(
        targetMeld.cards,
        jokerCardId,
        replacementCard
      )
      if (!relocatedCards) {
        return { ok: false, error: 'The Joker must remain at an open end of the same straight' }
      }
      players[playerIndex] = {
        ...me,
        hand: me.hand.filter((card) => card.id !== replacementCard.id),
      }
      setState({
        ...state,
        players,
        melds: state.melds.map((item) =>
          item.id === meldId ? { ...item, cards: relocatedCards } : item
        ),
      })
    } else {
      const replacement = replaceJokerInStraight(targetMeld.cards, jokerCardId, replacementCard)
      if (!replacement) return { ok: false, error: 'Card cannot replace that joker' }
      const handAfterSwap = [...me.hand.filter((card) => card.id !== replacementCard.id), replacement.joker]
      if (!findMeldsForContract(handAfterSwap, state.contract, replacement.joker.id)) {
        return { ok: false, error: 'You can only take the Joker if you can play your full contract this turn' }
      }
      players[playerIndex] = { ...me, hand: handAfterSwap }
      setState({
        ...state,
        players,
        melds: state.melds.map((item) =>
          item.id === meldId ? { ...item, cards: replacement.cards } : item
        ),
        swappedJokerCardId: replacement.joker.id,
        swappedJokerPlayerId: me.id,
      })
    }
    return { ok: true }
  }

  const takeDiscard = () => {
    setState((prev) => {
      const next = { ...prev }
      const idx = next.discardOptionPlayerIndex ?? 0
      const me = next.players[idx]
      if (!me || !next.topDiscard) return prev
      next.players[idx] = { ...me, hand: [...me.hand, next.topDiscard!] }
      next.discardPile = next.discardPile.slice(0, -1)
      next.topDiscard = (next.discardPile as Card[]).slice(-1)[0] ?? null
      next.hasHadTurn = [...(next.hasHadTurn ?? [false, false])]
      next.hasHadTurn[idx] = true
      next.currentPlayerHasDrawn = true
      next.currentPlayerIndex = idx
      next.discardOptionPlayerIndex = null
      next.discarderIndex = null
      return next
    })
  }

  const passDiscard = () => {
    setState((prev) => {
      const next = { ...prev }
      const n = next.players.length
      const optionIndex = next.discardOptionPlayerIndex ?? 0
      const nextOption = (optionIndex + 1) % n
      const discarderIndex = next.discarderIndex ?? next.dealerIndex ?? 0
      const fullCircle = nextOption === discarderIndex
      if (fullCircle) {
        next.discardOptionPlayerIndex = null
        next.discarderIndex = null
        next.currentPlayerIndex = (discarderIndex + 1) % n
        next.currentPlayerHasDrawn = false
      } else {
        next.discardOptionPlayerIndex = nextOption
      }
      return next
    })
  }

  const start = (opts?: { deckCount?: 2 | 3 }) => {
    setState((prev) => (prev.phase === 'lobby' ? buildMockState(opts?.deckCount) : prev))
  }

  const nextRound = () => {
    setState((prev) =>
      prev.phase === 'round_end'
        ? prev.round >= 7 ? { ...prev, phase: 'game_end' as const } : buildMockState(prev.deckCount, prev.round + 1)
        : prev
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
  // The local preview starts mid-turn with representative melds so responsive
  // add/replace interactions can be exercised without playing through a room.
  const myHand: Card[] = [
    makeCard('hearts', 4),
    makeCard('hearts', 6),
    makeCard('hearts', 7),
    makeCard('clubs', 8),
    makeCard('diamonds', 10),
    makeCard('spades', 12),
    makeCard('clubs', 14),
    makeCard('joker', 0, true),
  ]
  const otherHand: Card[] = []
  for (let i = 0; i < cardsThisRound; i++) {
    otherHand.push(makeCard(SUITS[(i + 2) % 4] ?? 'hearts', ((i + 5) % 13) + 2))
  }
  const topDiscard = makeCard('spades', 7)
  const melds: Meld[] = [
    {
      id: makeId(),
      type: 'trio',
      ownerId: myId,
      cards: [makeCard('hearts', 13), makeCard('diamonds', 13), makeCard('spades', 13)],
    },
    {
      id: makeId(),
      type: 'straight',
      ownerId: otherId,
      cards: [makeCard('hearts', 2), makeCard('hearts', 3), makeCard('joker', 0, true), makeCard('hearts', 5)],
    },
    {
      id: makeId(),
      type: 'trio',
      ownerId: otherId,
      cards: [makeCard('hearts', 8), makeCard('diamonds', 8), makeCard('spades', 8)],
    },
  ]
  const dealtCardCount = myHand.length + otherHand.length + melds.reduce((sum, meld) => sum + meld.cards.length, 0) + 1
  const totalCards = (deckCount === 2 ? 110 : 165) - dealtCardCount
  return {
    roomId: 'dev-conti',
    phase: 'playing',
    round,
    contract: CONTINENTAL_ROUNDS[round - 1] ?? CONTINENTAL_ROUNDS[0]!,
    players: [
      { id: myId, name: 'You', score: 0, hand: myHand, connected: true, seatIndex: 0 },
      { id: otherId, name: 'Opponent', score: 0, hand: otherHand, connected: true, seatIndex: 1 },
    ],
    currentPlayerIndex: 0,
    melds,
    stockCount: Math.max(0, totalCards),
    discardPile: [topDiscard],
    topDiscard,
    dealerIndex: 0,
    roundScores: {},
    deckCount,
    discardOptionPlayerIndex: null,
    discarderIndex: null,
    discardOptionAvailableAt: null,
    firstTurnIndex: 0,
    hasHadTurn: [true, true],
    currentPlayerHasDrawn: true,
  }
}
