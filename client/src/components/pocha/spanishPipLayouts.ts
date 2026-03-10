/**
 * Traditional Baraja Española pip positions (viewBox 70×98).
 * Each entry is [x, y]; multiple pips are placed at these centers.
 */

const CARD_W = 70
const CARD_H = 98

export type PipLayout = ReadonlyArray<readonly [number, number]>

/** One large pip at center (As). */
export const LAYOUT_1: PipLayout = [[CARD_W / 2, CARD_H / 2]]

/** Two pips vertical (Oros/Copas 2). */
export const LAYOUT_2_V: PipLayout = [
  [CARD_W / 2, 38],
  [CARD_W / 2, 60],
]

/** Two pips crossed (Espadas/Bastos 2). Same positions as 2_V but caller rotates. */
export const LAYOUT_2_X: PipLayout = [
  [CARD_W / 2, 42],
  [CARD_W / 2, 56],
]

/** Three pips triangle (Oros/Copas 3). */
export const LAYOUT_3_TRI: PipLayout = [
  [35, 32],
  [26, 62],
  [44, 62],
]

/** Three pips fanned (Espadas/Bastos 3). */
export const LAYOUT_3_FAN: PipLayout = [
  [35, 38],
  [26, 58],
  [44, 58],
]

/** Four pips 2×2. */
export const LAYOUT_4: PipLayout = [
  [28, 38],
  [42, 38],
  [28, 60],
  [42, 60],
]

/** Five pips cross. */
export const LAYOUT_5: PipLayout = [
  [35, 49],
  [28, 34],
  [42, 34],
  [28, 64],
  [42, 64],
]

/** Six pips 2×3. */
export const LAYOUT_6: PipLayout = [
  [28, 34],
  [28, 49],
  [28, 64],
  [42, 34],
  [42, 49],
  [42, 64],
]

/** Seven pips: 2×3 + 1 top center. */
export const LAYOUT_7: PipLayout = [
  [35, 28],
  [28, 44],
  [42, 44],
  [28, 59],
  [42, 59],
  [28, 74],
  [42, 74],
]

/** Eight pips 2×4. */
export const LAYOUT_8: PipLayout = [
  [28, 30],
  [28, 44],
  [28, 58],
  [28, 72],
  [42, 30],
  [42, 44],
  [42, 58],
  [42, 72],
]

/** Nine pips 3×3. */
export const LAYOUT_9: PipLayout = [
  [24, 30],
  [35, 30],
  [46, 30],
  [24, 49],
  [35, 49],
  [46, 49],
  [24, 68],
  [35, 68],
  [46, 68],
]

export function getPipLayout(rank: number, suit: string): PipLayout | null {
  if (rank === 1) return LAYOUT_1
  if (rank === 2) return suit === 'oros' || suit === 'copas' ? LAYOUT_2_V : LAYOUT_2_X
  if (rank === 3) return suit === 'oros' || suit === 'copas' ? LAYOUT_3_TRI : LAYOUT_3_FAN
  if (rank === 4) return LAYOUT_4
  if (rank === 5) return LAYOUT_5
  if (rank === 6) return LAYOUT_6
  if (rank === 7) return LAYOUT_7
  if (rank === 8) return LAYOUT_8
  if (rank === 9) return LAYOUT_9
  return null
}

/** Whether rank 2 or 3 uses crossed/fanned (espadas/bastos). */
export function isCrossedOrFanned(rank: number, suit: string): boolean {
  return (rank === 2 || rank === 3) && (suit === 'espadas' || suit === 'bastos')
}
