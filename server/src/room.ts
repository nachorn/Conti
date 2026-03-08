import { v4 as uuidv4 } from 'uuid'
import type { Card, GameState, Meld, Player } from './types.js'
import { CONTINENTAL_ROUNDS, type GamePhase, type RoundContract } from './types.js'
import { createContinentalDeck, draw } from './game/deck.js'
import { getContract, isValidMeld, satisfiesContract } from './game/meld.js'
import { handPenalty } from './game/scoring.js'

const CARDS_PER_PLAYER = 6
const MIN_PLAYERS = 2
const MAX_PLAYERS = 10

export interface RoomOptions {
  roomId?: string
  maxPlayers?: number
}

export class Room {
  roomId: string
  maxPlayers: number
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
  /** Player who went down this round (ended the round). */
  roundEnderId: string | null = null

  constructor(options: RoomOptions = {}) {
    this.roomId = options.roomId ?? uuidv4().slice(0, 8)
    this.maxPlayers = Math.min(MAX_PLAYERS, options.maxPlayers ?? MAX_PLAYERS)
  }

  addPlayer(id: string, name: string): boolean {
    if (this.phase !== 'lobby' || this.players.length >= this.maxPlayers) return false
    if (this.players.some(p => p.id === id)) return true
    this.players.push({
      id,
      name: name.slice(0, 24) || 'Player',
      score: 0,
      hand: [],
      connected: true,
    })
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

  startGame(): boolean {
    if (this.phase !== 'lobby' || this.players.length < MIN_PLAYERS) return false
    this.phase = 'playing'
    this.round = 1
    this.dealerIndex = 0
    this.roundScores = {}
    return this.startRound()
  }

  startRound(): boolean {
    this.contract = getContract(this.round)
    this.melds = []
    this.roundEnderId = null
    const deck = createContinentalDeck(this.players.length)
    const n = CARDS_PER_PLAYER * this.players.length
    const { drawn, remaining } = draw(deck, n)
    this.stock = remaining
    this.discardPile = []
    this.topDiscard = null

    let i = 0
    for (const p of this.players) {
      p.hand = drawn.slice(i * CARDS_PER_PLAYER, (i + 1) * CARDS_PER_PLAYER)
      i++
    }

    this.currentPlayerIndex = (this.dealerIndex + 1) % this.players.length
    return true
  }

  /** Current player draws from stock or discard (discardIndex 0 = top). */
  draw(playerId: string, fromDiscard: boolean): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
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
          this.endRound()
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

  /** Play melds to table (go down). If contract is satisfied, round ends. */
  playMelds(playerId: string, melds: { type: Meld['type']; cards: Card[] }[]): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }

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

    if (satisfiesContract(melds, this.contract)) {
      this.roundEnderId = playerId
      this.endRound()
      return { ok: true }
    }
    return { ok: true }
  }

  /** Add cards to existing meld. */
  addToMeld(playerId: string, meldId: string, cards: Card[]): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    const meld = this.melds.find(m => m.id === meldId)
    if (!meld) return { ok: false, error: 'Meld not found' }
    const combined = [...meld.cards, ...cards]
    if (!isValidMeld(meld.type, combined)) return { ok: false, error: 'Invalid meld with new cards' }
    for (const c of cards) {
      const idx = cp.hand.findIndex(x => x.id === c.id)
      if (idx >= 0) cp.hand.splice(idx, 1)
    }
    meld.cards = combined
    return { ok: true }
  }

  discard(playerId: string, cardId: string): { ok: boolean; error?: string } {
    if (this.phase !== 'playing') return { ok: false, error: 'Not playing' }
    const cp = this.players[this.currentPlayerIndex]
    if (!cp || cp.id !== playerId) return { ok: false, error: 'Not your turn' }
    const idx = cp.hand.findIndex(c => c.id === cardId)
    if (idx < 0) return { ok: false, error: 'Card not in hand' }
    const [card] = cp.hand.splice(idx, 1)
    if (card) {
      this.discardPile.push(card)
      this.topDiscard = card
    }
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length
    return { ok: true }
  }

  endRound(): void {
    this.phase = 'round_end'
    for (const p of this.players) {
      this.roundScores[p.id] = handPenalty(p.hand)
      p.score += this.roundScores[p.id]!
    }
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
    }
  }
}
