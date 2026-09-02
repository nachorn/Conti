import type { PochaCard } from '@shared/pochaTypes'
import { SpanishCardFace } from './SpanishCardFace'
import { SpanishCardBack } from './SpanishCardBack'
import { POCHA_SUIT_LABEL, pochaRankLong } from './pochaCardUtils'

export interface SpanishCardProps {
  card: PochaCard
  faceDown?: boolean
  width?: number
  height?: number
  isTrump?: boolean
  selected?: boolean
  onClick?: () => void
  ariaLabel?: string
}

export function SpanishCard({
  card,
  faceDown = false,
  width,
  height,
  isTrump = false,
  selected,
  onClick,
  ariaLabel,
}: SpanishCardProps) {
  const label = ariaLabel ?? (faceDown
    ? 'Card back'
    : `${pochaRankLong(card.rank)} de ${POCHA_SUIT_LABEL[card.suit]}`)
  const graphic = faceDown
    ? <SpanishCardBack width={width} height={height} />
    : (
      <SpanishCardFace
        suit={card.suit}
        rank={card.rank}
        width={width}
        height={height}
        isTrump={isTrump}
      />
    )

  if (onClick) {
    return (
      <button
        type="button"
        className="pocha-card-wrap pocha-card-button"
        data-selected={selected}
        onClick={onClick}
        aria-label={label}
        aria-pressed={selected}
      >
        {graphic}
      </button>
    )
  }

  return (
    <div
      className="pocha-card-wrap"
      data-selected={selected}
    >
      {graphic}
    </div>
  )
}
