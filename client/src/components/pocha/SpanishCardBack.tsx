const CARD_W = 70
const CARD_H = 98
const RADIUS = 6

// Static bull back artwork. Put the PNG in client/public at this path.
const BULL_BACK_SRC = '/bull-back.png'

export interface SpanishCardBackProps {
  width?: number
  height?: number
  count?: number
}

export function SpanishCardBack({
  width = CARD_W,
  height = CARD_H,
  count,
}: SpanishCardBackProps) {
  const scaleX = width / CARD_W
  const scaleY = height / CARD_H

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className="card-back pocha-card-back"
      role="img"
      aria-label="Card back"
    >
      <g transform={`scale(${scaleX}, ${scaleY})`}>
        <rect
          x="0"
          y="0"
          width={CARD_W}
          height={CARD_H}
          rx={RADIUS}
          ry={RADIUS}
          fill="#000"
          stroke="#c9a227"
          strokeWidth="2"
          opacity="0.95"
        />
        {/* Bull artwork from static PNG */}
        <image
          href={BULL_BACK_SRC}
          x="2"
          y="2"
          width={CARD_W - 4}
          height={CARD_H - 4}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`inset(0 round ${RADIUS - 1})`}
        />
        {/* Optional count badge on top-right when used as facedown stack indicator */}
        <text
          x={CARD_W - 6}
          y={10}
          textAnchor="end"
          dominantBaseline="hanging"
          fill={count != null ? 'rgba(255,255,255,0.98)' : 'transparent'}
          fontSize="12"
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          {count != null ? String(count) : ''}
        </text>
      </g>
    </svg>
  )
}
