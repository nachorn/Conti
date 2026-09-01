import { v4 as uuidv4 } from 'uuid'
import type { Card, GameState, Meld, Player } from './types.js'
import { CONTINENTAL_ROUNDS, type GamePhase, type RoundContract } from './types.js'
import { createContinentalDeck, draw } from './game/deck.js'
import { canReplaceJokerInMeld, canSatisfyContractWithHand, getContract, isValidMeld, satisfiesContract } from './game/meld.js'
import { handPenalty } from './game/scoring.js'

const CARDS_ROUND_1 = 7
const MIN_PLAYERS = 2
const MAX_PLAYERS = 10
/** Win in same turn as playing meld: -10 * round. Win in a later turn: -10. */
const WIN_BONUS_SAME_TURN_MULTIPLIER = 10
const WIN_BONUS_OTHER = -10
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
  turnDeadline: number | null = null
  /** If set, this player swapped a joker this turn and must play it in a meld before discarding. */
  swappedJokerCardId: string | null = null
  swappedJokerPlayerId: string | null = null
  /** For each player index: has had a turn this round (drawn). No melds until all true. */
  hasHadTurn: boolean[] = []
  /** Current player has drawn this turn. Must be true before meld/discard. */
  currentPlayerHasDrawn: boolean = false
  /** Current player played contract meld this turn (for same-turn win scoring). */
  playedMeldThisTurn: boolean = false

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
    const removedIndex = this.players.findIndex(p => p.id === id)
    if (removedIndex < 0) return

    this.players.splice(removedIndex, 1)
    this.hasHadTurn.splice(removedIndex, 1)
    delete this.roundScores[id]
    delete this.roundPenalties[id]

    if (this.swappedJokerPlayerId === id) {
      this.swappedJokerCardId = null
      this.swappedJokerPlayerId = null
    }

    if (this.players.length === 0) {
      this.phase = 'lobby'
      this.currentPlayerIndex = 0
      this.dealerIndex = 0
      this.discardOptionPlayerIndex = null
      this.discarderIndex = null
      this.turnDeadline = null
      return
    }

    const remapIndex = (index: number): number => {
      if (index > removedIndex) return index - 1
      if (index === removedIndex) return index % this.players.length
      return index
    }
    this.currentPlayerIndex = remapIndex(this.currentPlayerIndex)
    this.dealerIndex = remapIndex(this.dealerIndex)
    if (this.discardOptionPlayerIndex !== null) {
      this.discardOptionPlayerIndex = remapIndex(this.discardOptionPlayerIndex)
    }
    if (this.discarderIndex !== null) this.discarderIndex = remapIndex(this.discarderIndex)

    // A multiplayer round cannot continue with only one participant.
    if (this.phase === 'playing' && this.players.length < MIN_PLAYERS) {
      this.phase = 'game_end'
      this.discardOptionPlayerIndex = null
      this.discarderIndex = null
      this.turnDeadline = null
    } else if (this.phase === 'playing') {
      this.resetTurnDeadline()
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

  resetTurnDeadline(): void {
    if (this.phase !== 'playing' || this.secondsPerTurn <= 0) {
      this.turnDeadline = null
      return
    }
    const normalDeadline = Date.now() + this.secondsPerTurn * 1000
    this.turnDeadline = Math.max(normalDeadline, this.discardOptionAvailableAt ?? 0)
  }

  startGame(): boolean {
    if (this.phase !== 'lobby' || this.players.length < MIN_PLAYERS) return false
    this.phase = 'playing'
    this.round = 1
    this.roundScores = {}
    return this.startRound()
  }

  cardsPerPlayerThisRound(): number {
    return CARDS_ROUND_1 + this.round - 1
  }

  /** @param overrideFirstTurnIndex When set (e.g. from nextRound), first turn is this index; otherwise random. */
  startRound(overrideFirstTurnIndex?: number): boolean {
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
    const firstTurnIndex =
      typeof overrideFirstTurnIndex === 'number' && overrideFirstTurnIndex >= 0 && overrideFirstTurnIndex < n
        ? overrideFirstTurnIndex
        : Math.floor(Math.random() * n)
    this.dealerIndex = firstTurnIndex
    this.hasHadTurn = this.players.map(() => false)
    this.currentPlayerHasDrawn = false
    this.playedMeldThisTurn = false

    const deck = createContinentalDeck(n, this.deckCount)
    const total = cardsPer * n
    const { drawn: handCards, remaining: afterHands } = draw(deck, total)
    for (const p of this.players) p.hand = []
    for (let i = 0; i < handCards.length; i++) {
      const seat = (firstTurnIndex + i) % n
      const card = handCards[i]
      if (card) this.players[seat]!.hand.push(card)
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

    this.currentPlayerIndex = firstTurnIndex
    if (n >= 2 && this.topDiscard) {
      this.discardOptionPlayerIndex = firstTurnIndex
      this.discardOptionAvailableAt =
        this.discardOptionDelaySeconds > 0
          ? Date.now() + this.discardOptionDelaySeconds * 1000
          : null
    }
    this.resetTurnDeadline()
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
    if (this.currentPlayerHasDrawn) return { ok: false, error: 'You already drew this turn' }
    if (fromDiscard) {
      if (!this.topDiscard) return { ok: false, error: 'No discard' }
      cp.hand.push(this.topDiscard)
      this.discardPile.pop()
      this.topDiscard = this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1]! : null
    } else {
      if (this.stock.length === 0) {
        if (this.discardPile.length === 0) {
          this.endRound(null, false)
          return { ok: true }
        }
        this.stock = this.discardPile.slice(0, -1).reverse()
        this.discardPile = this.topDiscard ? [this.topDiscard] : []
      }
      const { drawn: drawnCards, remaining } = draw(this.stock, 1)
      this.stock = remaining
      if (drawnCards[0]) cp.hand.push(drawnCards[0])
    }
    this.currentPlayerHasDrawn = true
    this.hasHadTurn[this.currentPlayerIndex] = true
    return { ok: true }
  }

  takeDiscard(playerId: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing' || this.discardOptionPlayerIndex === null) {
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
    const turnPlayerIndex = this.discarderIndex !== null ? (this.discarderIndex + 1) % n : this.dealerIndex
    const isPriority = optionIndex === turnPlayerIndex

    p.hand.push(this.topDiscard)
    this.discardPile.pop()
    this.topDiscard = this.discardPile.length > 0 ? this.discardPile[this.discardPile.length - 1]! : null
    this.hasHadTurn[optionIndex] = true
    this.currentPlayerHasDrawn = true
    this.playedMeldThisTurn = false

    if (!isPriority) {
      this.roundPenalties[playerId] = (this.roundPenalties[playerId] ?? 0) + OUT_OF_TURN_DISCARD_PENALTY
      const { drawn: penaltyDraw, remaining: stockAfterPenalty } = draw(this.stock, 1)
      this.stock = stockAfterPenalty
      if (penaltyDraw[0]) p.hand.push(penaltyDraw[0])
    }
    this.currentPlayerIndex = optionIndex
    this.discardOptionPlayerIndex = null
    this.discarderIndex = null
    this.discardOptionAvailableAt = null
    this.resetTurnDeadline()
    return { ok: true }
  }

  passDiscard(playerId: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing' || this.discardOptionPlayerIndex === null) {
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
    const discarderIndex = this.discarderIndex
    const fullCircle = discarderIndex !== null ? nextOption === discarderIndex : nextOption === this.dealerIndex
    if (fullCircle) {
      this.discardOptionPlayerIndex = null
      this.discardOptionAvailableAt = null
      this.currentPlayerIndex = discarderIndex !== null ? (discarderIndex + 1) % n : this.dealerIndex
      this.discarderIndex = null
      this.currentPlayerHasDrawn = false
    } else {
      this.discardOptionPlayerIndex = nextOption
    }
    this.resetTurnDeadline()
    return { ok: true }
  }

  playMelds(playerId: string, melds: { type: Meld['type']; cards: Card[] }[]): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (this.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (!this.currentPlayerHasDrawn) return { ok: false, error: 'Draw first before playing a meld' }
    const n = this.players.length
    const everyoneHadTurn = this.hasHadTurn.length === n && this.hasHadTurn.every(Boolean)
    if (!everyoneHadTurn) return { ok: false, error: 'Everyone must have had a turn before any meld can be played' }
    if (!Array.isArray(melds) || melds.length === 0) return { ok: false, error: 'No melds submitted' }

    // Resolve every submitted ID to the canonical server-owned card. Never trust
    // card ranks, suits, wild flags, or IDs supplied only by the client.
    const handById = new Map(cp.hand.map(card => [card.id, card]))
    const usedCardIds = new Set<string>()
    const resolvedMelds: { type: Meld['type']; cards: Card[] }[] = []
    for (const meld of melds) {
      if ((meld.type !== 'trio' && meld.type !== 'straight') || !Array.isArray(meld.cards)) {
        return { ok: false, error: 'Invalid meld payload' }
      }
      const resolvedCards: Card[] = []
      for (const submittedCard of meld.cards) {
        if (!submittedCard || typeof submittedCard.id !== 'string') return { ok: false, error: 'Invalid card payload' }
        if (usedCardIds.has(submittedCard.id)) return { ok: false, error: 'A card cannot be used in more than one meld' }
        const actualCard = handById.get(submittedCard.id)
        if (!actualCard) return { ok: false, error: 'Card not in hand' }
        usedCardIds.add(actualCard.id)
        resolvedCards.push(actualCard)
      }
      resolvedMelds.push({ type: meld.type, cards: resolvedCards })
    }

    if (this.swappedJokerPlayerId === playerId && this.swappedJokerCardId !== null) {
      const playedIds = new Set<string>()
      for (const m of resolvedMelds) for (const c of m.cards) playedIds.add(c.id)
      if (!playedIds.has(this.swappedJokerCardId)) {
        return { ok: false, error: 'You must play the joker you took in a meld this turn' }
      }
    }
    if (!satisfiesContract(resolvedMelds, this.contract)) {
      return { ok: false, error: 'You must play the full contract at once' }
    }
    for (const m of resolvedMelds) {
      if (!isValidMeld(m.type, m.cards)) return { ok: false, error: `Invalid ${m.type} meld` }
    }
    cp.hand = cp.hand.filter(card => !usedCardIds.has(card.id))
    for (const m of resolvedMelds) {
      this.melds.push({
        id: uuidv4(),
        type: m.type,
        cards: m.cards,
        ownerId: playerId,
      })
    }
    this.playedMeldThisTurn = true
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
    if (!this.currentPlayerHasDrawn) return { ok: false, error: 'Draw first before adding to a meld' }
    if (!this.melds.some(m => m.ownerId === playerId)) return { ok: false, error: 'You must play your melds before adding to melds' }
    const meld = this.melds.find(m => m.id === meldId)
    if (!meld) return { ok: false, error: 'Meld not found' }
    if (!Array.isArray(cards) || cards.length === 0) return { ok: false, error: 'No cards submitted' }
    const cardIds = new Set<string>()
    const resolvedCards: Card[] = []
    for (const submittedCard of cards) {
      if (!submittedCard || typeof submittedCard.id !== 'string') return { ok: false, error: 'Invalid card payload' }
      if (cardIds.has(submittedCard.id)) return { ok: false, error: 'Card submitted more than once' }
      const actualCard = cp.hand.find(card => card.id === submittedCard.id)
      if (!actualCard) return { ok: false, error: 'Card not in hand' }
      cardIds.add(actualCard.id)
      resolvedCards.push(actualCard)
    }
    const combined = [...meld.cards, ...resolvedCards]
    if (!isValidMeld(meld.type, combined)) return { ok: false, error: 'Invalid meld with new cards' }
    cp.hand = cp.hand.filter(card => !cardIds.has(card.id))
    meld.cards = combined
    if (this.swappedJokerPlayerId === playerId && this.swappedJokerCardId !== null && resolvedCards.some(c => c.id === this.swappedJokerCardId)) {
      this.swappedJokerCardId = null
      this.swappedJokerPlayerId = null
    }
    if (cp.hand.length === 0) {
      this.roundEnderId = playerId
      this.endRound(playerId, this.playedMeldThisTurn)
    }
    return { ok: true }
  }

  swapJoker(playerId: string, meldId: string, cardIdFromHand: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (this.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (!this.currentPlayerHasDrawn) return { ok: false, error: 'Draw first before swapping a joker' }
    const meld = this.melds.find(m => m.id === meldId)
    if (!meld) return { ok: false, error: 'Meld not found' }
    const jokerIdx = meld.cards.findIndex(c => c.suit === 'joker')
    if (jokerIdx < 0) return { ok: false, error: 'Meld has no joker' }
    const cardIdx = cp.hand.findIndex(c => c.id === cardIdFromHand)
    if (cardIdx < 0) return { ok: false, error: 'Card not in hand' }
    const card = cp.hand[cardIdx]!
    if (!canReplaceJokerInMeld(meld, card)) return { ok: false, error: 'Card cannot replace that joker' }
    const joker = meld.cards[jokerIdx]!
    const handAfterSwap = cp.hand.filter(c => c.id !== card.id).concat([joker])
    if (!canSatisfyContractWithHand(handAfterSwap, this.contract)) {
      return { ok: false, error: 'You can only swap if you can play your full meld with the joker' }
    }
    meld.cards[jokerIdx] = card
    cp.hand.splice(cardIdx, 1)
    cp.hand.push(joker)
    this.swappedJokerCardId = joker.id
    this.swappedJokerPlayerId = playerId
    return { ok: true }
  }

  discard(playerId: string, cardId: string, force = false): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    if (this.discardOptionPlayerIndex !== null) return { ok: false, error: 'Take or pass discard first' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    if (!this.currentPlayerHasDrawn) return { ok: false, error: 'Draw first before discarding' }
    if (!force && this.swappedJokerPlayerId === playerId && this.swappedJokerCardId !== null) {
      const stillHasJoker = cp.hand.some(c => c.id === this.swappedJokerCardId)
      if (stillHasJoker) return { ok: false, error: 'Play the joker you took in a meld before discarding' }
    }
    const idx = cp.hand.findIndex(c => c.id === cardId)
    if (idx < 0) return { ok: false, error: 'Card not in hand' }
    const card = cp.hand[idx]!
    const hasPlayedMeld = this.melds.some(m => m.ownerId === playerId)
    if (!force && !hasPlayedMeld) {
      for (const m of this.melds) {
        if (isValidMeld(m.type, [...m.cards, card])) {
          return { ok: false, error: "You can't discard that card—it can be added to a meld and you haven't played yours yet" }
        }
      }
    }
    cp.hand.splice(idx, 1)
    const sameTurnWin = this.playedMeldThisTurn
    if (card) {
      this.discardPile.push(card)
      this.topDiscard = card
    }
    if (cp.hand.length === 0) {
      this.roundEnderId = playerId
      this.endRound(playerId, sameTurnWin)
      return { ok: true }
    }
    const n = this.players.length
    this.currentPlayerHasDrawn = false
    this.playedMeldThisTurn = false
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
    this.resetTurnDeadline()
    return { ok: true }
  }

  /** Resolve an expired turn on the server so a disconnected client cannot stall a room. */
  handleTurnTimeout(now = Date.now()): boolean {
    if (this.phase !== 'playing' || this.turnDeadline === null || now < this.turnDeadline) return false

    if (this.discardOptionPlayerIndex !== null) {
      const optionPlayer = this.players[this.discardOptionPlayerIndex]
      if (!optionPlayer) return false
      return this.passDiscard(optionPlayer.id).ok
    }

    const currentPlayer = this.players[this.currentPlayerIndex]
    if (!currentPlayer) return false
    if (!this.currentPlayerHasDrawn) {
      const drawResult = this.draw(currentPlayer.id, false)
      if (!drawResult.ok || this.phase !== 'playing') return drawResult.ok
    }

    const cardToDiscard = currentPlayer.hand.find(card => card.id !== this.swappedJokerCardId)
      ?? currentPlayer.hand[0]
    if (!cardToDiscard) return false
    return this.discard(currentPlayer.id, cardToDiscard.id, true).ok
  }

  endRound(winnerId: string | null, sameTurnWin: boolean): void {
    this.phase = 'round_end'
    this.turnDeadline = null
    this.discardOptionPlayerIndex = null
    this.discarderIndex = null
    for (const p of this.players) {
      const penalty = handPenalty(p.hand)
      const roundPen = this.roundPenalties[p.id] ?? 0
      if (p.id === winnerId) {
        this.roundScores[p.id] = sameTurnWin
          ? -this.round * WIN_BONUS_SAME_TURN_MULTIPLIER
          : WIN_BONUS_OTHER
      } else {
        this.roundScores[p.id] = penalty + roundPen
      }
      p.score += this.roundScores[p.id]!
    }
  }

  debugSkipRound(): boolean {
    if (this.phase !== 'playing') return false
    this.roundEnderId = null
    this.endRound(null, false)
    return true
  }

  nextRound(): boolean {
    if (this.phase !== 'round_end') return false
    const n = this.players.length
    const enderIdx = this.roundEnderId != null ? this.players.findIndex((p) => p.id === this.roundEnderId) : -1
    const firstTurnNext = enderIdx >= 0 ? (enderIdx + 1) % n : undefined
    this.round++
    if (this.round > 7) {
      this.phase = 'game_end'
      this.turnDeadline = null
      return false
    }
    this.phase = 'playing'
    return this.startRound(firstTurnNext)
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
      turnDeadline: this.turnDeadline,
      swappedJokerCardId: this.swappedJokerCardId,
      swappedJokerPlayerId: this.swappedJokerPlayerId,
      firstTurnIndex: this.dealerIndex,
      hasHadTurn: this.hasHadTurn,
      currentPlayerHasDrawn: this.currentPlayerHasDrawn,
      playedMeldThisTurn: this.playedMeldThisTurn,
    }
  }
}
