import { randomUUID } from 'node:crypto'
import type { AdGateState, AdPlayerStatus, AdProvider } from '../../shared/adGate.js'
export type { AdGateState } from '../../shared/adGate.js'
export interface AdConfig { provider: AdProvider; publisherId: string | null }
type GateRoom = { roomId: string; phase: AdGateState['phase']; players: { id: string; connected: boolean }[] }
type Result = { ok: boolean; error?: string; code?: string; attemptId?: string }
type Attempt = { id: string; startedAt: number }
type Seat = { ready: boolean; attempt?: Attempt }
type Cycle = { id: string; seats: Map<string, Seat> }

// This prevents accidental immediate completions, not malicious browser clients.
// H5 has no signed completion receipt; client callbacks cannot prove an ad view.
export const MIN_AD_ATTEMPT_MS = 750
export const MAX_AD_ATTEMPT_MS = 5 * 60_000

/** Ephemeral, seat-bound readiness for the next complete game, never a round. */
export class AdGate {
  readonly enabled: boolean
  private readonly cycles = new Map<string, Cycle>()
  constructor(private readonly config: AdConfig = { provider: 'disabled', publisherId: null }, private readonly now = Date.now) {
    // Unconfigured advertising must leave the existing game playable.
    this.enabled = config.provider === 'google-h5' && /^ca-pub-\d{16}$/.test(config.publisherId ?? '')
  }

  private sync(room: GateRoom): Cycle {
    let cycle = this.cycles.get(room.roomId)
    if (!cycle) {
      cycle = { id: randomUUID(), seats: new Map() }
      this.cycles.set(room.roomId, cycle)
    }
    const present = new Set(room.players.map(player => player.id))
    for (const id of cycle.seats.keys()) if (!present.has(id)) cycle.seats.delete(id)
    for (const player of room.players) {
      const seat = cycle.seats.get(player.id) ?? { ready: false }
      if (seat.attempt && this.now() - seat.attempt.startedAt > MAX_AD_ATTEMPT_MS) delete seat.attempt
      cycle.seats.set(player.id, seat)
    }
    return cycle
  }

  snapshot(room: GateRoom, exempt: boolean): AdGateState {
    const cycle = this.sync(room)
    const required = this.enabled && !exempt && (room.phase === 'lobby' || room.phase === 'game_end')
    const players = room.players.map(player => {
      const seat = cycle.seats.get(player.id)!
      return { playerId: player.id, status: (seat.ready ? 'ready' : seat.attempt ? 'viewing' : 'pending') as AdPlayerStatus, connected: player.connected }
    })
    return {
      roomId: room.roomId, cycle: cycle.id, enabled: this.enabled, exempt,
      provider: this.enabled ? this.config.provider : 'disabled', publisherId: this.enabled ? this.config.publisherId : null,
      phase: room.phase, required,
      canStart: !required || players.every(player => player.connected && player.status === 'ready'), players,
    }
  }

  begin(room: GateRoom, playerId: string, exempt: boolean): Result {
    const state = this.snapshot(room, exempt)
    if (!state.required) return { ok: false, code: 'ad_not_required', error: 'No ad break is required now.' }
    if (!room.players.some(player => player.id === playerId && player.connected)) return { ok: false, error: 'Reconnect to your seat first.' }
    const seat = this.sync(room).seats.get(playerId)!
    if (seat.ready) return { ok: false, code: 'ad_already_ready', error: 'Your ad break is already complete.' }
    if (seat.attempt) return { ok: false, code: 'ad_in_progress', error: 'An ad break is already in progress.' }
    const attemptId = randomUUID()
    seat.attempt = { id: attemptId, startedAt: this.now() }
    return { ok: true, attemptId }
  }

  complete(room: GateRoom, playerId: string, payload: unknown, exempt: boolean): Result {
    this.sync(room)
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'Invalid ad completion.' }
    const { attemptId, outcome } = payload as Record<string, unknown>
    const seat = this.cycles.get(room.roomId)?.seats.get(playerId)
    if (!seat?.attempt || typeof attemptId !== 'string' || seat.attempt.id !== attemptId) return { ok: false, code: 'ad_invalid_attempt', error: 'This ad attempt is invalid or expired. Please try again.' }
    const elapsed = this.now() - seat.attempt.startedAt
    // Consume before checking outcome so a failure cannot be replayed as success.
    delete seat.attempt
    if (!this.snapshot(room, exempt).required) return { ok: false, code: 'ad_not_required', error: 'No ad break is required now.' }
    if (outcome === 'unavailable' || outcome === 'error') return { ok: false, code: 'ad_unavailable', error: 'The ad could not be shown. Please try again.' }
    if (outcome !== 'viewed' && outcome !== 'dismissed') return { ok: false, code: 'ad_invalid_outcome', error: 'Invalid ad completion.' }
    if (elapsed < MIN_AD_ATTEMPT_MS || elapsed > MAX_AD_ATTEMPT_MS) return { ok: false, code: 'ad_invalid_attempt', error: 'This ad attempt is invalid or expired. Please try again.' }
    if (!room.players.some(player => player.id === playerId && player.connected)) return { ok: false, error: 'Reconnect to your seat first.' }
    seat.ready = true
    return { ok: true }
  }

  /** A successfully committed start/rematch consumes this cycle. */
  consume(roomId: string): void { this.cycles.delete(roomId) }
  /** Interrupted playback must be retryable after a reconnect; completed seats stay ready. */
  interrupt(roomId: string, playerId: string): void {
    const seat = this.cycles.get(roomId)?.seats.get(playerId)
    if (seat) delete seat.attempt
  }
  forget(roomId: string): void { this.cycles.delete(roomId) }
  prune(roomIds: Iterable<string>): void {
    const retained = new Set(roomIds)
    for (const roomId of this.cycles.keys()) if (!retained.has(roomId)) this.cycles.delete(roomId)
  }
}
