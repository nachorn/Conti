import type { GameState, PublicAction } from '../types'

export interface ActionCursor { scope: string; ids: string[] }
export const MAX_PLAYBACK_ACTIONS = 24

/** Keep the current card and the newest pending plays while playback is paused. */
export function appendPlayback(current: PublicAction[], incoming: PublicAction[]): PublicAction[] {
  if (incoming.length === 0) return current
  const combined = current.concat(incoming)
  if (combined.length <= MAX_PLAYBACK_ACTIONS) return combined
  const visible = current[0]
  return visible
    ? [visible, ...combined.slice(-(MAX_PLAYBACK_ACTIONS - 1))]
    : combined.slice(-MAX_PLAYBACK_ACTIONS)
}

/** Baseline a join/reconnect instead of replaying old moves as new ones. */
export function collectActions(cursor: ActionCursor | null, state: GameState, connected: boolean): { cursor: ActionCursor | null; actions: PublicAction[]; reset: boolean } {
  if (!connected || state.phase === 'lobby') return { cursor: null, actions: [], reset: true }
  const scope = `${state.roomId}:${state.round}`
  const feed = state.activity ?? []
  const next = { scope, ids: feed.map(action => action.id) }
  if (!cursor || cursor.scope !== scope) return { cursor: next, actions: [], reset: true }
  const seen = new Set(cursor.ids)
  return { cursor: next, actions: feed.filter(action => !seen.has(action.id)), reset: false }
}

export function actionDisplayTime(action: PublicAction): number {
  if (action.kind === 'pass') return 1800
  if (action.kind === 'stock') return 3000
  return action.melds?.length ? 5500 : 4000
}
