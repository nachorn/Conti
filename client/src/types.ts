export type {
  Card,
  GamePhase,
  GameState,
  GameType,
  Meld,
  MeldType,
  Player,
  PublicAction,
  RoundResult,
  RoundContract,
  Suit,
} from '@shared/types'

/** Result returned by server-acknowledged gameplay mutations. */
export interface ActionResult {
  ok: boolean
  error?: string
}
