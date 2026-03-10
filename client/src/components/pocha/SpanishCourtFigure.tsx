import type { SpanishSuit } from '@shared/pochaTypes'
import { POCHA_SUIT_COLOR } from './pochaCardUtils'

const CARD_W = 70
const CARD_H = 98
const CX = CARD_W / 2
const CY = CARD_H / 2

export interface SpanishCourtFigureProps {
  suit: SpanishSuit
  /** 10 = Sota, 11 = Caballo, 12 = Rey */
  rank: 10 | 11 | 12
}

/**
 * Traditional Baraja court: Sota (page), Caballo (knight), Rey (king).
 * Simplified but recognizable figures with suit-appropriate colors and props.
 */
export function SpanishCourtFigure({ suit, rank }: SpanishCourtFigureProps) {
  const color = POCHA_SUIT_COLOR[suit]
  const isOros = suit === 'oros'
  const isCopas = suit === 'copas'
  const isEspadas = suit === 'espadas'
  const isBastos = suit === 'bastos'

  // Tunic and accent colors per suit (traditional)
  const tunic = isOros ? '#2d5a27' : isCopas ? '#a52a2a' : isEspadas ? '#1a3a6a' : '#8b2914'
  const accent = isOros ? '#c9a227' : isCopas ? '#1a3a6a' : isEspadas ? '#c9a227' : '#2d5a27'

  if (rank === 10) {
    // Sota: standing figure holding suit symbol
    return (
      <g transform={`translate(${CX}, ${CY})`}>
        <g transform="translate(-14, -38) scale(0.9)">
          {/* Legs */}
          <path d="M4 42 L4 52 M12 42 L12 52" stroke={tunic} strokeWidth="2" fill="none" />
          <path d="M4 38 L4 42 M12 38 L12 42" stroke="#5c4033" strokeWidth="1.5" fill="none" />
          {/* Tunic */}
          <path d="M2 18 L4 38 L12 38 L14 18 Z" fill={tunic} stroke="#333" strokeWidth="0.5" />
          <path d="M6 18 L10 18 L10 28 L6 28 Z" fill={accent} opacity="0.6" />
          {/* Head */}
          <circle cx="8" cy="12" r="5" fill="#e8c4a0" stroke="#333" strokeWidth="0.5" />
          {/* Cap */}
          <path d="M3 10 Q8 4 13 10 L13 14 L3 14 Z" fill={accent} />
          {/* Raised arm with symbol */}
          <path d="M14 16 L22 8" stroke="#e8c4a0" strokeWidth="1.5" fill="none" />
          <g transform="translate(22, 6)">
            {isOros && <circle r="4" fill="#c9a227" stroke="#8b6914" strokeWidth="0.5" />}
            {isCopas && <path d="M0 -3 L-2 1 L0 3 L2 1 Z" fill="#c9a227" stroke="#8b6914" />}
            {isEspadas && <path d="M0 -4 L0 2 M-1 2 L1 2" stroke="#4a6fa5" strokeWidth="1" fill="none" />}
            {isBastos && <path d="M0 -3 Q-3 0 0 3 Q3 0 0 -3" fill="#2d5a27" stroke="#1e3d1a" />}
          </g>
        </g>
      </g>
    )
  }

  if (rank === 11) {
    // Caballo: rider on horse
    return (
      <g transform={`translate(${CX}, ${CY})`}>
        <g transform="translate(-16, -32) scale(0.85)">
          {/* Horse body */}
          <ellipse cx="12" cy="38" rx="14" ry="6" fill="#8b6914" stroke="#5c3d0a" strokeWidth="1" />
          <path d="M0 38 Q4 34 8 36 L16 36 Q20 34 24 38" stroke="#5c3d0a" strokeWidth="1" fill="none" />
          {/* Legs */}
          <path d="M6 40 L6 48 M12 42 L12 50 M18 40 L18 48" stroke="#5c3d0a" strokeWidth="1.5" fill="none" />
          {/* Rider body */}
          <path d="M8 22 L10 36 L14 36 L16 22 Z" fill={tunic} stroke="#333" strokeWidth="0.5" />
          <path d="M10 28 L14 28 L14 32 L10 32 Z" fill={accent} opacity="0.5" />
          {/* Head */}
          <circle cx="12" cy="16" r="4" fill="#e8c4a0" stroke="#333" strokeWidth="0.5" />
          {/* Helmet */}
          <path d="M8 14 Q12 10 16 14 L16 18 L8 18 Z" fill={isEspadas ? '#1a3a6a' : accent} />
          {/* Arm with staff/symbol */}
          <path d="M16 24 L24 14" stroke="#e8c4a0" strokeWidth="1.2" fill="none" />
          <g transform="translate(24, 12)">
            {isOros && <circle r="3" fill="#c9a227" />}
            {isCopas && <path d="M0 -2 L-1 1 L0 2 L1 1 Z" fill="#c9a227" />}
            {isEspadas && <path d="M0 -3 L0 2" stroke="#4a6fa5" strokeWidth="0.8" />}
            {isBastos && <path d="M0 -2 Q-2 0 0 2 Q2 0 0 -2" fill="#2d5a27" />}
          </g>
        </g>
      </g>
    )
  }

  // Rey (12): seated king with crown and scepter/symbol
  return (
    <g transform={`translate(${CX}, ${CY})`}>
      <g transform="translate(-14, -36) scale(0.9)">
        {/* Throne base */}
        <path d="M2 44 L26 44 L24 48 L4 48 Z" fill="#5c3d0a" stroke="#333" strokeWidth="0.5" />
        <path d="M6 40 L22 40 L20 44 L8 44 Z" fill="#8b6914" stroke="#333" strokeWidth="0.5" />
        {/* Robe */}
        <path d="M4 18 L6 44 L22 44 L24 18 Z" fill={tunic} stroke="#333" strokeWidth="0.5" />
        <path d="M10 24 L18 24 L18 36 L10 36 Z" fill={accent} opacity="0.5" />
        {/* Head */}
        <circle cx="14" cy="12" r="5" fill="#e8c4a0" stroke="#333" strokeWidth="0.5" />
        {/* Crown */}
        <path
          d="M9 8 L11 4 L14 6 L17 4 L19 8 L19 10 L9 10 Z"
          fill="#c9a227"
          stroke="#8b6914"
          strokeWidth="0.5"
        />
        {/* Scepter / symbol in hand */}
        <path d="M24 18 L30 8" stroke="#c9a227" strokeWidth="1" fill="none" />
        <g transform="translate(30, 6)">
          {isOros && <circle r="3" fill="#c9a227" />}
          {isCopas && <path d="M0 -2 L-1 1 L0 2 L1 1 Z" fill="#c9a227" />}
          {isEspadas && <path d="M0 -3 L0 2" stroke="#4a6fa5" strokeWidth="0.8" />}
          {isBastos && <path d="M0 -2 Q-2 0 0 2 Q2 0 0 -2" fill="#2d5a27" />}
        </g>
      </g>
    </g>
  )
}
