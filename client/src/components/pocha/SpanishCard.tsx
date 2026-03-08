import type { PochaCard } from '@shared/pochaTypes'
import { SpanishCardFace } from './SpanishCardFace'
import { SpanishCardBack } from './SpanishCardBack'

export interface SpanishCardProps {
  card: PochaCard
  faceDown?: boolean
  width?: number
  height?: number
  isTrump?: boolean
  selected?: boolean
  onClick?: () => void
}

export function SpanishCard({
  card,
  faceDown = false,
  width,
  height,
  isTrump = false,
  selected,
  onClick,
}: SpanishCardProps) {
  if (faceDown) {
    return (
      <div
        className="pocha-card-wrap"
        data-selected={selected}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
      >
        <SpanishCardBack width={width} height={height} />
      </div>
    )
  }
  return (
    <div
      className="pocha-card-wrap"
      data-selected={selected}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <SpanishCardFace
        suit={card.suit}
        rank={card.rank}
        width={width}
        height={height}
        isTrump={isTrump}
      />
    </div>
  )
}
