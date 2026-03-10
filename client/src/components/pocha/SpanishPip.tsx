import type { SpanishSuit } from '@shared/pochaTypes'
import { POCHA_SUIT_COLOR } from './pochaCardUtils'

const VB = 24
const GOLD = '#c9a227'
const GOLD_DARK = '#8b6914'
const BLADE = '#4a6fa5'
const HILT = '#c9a227'
const WOOD = '#2d5a27'
const WOOD_DARK = '#1e3d1a'

export interface SpanishPipProps {
  suit: SpanishSuit
  x: number
  y: number
  size?: number
  /** Degrees; for espadas/bastos 2 (crossed). */
  rotate?: number
}

/**
 * Single traditional Baraja pip: coin (oros), chalice (copas), sword (espadas), club (bastos).
 * Designed for viewBox 70×98 card; size scales the 24×24 nominal icon.
 */
export function SpanishPip({ suit, x, y, size = 1, rotate = 0 }: SpanishPipProps) {
  const s = size
  const color = POCHA_SUIT_COLOR[suit]

  const coin = (
    <g fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.6">
      <circle cx={VB / 2} cy={VB / 2} r={9} />
      <circle cx={VB / 2} cy={VB / 2} r={6} fill={GOLD_DARK} opacity="0.4" />
    </g>
  )

  const chalice = (
    <g fill={GOLD} stroke={GOLD_DARK} strokeWidth="0.5">
      <path d="M12 2 L9 6 L9 10 Q9 14 12 14 Q15 14 15 10 L15 6 Z" />
      <ellipse cx={12} cy={10} rx={3} ry="1.2" />
      <path d="M12 14 L12 18 M10 18 L14 18" strokeWidth="1" fill="none" />
    </g>
  )

  const sword = (
    <g>
      <path
        d="M12 0 L12 22 M8 18 L16 18 L14 22 L10 22 Z"
        fill={HILT}
        stroke={GOLD_DARK}
        strokeWidth="0.5"
      />
      <path d="M12 0 L12 18" stroke={BLADE} strokeWidth="2.5" strokeLinecap="round" />
    </g>
  )

  const club = (
    <g fill={WOOD} stroke={WOOD_DARK} strokeWidth="0.6">
      <path d="M12 2 Q6 8 8 14 Q12 12 12 18 Q12 12 16 14 Q18 8 12 2 Z" />
    </g>
  )

  const pip = suit === 'oros' ? coin : suit === 'copas' ? chalice : suit === 'espadas' ? sword : club

  return (
    <g transform={`translate(${x}, ${y}) scale(${s}) rotate(${rotate}) translate(-${VB / 2}, -${VB / 2})`}>
      {pip}
    </g>
  )
}
