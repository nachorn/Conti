import { useCosmetics } from '../Cosmetics'
import { CardBackArtwork } from './CardBackArtwork'

export interface CardBackProps {
  width?: number
  height?: number
  accentColor?: string
}
export function CardBack({ width = 72, height = 100 }: CardBackProps) {
  const { selection, lang } = useCosmetics()
  return <CardBackArtwork variant={selection.cardBack} width={width} height={height} label={lang === 'es' ? 'Reverso de carta' : 'Card back'} />
}
