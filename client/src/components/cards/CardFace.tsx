import { SuitIcon } from './SuitIcon'
import { rankLabel, SUIT_COLOR } from './cardUtils'
import type { Suit } from '@shared/types'

const CARD_W = 70
const CARD_H = 98
const RADIUS = 6
const PAD = 6

export interface CardFaceProps {
  suit: Suit
  rank: number
  width?: number
  height?: number
  /** Emphasize as wild (e.g. deuce or joker). */
  isWild?: boolean
}

export function CardFace({ suit, rank, width = CARD_W, height = CARD_H, isWild }: CardFaceProps) {
  const scaleX = width / CARD_W
  const scaleY = height / CARD_H
  const color = SUIT_COLOR[suit]
  const label = rankLabel(rank)

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
      <g transform={`scale(${scaleX}, ${scaleY})`}>
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
        {/* Top-left rank + suit */}
        <g transform={`translate(${PAD}, ${PAD})`}>
          <text
            x="0"
            y="0"
            textAnchor="start"
            dominantBaseline="hanging"
            fill={color}
            fontSize="14"
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
          >
            {label}
          </text>
          <g transform="translate(0, 16)">
            <SuitIcon suit={suit} color={color} size={0.9} />
          </g>
        </g>
        {/* Center suit (larger) for number cards; joker text */}
        <g transform={`translate(${CARD_W / 2}, ${CARD_H / 2})`}>
          {suit === 'joker' ? (
            <text
              textAnchor="middle"
              dominantBaseline="middle"
              fill={color}
              fontSize="11"
              fontWeight="700"
              fontFamily="system-ui, sans-serif"
            >
              JOKER
            </text>
          ) : (
            <g transform="translate(-12, -12)">
              <SuitIcon suit={suit} color={color} size={1.4} />
            </g>
          )}
        </g>
        {/* Bottom-right rank + suit (inverted) */}
        <g transform={`translate(${CARD_W - PAD}, ${CARD_H - PAD}) rotate(180)`}>
          <text
            x="0"
            y="0"
            textAnchor="start"
            dominantBaseline="hanging"
            fill={color}
            fontSize="14"
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
          >
            {label}
          </text>
          <g transform="translate(0, 16)">
            <SuitIcon suit={suit} color={color} size={0.9} />
          </g>
        </g>
      </g>
    </svg>
  )
}
