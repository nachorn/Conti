import { v4 as uuidv4 } from 'uuid'
import type { PochaCard, SpanishSuit } from './pochaTypes.js'

const SUITS: SpanishSuit[] = ['oros', 'copas', 'espadas', 'bastos']
const RANKS_40 = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12] as const

/** Build a single 40-card Spanish deck. */
export function createSpanishDeck40(): PochaCard[] {
  const cards: PochaCard[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS_40) {
      cards.push({ id: uuidv4(), suit, rank })
    }
  }
  return cards
}

/** For 3 players, remove all 2s to get 36 cards (12 each). */
export function createSpanishDeck36(): PochaCard[] {
  return createSpanishDeck40().filter((c) => c.rank !== 2)
}

/**
 * Create deck for Pocha. 40 cards for 4-5 players, 36 (no 2s) for 3 players.
 */
export function createPochaDeck(playerCount: number): PochaCard[] {
  const deck = playerCount === 3 ? createSpanishDeck36() : createSpanishDeck40()
  return shuffle(deck)
}

export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

export function draw(deck: PochaCard[], n: number): { drawn: PochaCard[]; remaining: PochaCard[] } {
  const drawn = deck.slice(0, n)
  const remaining = deck.slice(n)
  return { drawn, remaining }
}
