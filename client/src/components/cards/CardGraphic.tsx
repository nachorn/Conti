import type { Card } from '@shared/types'
import { CardFace } from './CardFace'
import { CardBack } from './CardBack'

export interface CardGraphicProps {
  card: Card
  faceDown?: boolean
  width?: number
  height?: number
}

/** Renders a single Continental Rummy card (face or back). */
export function CardGraphic({ card, faceDown = false, width, height }: CardGraphicProps) {
  if (faceDown) {
    return <CardBack width={width} height={height} />
  }
  return (
    <CardFace
      suit={card.suit}
      rank={card.rank}
      width={width}
      height={height}
      isWild={card.isWild}
    />
  )
}

export { CardFace } from './CardFace'
export { CardBack } from './CardBack'
