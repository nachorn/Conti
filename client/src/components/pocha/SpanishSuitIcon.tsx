import type { SpanishSuit } from '@shared/pochaTypes'
import { POCHA_SUIT_COLOR } from './pochaCardUtils'

const W = 24
const H = 24

/** Simple SVG icons for Spanish suits: oros (coin), copas (cup), espadas (sword), bastos (club). */
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

  const paths: Record<SpanishSuit, string> = {
    oros: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 3c3.9 0 7 3.1 7 7s-3.1 7-7 7-7-3.1-7-7 3.1-7 7-7z',
    copas: 'M12 2L9 6h2v4h2V6h2L12 2zm-4 10c-2.2 0-4 1.8-4 4v2h16v-2c0-2.2-1.8-4-4-4H8z',
    espadas: 'M12 2L2 10c0 4 3 6 5 6 1 0 2-.5 3-1.5 1 1 2 1.5 3 1.5 2 0 5-2 5-6L12 2zm0 10l-2 6h4l-2-6z',
    bastos: 'M12 2c-2 0-3.5 1.5-3.5 3.5 0 1.5 1 2.5 2 3-.5.5-1.5 1.5-1.5 3v2h6v-2c0-1.5-1-2.5-1.5-3 1-.5 2-1.5 2-3C15.5 3.5 14 2 12 2z',
  }

  return (
    <svg viewBox={viewBox} width={W * s} height={H * s} aria-hidden>
      <path fill={c} d={paths[suit]} />
    </svg>
  )
}
