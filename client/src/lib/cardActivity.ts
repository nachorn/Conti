import type { Card, GameState } from '../types'

export interface DrawReceipt {
  card: Card
  source: 'stock' | 'discard' | 'penalty'
}

/** Compare consecutive, connected snapshots; never inspect opponents' hidden cards. */
export function getCardActivity(previous: GameState, next: GameState, playerId: string | null) {
  const draws: DrawReceipt[] = []
  let discard: { card: Card; playerName: string } | null = null
  if (previous.roomId !== next.roomId || previous.round !== next.round ||
      previous.phase !== 'playing' || next.phase !== 'playing') return { draws, discard }

  const before = previous.players.find((player) => player.id === playerId)?.hand ?? []
  const after = next.players.find((player) => player.id === playerId)?.hand ?? []
  const added = after.filter((card) => !before.some((old) => old.id === card.id))
  // Joker exchanges replace a card; they are not draws.
  if (before.length > 0 && after.length > before.length) {
    const tookDiscard = added.some((card) => card.id === previous.topDiscard?.id)
    for (const card of added) {
      draws.push({ card, source: tookDiscard
        ? card.id === previous.topDiscard?.id ? 'discard' : 'penalty'
        : 'stock' })
    }
  }

  // Taking the pile can expose an older card. Only a new discard opens an option.
  if (next.topDiscard && next.topDiscard.id !== previous.topDiscard?.id &&
      next.discarderIndex != null && next.discardOptionPlayerIndex != null) {
    const player = next.players[next.discarderIndex]
    if (player) discard = { card: next.topDiscard, playerName: player.name }
  }
  return { draws, discard }
}

export function cardLabel(card: Card, lang: 'en' | 'es') {
  if (card.suit === 'joker') return lang === 'es' ? 'Comodín' : 'Joker'
  const rank = ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[card.rank] ?? card.rank
  const suits = lang === 'es'
    ? { hearts: 'corazones', diamonds: 'diamantes', clubs: 'tréboles', spades: 'picas' }
    : { hearts: 'hearts', diamonds: 'diamonds', clubs: 'clubs', spades: 'spades' }
  return `${rank} ${lang === 'es' ? 'de' : 'of'} ${suits[card.suit]}`
}
