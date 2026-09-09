import type { PochaAction, PochaDeckSize, PochaGameState, PochaPlayer, PochaSettings, SpanishSuit, TrickCard } from './pochaTypes.js'
import { createPochaDeck } from './spanishDeck.js'
import { POCHA_TRICK_REVIEW_MS } from './pochaTypes.js'
import { defaultPochaSettings, legalCards, roundSchedule, scoreHand, winningCard } from './pochaRules.js'
export { scoreHand } from './pochaRules.js'

export function getCardsPerHand(handNumber: number, playerCount: number, deckSize: PochaDeckSize = 40): number {
  return roundSchedule(defaultPochaSettings(playerCount, deckSize), playerCount, deckSize)[handNumber - 1] ?? 1
}
export const leadPlayerIndex = (dealerIndex: number, playerCount: number) => (dealerIndex + 1) % playerCount

export function dealerBidsBlocked(totalTricks: number, bids: Record<string, number>, lastId: string): number | null {
  const forbidden = totalTricks - Object.entries(bids).reduce((sum, [id, bid]) => sum + (id === lastId ? 0 : bid), 0)
  return forbidden >= 0 && forbidden <= totalTricks ? forbidden : null
}
export function trickWinner(trick: TrickCard[], lead: number, trump: SpanishSuit, order: string[]): string {
  return winningCard(trick, trump)?.playerId ?? order[lead]
}
export function createPochaLobby(roomId: string, deckSize: PochaDeckSize = 40): PochaGameState {
  return { roomId, deckSize, phase: 'lobby', settings: defaultPochaSettings(2, deckSize), schedule: [], hostId: '',
    handNumber: 0, cardsPerHand: 0, trump: null, trumpCard: null, players: [], dealerIndex: 0,
    originalLeadPlayerIndex: 0, leadPlayerIndex: 0, currentPlayerIndex: 0, currentTrick: [], bids: {},
    auction: [], auctionWinnerId: null, lastTrick: null, trickReviewUntil: null, history: [] }
}
export function createPochaHandState(roomId: string, players: Omit<PochaPlayer, 'hand' | 'bid' | 'tricksWon'>[], handNumber: number,
  dealerIndex: number, deckSize: PochaDeckSize = 40, settings = defaultPochaSettings(players.length, deckSize)): PochaGameState {
  const schedule = roundSchedule(settings, players.length, deckSize)
  if (!schedule[handNumber - 1]) throw new Error('Ronda inexistente')
  const state = createPochaLobby(roomId, deckSize)
  Object.assign(state, { settings, schedule, handNumber, dealerIndex, hostId: players[0].id,
    players: players.map(p => ({ ...p, hand: [], bid: null, tricksWon: 0 })) })
  dealHand(state)
  return state
}
export function dealHand(state: PochaGameState): void {
  const n = state.players.length
  state.cardsPerHand = state.schedule[state.handNumber - 1]
  state.originalLeadPlayerIndex = leadPlayerIndex(state.dealerIndex, n)
  state.leadPlayerIndex = state.originalLeadPlayerIndex
  state.currentPlayerIndex = state.originalLeadPlayerIndex
  state.players.forEach(p => { p.hand = []; p.bid = null; p.tricksWon = 0 })
  state.bids = {}; state.currentTrick = []; state.lastTrick = null; state.auction = []; state.auctionWinnerId = null
  state.trickReviewUntil = null
  const deck = createPochaDeck(state.deckSize)
  const dealt = n * state.cardsPerHand
  for (let i = 0; i < dealt; i++) state.players[(state.originalLeadPlayerIndex + i) % n].hand.push(deck[i])
  const auction = state.settings.mode === 'subastada' && dealt === state.deckSize
  state.trumpCard = auction ? null : deck[dealt] ?? deck[dealt - 1]
  state.trump = state.trumpCard?.suit ?? null
  state.phase = auction ? 'auction' : 'bidding'
}
export function startPocha(state: PochaGameState, settings: PochaSettings): void {
  const schedule = roundSchedule(settings, state.players.length, state.deckSize)
  state.settings = { ...settings }; state.schedule = schedule; state.history = []; state.handNumber = 1
  state.players.sort((a, b) => a.seatIndex - b.seatIndex)
  state.players.forEach(p => { p.score = 0 })
  state.dealerIndex = state.players.length - 1
  dealHand(state)
}
export function isPochaTrickReview(state: PochaGameState, now = Date.now()): boolean {
  return !!state.lastTrick && (state.trickReviewUntil ?? 0) > now
}
export function nextPochaRound(state: PochaGameState): void {
  if (state.phase !== 'hand_end') throw new Error('La ronda no ha terminado')
  if (isPochaTrickReview(state)) throw new Error('Espera a que termine el resultado de la baza')
  state.handNumber++
  state.dealerIndex = (state.dealerIndex + 1) % state.players.length
  dealHand(state)
}
export function applyPochaAction(state: PochaGameState, playerId: string, action: PochaAction, now = Date.now()): { ok: boolean; error?: string } {
  const fail = (error: string) => ({ ok: false, error })
  if (isPochaTrickReview(state, now)) return fail('Espera a que termine el resultado de la baza')
  const player = state.players[state.currentPlayerIndex]
  if (!player || player.id !== playerId) return fail('Espera tu turno')
  const n = state.players.length
  const validBid = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= state.cardsPerHand
  if (action.type === 'auction' && state.phase === 'auction') {
    const best = Math.max(-1, ...state.auction.map(a => a.value ?? -1))
    if (action.value === null ? !state.auction.length : !validBid(action.value) || action.value <= best) return fail('Debes superar la oferta; la mano debe abrir con una cantidad')
    state.auction.push({ playerId, value: action.value })
    if (action.value !== null) state.auctionWinnerId = playerId
    if (state.auction.length === n) {
      const winner = state.players.findIndex(p => p.id === state.auctionWinnerId)
      const value = state.auction.find(a => a.playerId === state.auctionWinnerId)!.value!
      state.players[winner].bid = value; state.bids[state.auctionWinnerId!] = value
      state.leadPlayerIndex = winner; state.currentPlayerIndex = winner; state.phase = 'choosing_trump'
    } else state.currentPlayerIndex = (state.currentPlayerIndex + 1) % n
    return { ok: true }
  }
  if (action.type === 'trump' && state.phase === 'choosing_trump') {
    if (!['oros', 'copas', 'espadas', 'bastos'].includes(action.suit)) return fail('Elige un palo válido')
    state.trump = action.suit; state.phase = 'bidding'; state.currentPlayerIndex = (state.leadPlayerIndex + 1) % n
    return { ok: true }
  }
  if (action.type === 'bid' && state.phase === 'bidding') {
    if (!validBid(action.value)) return fail('Predicción inválida')
    if (Object.keys(state.bids).length === n - 1 && dealerBidsBlocked(state.cardsPerHand, state.bids, playerId) === action.value) return fail('El total de predicciones no puede coincidir con las bazas disponibles')
    player.bid = action.value; state.bids[playerId] = action.value
    if (Object.keys(state.bids).length === n) { state.phase = 'playing'; state.currentPlayerIndex = state.leadPlayerIndex }
    else state.currentPlayerIndex = (state.currentPlayerIndex + 1) % n
    return { ok: true }
  }
  if (action.type === 'play' && state.phase === 'playing' && state.trump) {
    const card = legalCards(player.hand, state.currentTrick, state.trump).find(c => c.id === action.cardId)
    if (!card) return fail('Debes asistir al palo, jugar triunfo si no tienes, y superar si puedes')
    player.hand = player.hand.filter(c => c.id !== card.id)
    state.currentTrick.push({ playerId, card })
    if (state.currentTrick.length < n) state.currentPlayerIndex = (state.currentPlayerIndex + 1) % n
    else {
      const winnerId = winningCard(state.currentTrick, state.trump)!.playerId
      const winner = state.players.findIndex(p => p.id === winnerId)
      state.players[winner].tricksWon++
      state.lastTrick = { cards: state.currentTrick, winnerId }
      state.trickReviewUntil = now + POCHA_TRICK_REVIEW_MS
      state.currentTrick = []; state.currentPlayerIndex = winner; state.leadPlayerIndex = winner
      if (state.players.every(p => !p.hand.length)) {
        const results = state.players.map(p => {
          const points = scoreHand(p.bid!, p.tricksWon); p.score += points
          return { id: p.id, name: p.name, bid: p.bid!, tricksWon: p.tricksWon, points, total: p.score }
        })
        state.history.push({ handNumber: state.handNumber, cardsPerHand: state.cardsPerHand, trump: state.trump, players: results })
        state.phase = state.handNumber === state.schedule.length ? 'game_end' : 'hand_end'
      }
    }
    return { ok: true }
  }
  return fail('Esta acción no corresponde a la fase actual')
}
export function publicPochaState(state: PochaGameState, playerId?: string): PochaGameState {
  const copy = structuredClone(state)
  copy.serverTime = Date.now()
  copy.players = state.players.map(p => ({ ...p, handCount: p.hand.length, hand: p.id === playerId ? structuredClone(p.hand) : [] }))
  const current = state.players[state.currentPlayerIndex]
  copy.legalCardIds = state.phase === 'playing' && current?.id === playerId && state.trump ? legalCards(current.hand, state.currentTrick, state.trump).map(c => c.id) : []
  copy.blockedBid = state.phase === 'bidding' && Object.keys(state.bids).length === state.players.length - 1 ? dealerBidsBlocked(state.cardsPerHand, state.bids, current.id) : null
  return copy
}
