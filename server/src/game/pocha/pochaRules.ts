import { POCHA_TRICK_ORDER } from './pochaTypes.js'
import type { PochaCard, PochaSettings, SpanishSuit, TrickCard } from './pochaTypes.js'

export function defaultPochaSettings(players: number, deckSize: number): PochaSettings {
  return { mode: 'normal', maxCards: Math.floor(deckSize / Math.max(2, players)), oneCardRounds: Math.max(1, players), peakRounds: Math.max(1, players) }
}
export function roundSchedule(settings: PochaSettings, players: number, deckSize: number): number[] {
  const { maxCards, oneCardRounds, peakRounds, mode } = settings
  if (!Number.isInteger(players) || players < 2 || players > 10 || ![40, 48].includes(deckSize) ||
      !['normal', 'subastada'].includes(mode) ||
      !Number.isInteger(maxCards) || maxCards < 1 || maxCards > Math.floor(deckSize / players) ||
      ![oneCardRounds, peakRounds].every(n => Number.isInteger(n) && n >= 1 && n <= players)) throw new Error('Configuración de rondas inválida')
  // A one-card-only game has one block, without duplicate slopes or peaks.
  if (maxCards === 1) return Array(oneCardRounds).fill(1)
  const slope = Array.from({ length: maxCards - 2 }, (_, i) => i + 2)
  return [...Array(oneCardRounds).fill(1), ...slope, ...Array(peakRounds).fill(maxCards), ...slope.reverse(), ...Array(oneCardRounds).fill(1)]
}
export function compareInTrick(a: PochaCard, b: PochaCard, ledSuit: SpanishSuit, trump: SpanishSuit): number {
  const priority = (c: PochaCard) => c.suit === trump ? 2 : c.suit === ledSuit ? 1 : 0
  return priority(a) - priority(b) || (priority(a) ? (POCHA_TRICK_ORDER[a.rank] ?? 0) - (POCHA_TRICK_ORDER[b.rank] ?? 0) : 0)
}
export function winningCard(trick: TrickCard[], trump: SpanishSuit): TrickCard | undefined {
  return trick.reduce<TrickCard | undefined>((best, card) => !best || compareInTrick(card.card, best.card, trick[0]!.card.suit, trump) > 0 ? card : best, undefined)
}
export function legalCards(hand: PochaCard[], trick: TrickCard[], trump: SpanishSuit): PochaCard[] {
  if (!trick.length) return hand
  const ledSuit = trick[0]!.card.suit
  const follows = hand.filter(c => c.suit === ledSuit)
  const trumps = hand.filter(c => c.suit === trump)
  const candidates = follows.length ? follows : trumps.length ? trumps : hand
  const winner = winningCard(trick, trump)!
  const beating = candidates.filter(c => compareInTrick(c, winner.card, ledSuit, trump) > 0)
  return beating.length ? beating : candidates
}
export function scoreHand(bid: number, tricksWon: number): number {
  return bid === tricksWon ? 5 + 2 * tricksWon : -2 * Math.abs(bid - tricksWon)
}

