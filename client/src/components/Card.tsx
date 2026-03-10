import type { Card as CardType } from '../types'
import { CardBack } from './cards/CardBack'
import './Card.css'

const RANK_SYMBOLS: Record<number, string> = {
  0: '★', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9',
  10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A',
}

interface CardProps {
  card: CardType
  faceDown?: boolean
  selected?: boolean
  onClick?: () => void
  size?: 'small' | 'normal' | 'large'
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  /** When true, hide the bottom corner (upside-down rank/suit) to reduce clutter in hand. */
  hideBottomCorner?: boolean
}

export function Card({ card, faceDown, selected, onClick, size = 'normal', draggable, onDragStart, hideBottomCorner }: CardProps) {
  const rank = RANK_SYMBOLS[card.rank] ?? '?'
  const isRed = card.suit === 'hearts' || card.suit === 'diamonds'
  const suitChar = card.suit === 'joker' ? '★' : { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' }[card.suit] ?? ''

  if (faceDown) {
    const dims =
      size === 'small'
        ? { width: 48, height: 67 }
        : size === 'large'
          ? { width: 90, height: 125 }
          : { width: 72, height: 100 }
    return (
      <div className={`card card-${size}`} data-selected={selected} onClick={onClick}>
        <CardBack width={dims.width} height={dims.height} />
      </div>
    )
  }

  return (
    <div
      className={`card card-${size} ${isRed ? 'card-red' : 'card-black'}`}
      data-selected={selected}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <div className="card-corner card-top">
        <span className="card-rank">{rank}</span>
        <span className="card-suit">{suitChar}</span>
      </div>
      <div className="card-center">
        {card.suit === 'joker' ? (
          <span className="card-joker">JOKER</span>
        ) : (
          <span className="card-suit-large">{suitChar}</span>
        )}
      </div>
      {!hideBottomCorner && (
        <div className="card-corner card-bottom">
          <span className="card-rank">{rank}</span>
          <span className="card-suit">{suitChar}</span>
        </div>
      )}
    </div>
  )
}
