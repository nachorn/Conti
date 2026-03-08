import type {
  PochaCard,
  PochaGameState,
  PochaPlayer,
  SpanishSuit,
  TrickCard,
} from './pochaTypes.js'
import { POCHA_TRICK_ORDER } from './pochaTypes.js'
import { createPochaDeck, draw } from './spanishDeck.js'

/** Cards per hand: 1, 2, ... up to max then down. Max = 10 for 4 players (40/4), 8 for 5 (40/5), 12 for 3 (36/3). */
export function getCardsPerHand(handNumber: number, playerCount: number): number {
  const maxCards = playerCount === 3 ? 12 : 40 / playerCount
  const up = Math.ceil(maxCards)
  if (handNumber <= up) return handNumber
  const down = handNumber - up
  const n = up - down
  return Math.max(1, n)
}

/** Who leads first trick: player to dealer's right. */
export function leadPlayerIndex(dealerIndex: number, playerCount: number): number {
  return (dealerIndex + 1) % playerCount
}

/** Dealer cannot bid a number that would make total bids = tricks available. */
export function dealerBidsBlocked(totalTricks: number, currentBids: Record<string, number>, dealerId: string): number | null {
  const othersSum = Object.entries(currentBids).reduce((s, [id, b]) => (id === dealerId ? s : s + b), 0)
  const bidThatWouldTie = totalTricks - othersSum
  if (Number.isInteger(bidThatWouldTie) && bidThatWouldTie >= 0 && bidThatWouldTie <= totalTricks) {
    return bidThatWouldTie
  }
  return null
}

/** Compare two cards in a trick: led suit, trump. Returns positive if a wins, negative if b wins, 0 if same (shouldn't happen). */
function compareInTrick(
  a: PochaCard,
  b: PochaCard,
  ledSuit: SpanishSuit,
  trump: SpanishSuit
): number {
  const aTrump = a.suit === trump
  const bTrump = b.suit === trump
  const aFollows = a.suit === ledSuit
  const bFollows = b.suit === ledSuit

  if (aTrump && !bTrump) return 1
  if (!aTrump && bTrump) return -1
  if (aTrump && bTrump) return (POCHA_TRICK_ORDER[b.rank] ?? 0) - (POCHA_TRICK_ORDER[a.rank] ?? 0)
  if (aFollows && !bFollows) return 1
  if (!aFollows && bFollows) return -1
  if (aFollows && bFollows) return (POCHA_TRICK_ORDER[b.rank] ?? 0) - (POCHA_TRICK_ORDER[a.rank] ?? 0)
  return 0
}

/** Determine winner of the current trick. */
export function trickWinner(
  trick: TrickCard[],
  leadPlayerIndex: number,
  trump: SpanishSuit,
  playerOrder: string[]
): string {
  if (trick.length === 0) return playerOrder[leadPlayerIndex]
  const leadCard = trick[0]
  const ledSuit = leadCard.card.suit
  let winner = leadCard
  for (let i = 1; i < trick.length; i++) {
    const curr = trick[i]
    if (compareInTrick(curr.card, winner.card, ledSuit, trump) > 0) winner = curr
  }
  return winner.playerId
}

/** Score a hand: +10 for matching bid, plus 1 per trick if matched (common variant). */
export function scoreHand(bid: number, tricksWon: number): number {
  if (bid === tricksWon) return 10 + tricksWon
  return 0
}

/** Create initial Pocha game state for a hand (after lobby). */
export function createPochaHandState(
  roomId: string,
  players: Omit<PochaPlayer, 'hand' | 'bid' | 'tricksWon'>[],
  handNumber: number,
  dealerIndex: number
): PochaGameState {
  const playerCount = players.length
  const cardsPerHand = getCardsPerHand(handNumber, playerCount)
  const deck = createPochaDeck(playerCount)
  const { drawn, remaining } = draw(deck, playerCount * cardsPerHand)

  const hands: PochaCard[][] = []
  for (let i = 0; i < playerCount; i++) {
    hands.push(drawn.slice(i * cardsPerHand, (i + 1) * cardsPerHand))
  }

  const trumpCard = remaining[0] ?? null
  const trump = trumpCard?.suit ?? null

  const statePlayers: PochaPlayer[] = players.map((p, i) => ({
    ...p,
    hand: hands[i] ?? [],
    bid: null,
    tricksWon: 0,
  }))

  const leadIdx = leadPlayerIndex(dealerIndex, playerCount)

  return {
    roomId,
    phase: 'bidding',
    handNumber,
    cardsPerHand,
    trump,
    trumpCard,
    players: statePlayers,
    dealerIndex,
    leadPlayerIndex: leadIdx,
    currentTrick: [],
    bids: {},
    currentPlayerIndex: leadIdx,
  }
}
