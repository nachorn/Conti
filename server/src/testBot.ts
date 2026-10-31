import type { PochaAction, PochaGameState, SpanishSuit } from './game/pocha/pochaTypes.js'

/** A deliberately simple test player. Its input is the same private view a browser receives. */
export function pochaBotAction(state: PochaGameState, playerId: string): PochaAction | null {
  const me = state.players.find(player => player.id === playerId)
  if (!me) return null
  if (state.phase === 'choosing_trump') {
    if (state.auctionWinnerId !== playerId) return null
    const suits: SpanishSuit[] = ['oros', 'copas', 'espadas', 'bastos']
    const suit = suits.sort((a, b) => me.hand.filter(card => card.suit === b).length - me.hand.filter(card => card.suit === a).length)[0]!
    return { type: 'trump', suit }
  }
  if (state.players[state.currentPlayerIndex]?.id !== playerId) return null
  if (state.phase === 'auction') {
    // The opening zero is always legal; following players may pass.
    return { type: 'auction', value: state.auction.some(bid => bid.value !== null) ? null : 0 }
  }
  if (state.phase === 'bidding') {
    let value = Math.min(state.cardsPerHand, me.hand.filter(card => card.rank === 1 || card.rank === 3).length)
    if (value === state.blockedBid) value = value === 0 ? 1 : value - 1
    return { type: 'bid', value }
  }
  if (state.phase === 'playing') {
    const cardId = state.legalCardIds?.[0]
    return cardId ? { type: 'play', cardId } : null
  }
  return null
}
