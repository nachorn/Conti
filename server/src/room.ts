import { v4 as uuidv4 } from 'uuid'
import type { Card, GameState, Meld, Player } from './types.js'
import { CONTINENTAL_ROUNDS, type GamePhase, type RoundContract } from './types.js'
import { createContinentalDeck, draw } from './game/deck.js'
import { canReplaceJokerInMeld, getContract, isValidMeld, satisfiesContract } from './game/meld.js'
import { handPenalty } from './game/scoring.js'

const CARDS_ROUND_1 = 7
const MIN_PLAYERS = 2
const MAX_PLAYERS = 10
const WIN_BONUS = -10
const OUT_OF_TURN_DISCARD_PENALTY = 10

export type GameType = 'continental' | 'pocha'

export interface RoomOptions {
  roomId?: string
  gameType?: GameType
  maxPlayers?: number
  deckCount?: 2 | 3
  discardOptionDelaySeconds?: number
  secondsPerTurn?: number
}

export class Room {
  roomId: string
  gameType: GameType
  maxPlayers: number
  deckCount: 2 | 3
  players: Player[] = []
  phase: GamePhase = 'lobby'
  round: number = 1
  contract: RoundContract = CONTINENTAL_ROUNDS[0]!
  currentPlayerIndex: number = 0
  dealerIndex: number = 0
  melds: Meld[] = []
  stock: Card[] = []
  discardPile: Card[] = []
  topDiscard: Card | null = null
  roundScores: Record<string, number> = {}
  roundPenalties: Record<string, number> = {}
  roundEnderId: string | null = null
  /** When >2 players: who can take the discard or pass. */
  discardOptionPlayerIndex: number | null = null
  /** Who discarded (so we know who is "next" for take/pass). */
  discarderIndex: number | null = null
  /** Timestamp (ms) when take/pass becomes allowed. */
  discardOptionAvailableAt: number | null = null
  discardOptionDelaySeconds: number = 10
  secondsPerTurn: number = 0
  /** If set, this player swapped a joker this turn and must play it in a meld before discarding. */
  swappedJokerCardId: string | null = null
  swappedJokerPlayerId: string | null = null

  constructor(options: RoomOptions = {}) {
    this.roomId = options.roomId ?? ''
    this.gameType = options.gameType ?? 'continental'
    this.maxPlayers = Math.min(MAX_PLAYERS, options.maxPlayers ?? MAX_PLAYERS)
    this.deckCount = options.deckCount ?? 2
    this.discardOptionDelaySeconds = Math.max(0, Math.min(30, options.discardOptionDelaySeconds ?? 10))
    this.secondsPerTurn = Math.max(0, Math.min(120, options.secondsPerTurn ?? 0))
  }

  addPlayer(id: string, name: string): boolean {
    if (this.phase !== 'lobby' || this.players.length >= this.maxPlayers) return false
    if (this.players.some(p => p.id === id)) return true
    const taken = new Set(this.players.map(p => p.seatIndex))
    let seatIndex = 0
    while (taken.has(seatIndex) && seatIndex < this.maxPlayers) seatIndex++
    this.players.push({
      id,
      name: name.slice(0, 24) || 'Player',
      score: 0,
      hand: [],
      connected: true,
      seatIndex,
    })
    return true
  }

  setSeat(playerId: string, seatIndex: number): boolean {
    if (this.phase !== 'lobby') return false
    if (seatIndex < 0 || seatIndex >= this.maxPlayers) return false
    const p = this.players.find(x => x.id === playerId)
    if (!p) return false
    const taken = this.players.some(q => q.id !== playerId && q.seatIndex === seatIndex)
    if (taken) return false
    p.seatIndex = seatIndex
    return true
  }

  removePlayer(id: string): void {
    this.players = this.players.filter(p => p.id !== id)
    if (this.players.length === 0) this.phase = 'lobby'
    else if (this.phase === 'playing') {
      const idx = this.players.findIndex(p => p.id === id)
      if (idx >= 0 && this.currentPlayerIndex >= this.players.length) {
        this.currentPlayerIndex = this.players.length - 1
      }
    }
  }

  setConnected(id: string, connected: boolean): void {
    const p = this.players.find(x => x.id === id)
    if (p) p.connected = connected
  }

  setDeckCount(count: 2 | 3): void {
    if (this.phase !== 'lobby') return
    this.deckCount = count
  }

  setDiscardOptionDelaySeconds(secs: number): void {
    if (this.phase !== 'lobby') return
    this.discardOptionDelaySeconds = Math.max(0, Math.min(30, secs))
  }

  setSecondsPerTurn(secs: number): void {
    if (this.phase !== 'lobby') return
    this.secondsPerTurn = Math.max(0, Math.min(120, secs))
  }

  startGame(): boolean {
    if (this.phase !== 'lobby' || this.players.length < MIN_PLAYERS) return false
    this.phase = 'playing'
    this.round = 1
    this.roundScores = {}
    if (!this.determineDealer()) return false
    return this.startRound()
  }

  /** Each player draws one card; highest rank is dealer (ace high). Ties: first wins. */
  determineDealer(): boolean {
    const n = this.players.length
    const deck = createContinentalDeck(n, this.deckCount)
    const { drawn: dealCards, remaining } = draw(deck, n)
    let maxRank = -1
    let dealerIdx = 0
    for (let i = 0; i < n; i++) {
      const r = dealCards[i]?.rank ?? -1
      if (r > maxRank) {
        maxRank = r
        dealerIdx = i
      }
    }
    this.dealerIndex = dealerIdx
    return true
  }

  cardsPerPlayerThisRound(): number {
    return CARDS_ROUND_1 + this.round - 1
  }

  startRound(): boolean {
    this.contract = getContract(this.round)
    this.melds = []
    this.roundEnderId = null
    this.roundPenalties = {}
    this.discardOptionPlayerIndex = null
    this.discarderIndex = null
    this.discardOptionAvailableAt = null
    this.swappedJokerCardId = null
    this.swappedJokerPlayerId = null
    const n = this.players.length
    const cardsPer = this.cardsPerPlayerThisRound()
    const deck = createContinentalDeck(n, this.deckCount)
    const total = cardsPer * n
    const { drawn: handCards, remaining: afterHands } = draw(deck, total)
    for (const p of this.players) p.hand = []
    for (let i = 0; i < handCards.length; i++) {
      const rec = (this.dealerIndex - 1 - (i % n) + 2 * n) % n
      const card = handCards[i]
      if (card) this.players[rec]!.hand.push(card)
    }
    this.stock = afterHands
    this.discardPile = []
    this.topDiscard = null

    const { drawn: initialDiscard, remaining: stockAfter } = draw(this.stock, 1)
    this.stock = stockAfter
    if (initialDiscard[0]) {
      this.discardPile.push(initialDiscard[0])
      this.topDiscard = initialDiscard[0]
    }

    this.currentPlayerIndex = (this.dealerIndex + 1) % n
    if (n >= 2 && this.topDiscard) {
      this.discarderIndex = this.dealerIndex
      this.discardOptionPlayerIndex = (this.dealerIndex + 1) % n
      this.discardOptionAvailableAt =
        this.discardOptionDelaySeconds > 0
          ? Date.now() + this.discardOptionDelaySeconds * 1000
          : null
    }
    return true
  }

  draw(playerId: string, fromDiscard: boolean): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    const n = this.players.length
    if (this.discardOptionPlayerIndex !== null) {
      return { ok: false, error: 'Someone must take or pass the discard first' }
    }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (fromDiscard) {
      if (!this.topDiscard) return { ok: false, error: 'No discard' }
      cp.hand.push(this.topDiscard)
      this.discardPile.pop()
      this.topDiscard = this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1]! : null
    } else {
      if (this.stock.length === 0) {
        if (this.discardPile.length === 0) {
          this.endRound(null)
          return { ok: true }
        }
        this.stock = this.discardPile.slice(0, -1).reverse()
        this.discardPile = this.topDiscard ? [this.topDiscard] : []
      }
      const { drawn, remaining } = draw(this.stock, 1)
      this.stock = remaining
      if (drawn[0]) cp.hand.push(drawn[0])
    }
    return { ok: true }
  }

  takeDiscard(playerId: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing' || this.discardOptionPlayerIndex === null || this.discarderIndex === null) {
      return { ok: false, error: 'No discard to take' }
    }
    if (this.discardOptionAvailableAt !== null && Date.now() < this.discardOptionAvailableAt) {
      const secs = Math.ceil((this.discardOptionAvailableAt - Date.now()) / 1000)
      return { ok: false, error: `Wait ${secs}s before take/pass` }
    }
    const n = this.players.length
    const optionIndex = this.discardOptionPlayerIndex
    const p = this.players[optionIndex]
    if (!p || p.id !== playerId) return { ok: false, error: 'Not your option to take or pass' }
    if (!this.topDiscard) return { ok: false, error: 'No discard' }
    p.hand.push(this.topDiscard)
    this.discardPile.pop()
    this.topDiscard = this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1]! : null
    const turnPlayerIndex = (this.discarderIndex + 1) % n
    const isPriority = optionIndex === turnPlayerIndex
    if (!isPriority) {
      this.roundPenalties[playerId] = (this.roundPenalties[playerId] ?? 0) + OUT_OF_TURN_DISCARD_PENALTY
      const { drawn: penaltyDraw, remaining: stockAfterPenalty } = draw(this.stock, 1)
      this.stock = stockAfterPenalty
      if (penaltyDraw[0]) p.hand.push(penaltyDraw[0])
      const turnPlayer = this.players[turnPlayerIndex]
      if (turnPlayer) {
        const { drawn: turnDraw, remaining: stockAfterTurn } = draw(this.stock, 1)
        this.stock = stockAfterTurn
        if (turnDraw[0]) turnPlayer.hand.push(turnDraw[0])
      }
      this.currentPlayerIndex = turnPlayerIndex
    } else {
      this.currentPlayerIndex = optionIndex
    }
    this.discardOptionPlayerIndex = null
    this.discarderIndex = null
    this.discardOptionAvailableAt = null
    return { ok: true }
  }

  passDiscard(playerId: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing' || this.discardOptionPlayerIndex === null || this.discarderIndex === null) {
      return { ok: false, error: 'No discard to pass' }
    }
    if (this.discardOptionAvailableAt !== null && Date.now() < this.discardOptionAvailableAt) {
      const secs = Math.ceil((this.discardOptionAvailableAt - Date.now()) / 1000)
      return { ok: false, error: `Wait ${secs}s before take/pass` }
    }
    const n = this.players.length
    const optionIndex = this.discardOptionPlayerIndex
    const p = this.players[optionIndex]
    if (!p || p.id !== playerId) return { ok: false, error: 'Not your option to take or pass' }
    const nextOption = (optionIndex + 1) % n
    if (nextOption === this.discarderIndex) {
      this.discardOptionPlayerIndex = null
      this.discardOptionAvailableAt = null
      this.currentPlayerIndex = (this.discarderIndex + 1) % n
      this.discarderIndex = null
    } else {
      this.discardOptionPlayerIndex = nextOption
    }
    return { ok: true }
  }

  playMelds(playerId: string, melds: { type: Meld['type']; cards: Card[] }[]): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (this.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (this.swappedJokerPlayerId === playerId && this.swappedJokerCardId !== null) {
      const playedIds = new Set<string>()
      for (const m of melds) for (const c of m.cards) playedIds.add(c.id)
      if (!playedIds.has(this.swappedJokerCardId)) {
        return { ok: false, error: 'You must play the joker you took in a meld this turn' }
      }
    }
    if (!satisfiesContract(melds, this.contract)) {
      return { ok: false, error: 'You must play the full contract at once' }
    }
    const allCardIds = new Set<string>()
    for (const m of melds) {
      if (!isValidMeld(m.type, m.cards)) return { ok: false, error: `Invalid ${m.type} meld` }
      for (const c of m.cards) allCardIds.add(c.id)
    }
    for (const id of allCardIds) {
      const idx = cp.hand.findIndex(x => x.id === id)
      if (idx >= 0) cp.hand.splice(idx, 1)
    }
    for (const m of melds) {
      this.melds.push({
        id: uuidv4(),
        type: m.type,
        cards: m.cards,
        ownerId: playerId,
      })
    }
    if (this.swappedJokerPlayerId === playerId) {
      this.swappedJokerCardId = null
      this.swappedJokerPlayerId = null
    }
    return { ok: true }
  }

  addToMeld(playerId: string, meldId: string, cards: Card[]): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (this.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (!this.melds.some(m => m.ownerId === playerId)) return { ok: false, error: 'You must play your melds before adding to melds' }
    const meld = this.melds.find(m => m.id === meldId)
    if (!meld) return { ok: false, error: 'Meld not found' }
    const combined = [...meld.cards, ...cards]
    if (!isValidMeld(meld.type, combined)) return { ok: false, error: 'Invalid meld with new cards' }
    for (const c of cards) {
      const idx = cp.hand.findIndex(x => x.id === c.id)
      if (idx >= 0) cp.hand.splice(idx, 1)
    }
    meld.cards = combined
    if (this.swappedJokerPlayerId === playerId && this.swappedJokerCardId !== null && cards.some(c => c.id === this.swappedJokerCardId)) {
      this.swappedJokerCardId = null
      this.swappedJokerPlayerId = null
    }
    return { ok: true }
  }

  swapJoker(playerId: string, meldId: string, cardIdFromHand: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (this.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (!this.melds.some(m => m.ownerId === playerId)) return { ok: false, error: 'You must play your melds before swapping a joker' }
    const meld = this.melds.find(m => m.id === meldId)
    if (!meld) return { ok: false, error: 'Meld not found' }
    const jokerIdx = meld.cards.findIndex(c => c.isWild || c.suit === 'joker')
    if (jokerIdx < 0) return { ok: false, error: 'Meld has no joker' }
    const cardIdx = cp.hand.findIndex(c => c.id === cardIdFromHand)
    if (cardIdx < 0) return { ok: false, error: 'Card not in hand' }
    const card = cp.hand[cardIdx]!
    if (!canReplaceJokerInMeld(meld, card)) return { ok: false, error: 'Card cannot replace that joker' }
    const joker = meld.cards[jokerIdx]!
    meld.cards[jokerIdx] = card
    cp.hand.splice(cardIdx, 1)
    cp.hand.push(joker)
    this.swappedJokerCardId = joker.id
    this.swappedJokerPlayerId = playerId
    return { ok: true }
  }

  discard(playerId: string, cardId: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (this.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (this.swappedJokerPlayerId === playerId && this.swappedJokerCardId !== null) {
      const stillHasJoker = cp.hand.some(c => c.id === this.swappedJokerCardId)
      if (stillHasJoker) return { ok: false, error: 'Play the joker you took in a meld before discarding' }
    }
    const idx = cp.hand.findIndex(c => c.id === cardId)
    if (idx < 0) return { ok: false, error: 'Card not in hand' }
    const [card] = cp.hand.splice(idx, 1)
    if (card) {
      this.discardPile.push(card)
      this.topDiscard = card
    }
    if (cp.hand.length === 0) {
      this.roundEnderId = playerId
      this.endRound(playerId)
      return { ok: true }
    }
    const n = this.players.length
    if (n >= 2) {
      this.discarderIndex = this.currentPlayerIndex
      this.discardOptionPlayerIndex = (this.currentPlayerIndex + 1) % n
      this.discardOptionAvailableAt =
        this.discardOptionDelaySeconds > 0
          ? Date.now() + this.discardOptionDelaySeconds * 1000
          : null
    } else {
      this.currentPlayerIndex = (this.currentPlayerIndex + 1) % n
    }
    this.swappedJokerCardId = null
    this.swappedJokerPlayerId = null
    return { ok: true }
  }

  endRound(winnerId: string | null): void {
    this.phase = 'round_end'
    this.discardOptionPlayerIndex = null
    this.discarderIndex = null
    for (const p of this.players) {
      const penalty = handPenalty(p.hand)
      const roundPen = this.roundPenalties[p.id] ?? 0
      if (p.id === winnerId) {
        this.roundScores[p.id] = WIN_BONUS
      } else {
        this.roundScores[p.id] = penalty + roundPen
      }
      p.score += this.roundScores[p.id]!
    }
  }

  debugSkipRound(): boolean {
    if (this.phase !== 'playing') return false
    this.roundEnderId = null
    this.endRound(null)
    return true
  }

  nextRound(): boolean {
    if (this.phase !== 'round_end') return false
    this.round++
    if (this.round > 7) {
      this.phase = 'game_end'
      return false
    }
    this.dealerIndex = (this.dealerIndex + 1) % this.players.length
    this.phase = 'playing'
    return this.startRound()
  }

  getState(forPlayerId?: string): GameState {
    const players = this.players.map(p => ({
      ...p,
      hand: forPlayerId === p.id ? p.hand : p.hand.map(() => ({ id: 'hidden', suit: 'joker' as const, rank: 0 })),
    }))
    return {
      roomId: this.roomId,
      gameType: this.gameType,
      phase: this.phase,
      round: this.round,
      contract: this.contract,
      players,
      currentPlayerIndex: this.currentPlayerIndex,
      melds: this.melds,
      stockCount: this.stock.length,
      discardPile: [],
      topDiscard: this.topDiscard,
      dealerIndex: this.dealerIndex,
      roundScores: this.roundScores,
      discardOptionPlayerIndex: this.discardOptionPlayerIndex,
      discarderIndex: this.discarderIndex,
      discardOptionAvailableAt: this.discardOptionAvailableAt,
      deckCount: this.deckCount,
      discardOptionDelaySeconds: this.discardOptionDelaySeconds,
      secondsPerTurn: this.secondsPerTurn,
      swappedJokerCardId: this.swappedJokerCardId,
      swappedJokerPlayerId: this.swappedJokerPlayerId,
    }
  }
}
