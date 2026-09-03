import { v4 as uuidv4 } from 'uuid'
import type { Card } from '../types.js'

const SUITS: Card['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades']
const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] // 2..10, J, Q, K, A

function makeDeck(decks: number, jokersPerDeck: number): Card[] {
  const cards: Card[] = []
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: uuidv4(),
          suit,
          rank,
        })
      }
    }
    for (let j = 0; j < jokersPerDeck; j++) {
      cards.push({
        id: uuidv4(),
        suit: 'joker',
        rank: 0,
        isWild: true,
      })
    }
  }
  return cards
}

/** Shuffle and return new array. */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const JOKERS_PER_DECK = 3

/** Create a chosen 2- or 3-deck shoe; default to 3 only above five players. */
export function createContinentalDeck(playerCount: number, deckCount?: 2 | 3): Card[] {
  const decks = deckCount === 2 || deckCount === 3
    ? deckCount
    : playerCount > 5 ? 3 : 2
  return shuffle(makeDeck(decks, JOKERS_PER_DECK))
}

export function draw(deck: Card[], n: number): { drawn: Card[]; remaining: Card[] } {
  const drawn = deck.slice(0, n)
  const remaining = deck.slice(n)
  return { drawn, remaining }
}
