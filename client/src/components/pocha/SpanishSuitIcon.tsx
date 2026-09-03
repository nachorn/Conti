import type { ReactNode } from 'react'
import type { SpanishSuit } from '@shared/pochaTypes'
import { POCHA_SUIT_COLOR } from './pochaCardUtils'

const W = 24
const H = 24

/**
 * Spanish suit icons (baraja española style).
 * Oros: coin. Copas: chalice. Espadas: sword. Bastos: cudgel.
 * Stylized for clarity at small sizes; inspired by public-domain Spanish deck symbols.
 */
export function SpanishSuitIcon({
  suit,
  color,
  size = 1,
}: {
  suit: SpanishSuit
  color?: string
  size?: number
}) {
  const c = color ?? POCHA_SUIT_COLOR[suit]
  const s = size
  const viewBox = `0 0 ${W} ${H}`

  const symbol: Record<SpanishSuit, ReactNode> = {
    oros: (
      <g>
        <circle cx="12" cy="12" r="8.25" fill={c} />
        <circle cx="12" cy="12" r="4.7" fill="#fffaf0" opacity="0.9" />
        <circle cx="12" cy="12" r="2.3" fill={c} />
      </g>
    ),
    copas: (
      <path
        fill={c}
        d="M5 2.5h14v4.2c0 4.2-2.3 7.2-5.4 8.1v3.4H18V21H6v-2.8h4.4v-3.4C7.3 13.9 5 10.9 5 6.7V2.5zm3 3v1.2c0 3.2 1.6 5.4 4 5.4s4-2.2 4-5.4V5.5H8z"
      />
    ),
    espadas: (
      <path
        fill={c}
        d="M18.8 1.5 22 1.8l.3 3.2-10.6 10.6-3.5-3.5L18.8 1.5zM6.9 11.4l5.7 5.7-1.7 1.7-1.5-1.5-3.8 3.8-2.7-2.7 3.8-3.8-1.5-1.5 1.7-1.7z"
      />
    ),
    bastos: (
      <path
        fill={c}
        d="M7.1 22.2c-1.4-.6-2-2.2-1.3-3.6L13 3.8c.8-1.7 2.8-2.5 4.5-1.7 1.7.8 2.3 2.9 1.3 4.5l-1.6 2.5 2.6.9-1 2.7-3.1-1.1-1.8 3.8 2.2 1.5-1.6 2.4-1.8-1.2-1.3 2.7c-.7 1.4-2.8 2-4.3 1.4z"
      />
    ),
  }

  return (
    <svg viewBox={viewBox} width={W * s} height={H * s} aria-hidden>
      {symbol[suit]}
    </svg>
  )
}
