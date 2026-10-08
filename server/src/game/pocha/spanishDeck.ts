import { v4 as uuidv4 } from 'uuid'
import { SPANISH_RANKS_32, SPANISH_RANKS_36, SPANISH_RANKS_40, SPANISH_RANKS_48, SPANISH_RANKS_BY_SIZE } from './pochaTypes.js'
import type { PochaCard, PochaDeckSize, SpanishSuit } from './pochaTypes.js'

const SUITS: SpanishSuit[] = ['oros', 'copas', 'espadas', 'bastos']

function createSpanishDeck(ranks: readonly number[]): PochaCard[] {
  const cards: PochaCard[] = []
  for (const suit of SUITS) {
    for (const rank of ranks) {
      cards.push({ id: uuidv4(), suit, rank })
    }
  }
  return cards
}

/** Build a Spanish deck without 8s or 9s. */
export function createSpanishDeck40(): PochaCard[] {
  return createSpanishDeck(SPANISH_RANKS_40)
}

/** Build the full Spanish deck, including 8s and 9s. */
export function createSpanishDeck48(): PochaCard[] {
  return createSpanishDeck(SPANISH_RANKS_48)
}

/** Build a 40-card Spanish deck without 4s. */
export function createSpanishDeck36(): PochaCard[] {
  return createSpanishDeck(SPANISH_RANKS_36)
}

/** Build a 40-card Spanish deck without 4s or 2s. */
export function createSpanishDeck32(): PochaCard[] {
  return createSpanishDeck(SPANISH_RANKS_32)
}

/** Create a shuffled Pocha deck; the 40-card variant remains the default. */
export function createPochaDeck(deckSize: PochaDeckSize = 40): PochaCard[] {
  return shuffle(createSpanishDeck(SPANISH_RANKS_BY_SIZE[deckSize]))
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
