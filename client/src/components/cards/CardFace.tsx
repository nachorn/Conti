import { SuitIcon } from './SuitIcon'
import { rankLabel, SUIT_COLOR } from './cardUtils'
import type { Suit } from '@shared/types'

const CARD_W = 70
const CARD_H = 98
const RADIUS = 6

export interface CardFaceProps {
  suit: Suit
  rank: number
  width?: number
  height?: number
  /** Emphasize as wild (e.g. deuce or joker). */
  isWild?: boolean
}

export function CardFace({ suit, rank, width = CARD_W, height = CARD_H, isWild }: CardFaceProps) {
  const color = SUIT_COLOR[suit]
  const label = rankLabel(rank)
  const isJoker = suit === 'joker'

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className="card-face"
      role="img"
      aria-label={`${label} of ${suit}`}
    >
      <defs>
        <filter id="card-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodOpacity="0.25" />
        </filter>
        <linearGradient id="card-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#f5f5f5" />
        </linearGradient>
      </defs>
      <g>
        <rect
          x="0"
          y="0"
          width={CARD_W}
          height={CARD_H}
          rx={RADIUS}
          ry={RADIUS}
          fill="url(#card-fill)"
          stroke={isWild ? '#d4a017' : '#333'}
          strokeWidth={isWild ? 2.5 : 1}
          filter="url(#card-shadow)"
        />
        <text
          x={CARD_W / 2}
          y="13"
          textAnchor="middle"
          dominantBaseline="hanging"
          fill={color}
          fontSize={isJoker ? 10 : 24}
          fontWeight="800"
          fontFamily={isJoker ? "system-ui, sans-serif" : "'Cormorant Garamond', Georgia, serif"}
          letterSpacing={isJoker ? 0.8 : -0.4}
        >
          {isJoker ? 'JOKER' : label}
        </text>
        <g transform="translate(18.2, 49)">
          <SuitIcon suit={suit} color={color} size={1.4} />
        </g>
      </g>
    </svg>
  )
}
