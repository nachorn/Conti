import { useCosmetics } from '../Cosmetics'
import { CardBackArtwork } from '../cards/CardBackArtwork'

export interface SpanishCardBackProps {
  width?: number
  height?: number
  count?: number
}
export function SpanishCardBack({ width = 72, height = 100, count }: SpanishCardBackProps) {
  const { selection, lang } = useCosmetics()
  return <CardBackArtwork variant={selection.cardBack} width={width} height={height} count={count} label={lang === 'es' ? 'Reverso de carta' : 'Card back'} />
}
