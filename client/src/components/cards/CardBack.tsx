const CARD_W = 70
const CARD_H = 98
const RADIUS = 6

export interface CardBackProps {
  width?: number
  height?: number
  /** Optional fill for the back pattern (e.g. blue, red). */
  accentColor?: string
  /** When set, show this number on the back (e.g. opponent card count). */
  count?: number
}

export function CardBack({ width = CARD_W, height = CARD_H, accentColor = '#1e3a5f' }: CardBackProps) {
  const scaleX = width / CARD_W
  const scaleY = height / CARD_H

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${CARD_W} ${CARD_H}`}
      className="card-back"
      role="img"
      aria-label="Card back"
    >
      <defs>
        <filter id="back-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1" dy="2" stdDeviation="1.5" floodOpacity="0.3" />
        </filter>
        <pattern id="back-pattern" patternUnits="userSpaceOnUse" width="12" height="12">
          <circle cx="2" cy="2" r="1" fill={accentColor} opacity="0.6" />
          <circle cx="8" cy="8" r="1" fill={accentColor} opacity="0.6" />
        </pattern>
        <linearGradient id="back-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2c5282" />
          <stop offset="1" stopColor="#1a365d" />
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
          fill="url(#back-fill)"
          stroke="#0d2137"
          strokeWidth="1"
          filter="url(#back-shadow)"
        />
        <rect
          x="4"
          y="4"
          width={CARD_W - 8}
          height={CARD_H - 8}
          rx={RADIUS - 2}
          ry={RADIUS - 2}
          fill="url(#back-pattern)"
          opacity="0.4"
        />
        <text
          x={CARD_W / 2}
          y={CARD_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.12)"
          fontSize="9"
          fontWeight="600"
          fontFamily="system-ui, sans-serif"
        >
          CONTI
        </text>
      </g>
    </svg>
  )
}
