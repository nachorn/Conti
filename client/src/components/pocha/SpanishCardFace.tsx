import type { SpanishSuit } from '@shared/pochaTypes'
import { SpanishSuitIcon } from './SpanishSuitIcon'
import { pochaRankLabel, POCHA_SUIT_COLOR } from './pochaCardUtils'

const CARD_W = 70
const CARD_H = 98
const RADIUS = 6
const PAD = 6

export interface SpanishCardFaceProps {
  suit: SpanishSuit
  rank: number
  width?: number
  height?: number
  /** Highlight as trump (e.g. border). */
  isTrump?: boolean
}

export function SpanishCardFace({
  suit,
  rank,
  width = CARD_W,
  height = CARD_H,
  isTrump = false,
}: SpanishCardFaceProps) {
  const scaleX = width / CARD_W
  const scaleY = height / CARD_H
  const color = POCHA_SUIT_COLOR[suit]
  const label = pochaRankLabel(rank)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className="card-face pocha-card-face"
      role="img"
      aria-label={`${label} de ${suit}`}
    >
      <defs>
        <filter id="pocha-card-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodOpacity="0.25" />
        </filter>
        <linearGradient id="pocha-card-fill" x1="0" y1="0" x2="1" y2="1">
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
          fill="url(#pocha-card-fill)"
          stroke={isTrump ? '#c9a227' : '#333'}
          strokeWidth={isTrump ? 2.5 : 1}
          filter="url(#pocha-card-shadow)"
        />
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
            <SpanishSuitIcon suit={suit} color={color} size={0.9} />
          </g>
        </g>
        <g transform={`translate(${CARD_W / 2}, ${CARD_H / 2})`}>
          <g transform="translate(-12, -12)">
            <SpanishSuitIcon suit={suit} color={color} size={1.4} />
          </g>
        </g>
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
            <SpanishSuitIcon suit={suit} color={color} size={0.9} />
          </g>
        </g>
      </g>
    </svg>
  )
}
