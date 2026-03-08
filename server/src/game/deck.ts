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

/**
 * Deck size for Continental: 2 decks + jokers for <5 players, 3 decks for 6-8, 4 for 9+.
 * We use 2 jokers per deck typically.
 */
export function createContinentalDeck(playerCount: number): Card[] {
  let decks: number
  let jokersPerDeck: number
  if (playerCount < 5) {
    decks = 2
    jokersPerDeck = 2
  } else if (playerCount <= 8) {
    decks = 3
    jokersPerDeck = 2
  } else {
    decks = 4
    jokersPerDeck = 2
  }
  return shuffle(makeDeck(decks, jokersPerDeck))
}

export function draw(deck: Card[], n: number): { drawn: Card[]; remaining: Card[] } {
  const drawn = deck.slice(0, n)
  const remaining = deck.slice(n)
  return { drawn, remaining }
}
