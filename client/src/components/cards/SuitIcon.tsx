import type { Suit } from '@shared/types'

const W = 24
const H = 24

/** Inline SVG suit icons for hearts, diamonds, clubs, spades. Joker uses text. */
export function SuitIcon({ suit, color, size = 1 }: { suit: Suit; color: string; size?: number }) {
  const s = size
  const viewBox = `0 0 ${W} ${H}`
  const style = { width: W * s, height: H * s }

  if (suit === 'joker') {
    return (
      <span style={{ ...style, color, fontSize: `${W * s * 0.9}px`, lineHeight: 1, display: 'inline-block' }} aria-hidden>
        🃏
      </span>
    )
  }

  const paths: Record<Exclude<Suit, 'joker'>, string> = {
    hearts: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
    diamonds: 'M12 2L2 12l10 10 10-10L12 2z',
    clubs: 'M12 2c-2 0-3.5 1.5-3.5 3.5 0 1.5 1 2.5 2 3-.5.5-1.5 1.5-1.5 3v2h6v-2c0-1.5-1-2.5-1.5-3 1-.5 2-1.5 2-3C15.5 3.5 14 2 12 2z',
    spades: 'M12 2L2 10c0 4 3 6 5 6 1 0 2-.5 3-1.5 1 1 2 1.5 3 1.5 2 0 5-2 5-6L12 2zm0 10l-2 6h4l-2-6z',
  }

  const d = paths[suit as Exclude<Suit, 'joker'>]
  if (!d) return null

  return (
    <svg viewBox={viewBox} width={W * s} height={H * s} style={style} aria-hidden>
      <path fill={color} d={d} />
    </svg>
  )
}
