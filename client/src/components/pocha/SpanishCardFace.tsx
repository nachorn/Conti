import React from 'react'
import type { SpanishSuit } from '@shared/pochaTypes'
import { pochaRankLabel, pochaRankLong, POCHA_SUIT_COLOR, POCHA_SUIT_LABEL } from './pochaCardUtils'
import { SpanishSuitIcon } from './SpanishSuitIcon'

const CARD_W = 70
const CARD_H = 98
const RADIUS = 6
const RANK_FONT_SIZE = 22
const SUIT_ICON_SIZE = 1.7
const SUIT_ICON_DIMENSION = 24 * SUIT_ICON_SIZE

export interface SpanishCardFaceProps {
  suit: SpanishSuit
  rank: number
  width?: number
  height?: number
  /** Highlight as trump (e.g. border). */
  isTrump?: boolean
}

/** Compact Baraja Española face with one rank and one suit symbol. */
export function SpanishCardFace({
  suit,
  rank,
  width = CARD_W,
  height = CARD_H,
  isTrump = false,
}: SpanishCardFaceProps) {
  const uid = React.useId().replace(/:/g, '')
  const color = POCHA_SUIT_COLOR[suit]
  const rankLabel = pochaRankLabel(rank)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className="card-face pocha-card-face"
      role="img"
      aria-label={`${pochaRankLong(rank)} de ${POCHA_SUIT_LABEL[suit]}`}
    >
      <defs>
        <filter id={`pocha-shadow-${uid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodOpacity="0.25" />
        </filter>
        <linearGradient id={`pocha-face-fill-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#f8f8f8" />
        </linearGradient>
      </defs>
      <g>
        {/* Traditional white face and black border */}
        <rect
          x="0"
          y="0"
          width={CARD_W}
          height={CARD_H}
          rx={RADIUS}
          ry={RADIUS}
          fill={`url(#pocha-face-fill-${uid})`}
          stroke={isTrump ? '#c9a227' : '#1a1a1a'}
          strokeWidth={isTrump ? 2.5 : 1}
          filter={`url(#pocha-shadow-${uid})`}
        />
        {/* Inner dashed border (traditional Baraja look) */}
        <rect
          x="3"
          y="3"
          width={CARD_W - 6}
          height={CARD_H - 6}
          rx={RADIUS - 2}
          ry={RADIUS - 2}
          fill="none"
          stroke="#333"
          strokeWidth="0.8"
          strokeDasharray="3 2"
          opacity="0.6"
        />
        {/* Large rank stays legible when the card is scaled down on phones. */}
        <text
          x={CARD_W / 2}
          y="11"
          textAnchor="middle"
          dominantBaseline="hanging"
          fill={color}
          fontSize={RANK_FONT_SIZE}
          fontWeight="800"
          fontFamily="'Cormorant Garamond', Georgia, serif"
        >
          {rankLabel}
        </text>

        {/* Exactly one suit mark keeps every card easy to scan in a narrow hand. */}
        <g transform={`translate(${(CARD_W - SUIT_ICON_DIMENSION) / 2}, 47)`}>
          <SpanishSuitIcon suit={suit} color={color} size={SUIT_ICON_SIZE} />
        </g>
      </g>
    </svg>
  )
}
