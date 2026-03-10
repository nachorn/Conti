const CARD_W = 70
const CARD_H = 98
const RADIUS = 6

// Shared bull-back artwork used for both Continental and Pocha.
const BULL_BACK_SRC = '/bull-back.png'

export interface CardBackProps {
  width?: number
  height?: number
  /** Optional fill for the back pattern (e.g. blue, red). */
  accentColor?: string
}

export function CardBack({ width = CARD_W, height = CARD_H }: CardBackProps) {
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
        <image
          href={BULL_BACK_SRC}
          x="2"
          y="2"
          width={CARD_W - 4}
          height={CARD_H - 4}
          preserveAspectRatio="xMidYMid slice"
        />
      </g>
    </svg>
  )
}
