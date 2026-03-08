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
          isWild: rank === 2,
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

const JOKERS_PER_DECK = 2

/**
 * Create deck. If deckCount is 2 or 3, use it; else 2 for <5 players, 3 for 6-8, 4 for 9+.
 */
export function createContinentalDeck(playerCount: number, deckCount?: 2 | 3): Card[] {
  let decks: number
  if (deckCount === 2 || deckCount === 3) {
    decks = deckCount
  } else if (playerCount < 5) {
    decks = 2
  } else if (playerCount <= 8) {
    decks = 3
  } else {
    decks = 4
  }
  return shuffle(makeDeck(decks, JOKERS_PER_DECK))
}

export function draw(deck: Card[], n: number): { drawn: Card[]; remaining: Card[] } {
  const drawn = deck.slice(0, n)
  const remaining = deck.slice(n)
  return { drawn, remaining }
}
