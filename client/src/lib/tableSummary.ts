import type { Card, GameState, Meld, PublicAction } from '../types'
import type { Lang } from '../i18n'
import { isValidMeld } from './meld.ts'
import { orderMeldCardsForDisplay } from './meldTargeting.ts'
import { cardLabel } from './cardActivity.ts'

export function shortCard(card: Card): string {
  if (card.suit === 'joker') return 'Joker'
  return `${({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] ?? card.rank}${({ hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' })[card.suit]}`
}

export function meldSummary(meld: Meld, lang: Lang): string {
  const cards = orderMeldCardsForDisplay(meld)
  const natural = cards.find(c => c.suit !== 'joker')
  const rank = natural ? shortCard(natural).slice(0, -1) : 'Joker'
  const title = meld.type === 'trio'
    ? `${lang === 'es' ? 'Trío' : 'Trio'} · ${rank}`
    : `${lang === 'es' ? 'Escalera' : 'Straight'} · ${cards.map(shortCard).join(' ')}`
  return `${title} · ${cards.length} ${lang === 'es' ? 'cartas' : 'cards'}`
}

/** Same rule as Room.discard: players still holding their contract cannot feed a public meld. */
export function discardBlocker(state: GameState, playerId: string | null, card: Card): Meld | undefined {
  if (state.melds.some(m => m.ownerId === playerId)) return undefined
  return state.melds.find(m => isValidMeld(m.type, [...m.cards, card]))
}

export function discardExplanation(state: GameState, playerId: string | null, card: Card, lang: Lang): string | null {
  const meld = discardBlocker(state, playerId, card)
  if (!meld) return null
  const name = state.players.find(p => p.id === meld.ownerId)?.name ?? (lang === 'es' ? 'la mesa' : 'the table')
  return lang === 'es'
    ? `${cardLabel(card, lang)} encaja en ${meldSummary(meld, lang)} de ${name}. Baja tu contrato antes de descartarla, o elige otra carta.`
    : `${cardLabel(card, lang)} fits ${name}’s ${meldSummary(meld, lang)}. Play your contract before discarding it, or choose another card.`
}

export function actionSummary(action: PublicAction, lang: Lang): string {
  const faces = action.cards.map(shortCard).join(', ')
  const destination = [action.targetName, ...(action.melds ?? []).map(meld => meldSummary(meld, lang))].filter(Boolean).join(' · ')
  const target = destination ? ` (${destination})` : ''
  const text = lang === 'es' ? {
    stock: 'robó del mazo', take: `tomó ${faces} del descarte`, buy: `compró ${faces}${action.penaltyCount ? ' + 1 carta de penalización' : ' (sin carta de penalización)'}`,
    pass: 'pasó', discard: `descartó ${faces}`, meld: `bajó ${faces}`, add: `añadió ${faces}${target}`, swap: `reemplazó un comodín con ${faces}${target}`,
  } : {
    stock: 'drew from stock', take: `took ${faces} from discard`, buy: `bought ${faces}${action.penaltyCount ? ' + 1 penalty card' : ' (no penalty card)'}`,
    pass: 'passed', discard: `discarded ${faces}`, meld: `played ${faces}`, add: `added ${faces}${target}`, swap: `replaced a Joker with ${faces}${target}`,
  }
  return `${action.playerName} ${text[action.kind]}`
}
