import React from 'react'
import type { SpanishSuit } from '@shared/pochaTypes'
import { pochaRankLabel, POCHA_SUIT_COLOR } from './pochaCardUtils'
import { getPipLayout, isCrossedOrFanned } from './spanishPipLayouts'
import { SpanishPip } from './SpanishPip'
import { SpanishCourtFigure } from './SpanishCourtFigure'

const CARD_W = 70
const CARD_H = 98
const RADIUS = 6
const CORNER_FONT_SIZE = 10

export interface SpanishCardFaceProps {
  suit: SpanishSuit
  rank: number
  width?: number
  height?: number
  /** Highlight as trump (e.g. border). */
  isTrump?: boolean
}

/**
 * Traditional Baraja Española face: white card, black border, corner indices,
 * pip layouts (1–9) or court figures (Sota, Caballo, Rey).
 */
export function SpanishCardFace({
  suit,
  rank,
  width = CARD_W,
  height = CARD_H,
  isTrump = false,
}: SpanishCardFaceProps) {
  const uid = React.useId().replace(/:/g, '')
  const scaleX = width / CARD_W
  const scaleY = height / CARD_H
  const color = POCHA_SUIT_COLOR[suit]
  const cornerLabel = String(rank)
  const isFaceCard = rank === 10 || rank === 11 || rank === 12
  const layout = !isFaceCard ? getPipLayout(rank, suit) : null
  const crossedOrFanned = !isFaceCard && isCrossedOrFanned(rank, suit)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className="card-face pocha-card-face"
      role="img"
      aria-label={`${pochaRankLabel(rank)} de ${suit}`}
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
      <g transform={`scale(${scaleX}, ${scaleY})`}>
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
        {/* Corner indices: top-left */}
        <text
          x="8"
          y="14"
          textAnchor="start"
          dominantBaseline="hanging"
          fill={color}
          fontSize={CORNER_FONT_SIZE}
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          {cornerLabel}
        </text>
        {/* Corner indices: bottom-right (upside down) */}
        <g transform={`translate(${CARD_W - 8}, ${CARD_H - 14}) rotate(180)`}>
          <text
            x="0"
            y="0"
            textAnchor="start"
            dominantBaseline="hanging"
            fill={color}
            fontSize={CORNER_FONT_SIZE}
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
          >
            {cornerLabel}
          </text>
        </g>

        {/* Center: pips (1–9) or court figure (10–12) */}
        {isFaceCard ? (
          <SpanishCourtFigure suit={suit} rank={rank as 10 | 11 | 12} />
        ) : layout ? (
          layout.map(([px, py], i) => {
            const isAce = rank === 1
            const size = isAce ? 1.5 : rank === 2 || rank === 3 ? 0.85 : 0.65
            let rotate = 0
            if (crossedOrFanned && rank === 2) rotate = i === 0 ? -45 : 45
            if (crossedOrFanned && rank === 3) rotate = i === 0 ? 0 : i === 1 ? -30 : 30
            return <SpanishPip key={i} suit={suit} x={px} y={py} size={size} rotate={rotate} />
          })
        ) : null}
      </g>
    </svg>
  )
}
