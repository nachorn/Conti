import type { GameState } from '../types'

export interface TurnCue { key: string; delayMs: number }

/** A decision, not an animation or a repeated socket update. */
export function getTurnCue(state: GameState | null, playerId: string | null, now = Date.now()): TurnCue | null {
  if (!state || !playerId || state.savedGame?.paused) return null
  const p = state.pocha
  if (p) {
    if (!['auction', 'choosing_trump', 'bidding', 'playing'].includes(p.phase) || p.players[p.currentPlayerIndex]?.id !== playerId) return null
    const trick = p.players.reduce((sum, player) => sum + player.tricksWon, 0)
    return {
      key: `${state.roomId}:pocha:${p.handNumber}:${p.phase}:${trick}`,
      delayMs: p.lastTrick ? Math.max(0, (p.trickReviewUntil ?? 0) - (p.serverTime ?? now)) : 0,
    }
  }
  if (state.phase !== 'playing') return null
  const option = state.discardOptionPlayerIndex ?? null
  const actor = state.players[option ?? state.currentPlayerIndex]
  if (actor?.id !== playerId) return null
  return {
    key: `${state.roomId}:conti:${state.round}:${option === null ? 'play' : 'discard-option'}`,
    delayMs: option === null ? 0 : Math.max(0, (state.discardOptionAvailableAt ?? 0) - now),
  }
}

/** Reconnects do not repeat a notification; a real intervening turn resets it. */
export class TurnCueTracker {
  private last: string | null = null
  observe(cue: TurnCue | null, connected: boolean): boolean {
    if (!connected) return false
    if (!cue) { this.last = null; return false }
    return this.last !== cue.key
  }
  notified(cue: TurnCue) { this.last = cue.key }
}
