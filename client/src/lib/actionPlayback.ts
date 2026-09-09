import type { GameState, PublicAction } from '../types'

export interface ActionCursor { scope: string; ids: string[] }

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
