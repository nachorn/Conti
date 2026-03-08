const CARD_W = 70
const CARD_H = 98
const RADIUS = 6

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
      <defs>
        <filter id="pocha-back-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodOpacity="0.3" />
        </filter>
        <pattern id="pocha-back-pattern" patternUnits="userSpaceOnUse" width="16" height="16">
          <path d="M0 0h4v4H0zM8 8h4v4H8z" fill="#8b6914" opacity="0.25" />
          <path d="M4 4h4v4H4zM12 0h4v4h-4zM0 12h4v4H0z" fill="#5c3d0a" opacity="0.2" />
        </pattern>
        <linearGradient id="pocha-back-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6b4423" />
          <stop offset="0.5" stopColor="#4a2f18" />
          <stop offset="1" stopColor="#2d1a0d" />
        </linearGradient>
        <linearGradient id="pocha-back-border" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8b6914" />
          <stop offset="1" stopColor="#3d2612" />
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
          fill="url(#pocha-back-fill)"
          stroke="url(#pocha-back-border)"
          strokeWidth="1.5"
          filter="url(#pocha-back-shadow)"
        />
        <rect
          x="4"
          y="4"
          width={CARD_W - 8}
          height={CARD_H - 8}
          rx={RADIUS - 2}
          ry={RADIUS - 2}
          fill="url(#pocha-back-pattern)"
          opacity="0.4"
        />
        <text
          x={CARD_W / 2}
          y={CARD_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={count != null ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.2)'}
          fontSize={count != null ? '18' : '12'}
          fontWeight="700"
          fontFamily="system-ui, sans-serif"
        >
          {count != null ? String(count) : 'POCHA'}
        </text>
      </g>
    </svg>
  )
}
