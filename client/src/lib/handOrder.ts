export type CardDropSide = 'before' | 'after'

/** Return a new card order with one card inserted beside another. */
export function moveHandCard(
  order: string[],
  draggedId: string,
  targetId: string,
  side: CardDropSide,
): string[] {
  if (draggedId === targetId || !order.includes(draggedId) || !order.includes(targetId)) return order

  const next = order.filter((id) => id !== draggedId)
  let targetIndex = next.indexOf(targetId)
  if (targetIndex < 0) return order
  if (side === 'after') targetIndex++
  next.splice(targetIndex, 0, draggedId)

  return next.every((id, index) => id === order[index]) ? order : next
}

export function cardDropSide(pointerX: number, targetLeft: number, targetWidth: number): CardDropSide {
  return pointerX >= targetLeft + targetWidth / 2 ? 'after' : 'before'
}
