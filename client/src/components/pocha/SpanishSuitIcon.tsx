import type { SpanishSuit } from '@shared/pochaTypes'
import { POCHA_SUIT_COLOR } from './pochaCardUtils'

const W = 24
const H = 24

/**
 * Spanish suit icons (baraja española style).
 * Oros: coin. Copas: chalice. Espadas: sword. Bastos: cudgel.
 * Stylized for clarity at small sizes; inspired by public-domain Spanish deck symbols.
 */
export function SpanishSuitIcon({
  suit,
  color,
  size = 1,
}: {
  suit: SpanishSuit
  color?: string
  size?: number
}) {
  const c = color ?? POCHA_SUIT_COLOR[suit]
  const s = size
  const viewBox = `0 0 ${W} ${H}`

  const paths: Record<SpanishSuit, string> = {
    oros:
      'M12 1.5c-2.5 0-4.5 1.5-5.5 3.5-.2.4-.4.8-.5 1.2-.5 1.6 0 3.2 1.2 4.4 1.2 1.2 2.8 1.8 4.5 1.8s3.3-.6 4.5-1.8c1.2-1.2 1.7-2.8 1.2-4.4-.1-.4-.3-.8-.5-1.2-1-2-3-3.5-5.5-3.5zm0 3c1.5 0 2.8.8 3.5 2 .3.5.4 1 .4 1.5 0 1.7-1.3 3-3 3s-3-1.3-3-3c0-.5.1-1 .4-1.5.7-1.2 2-2 3.5-2z',
    copas:
      'M12 2l-2.2 3.5h1.2v3h2v-3h1.2L12 2zM7 9.5c-1.5 0-2.8 1-3.2 2.4-.2.6-.2 1.2 0 1.8.5 1.4 1.8 2.3 3.2 2.3h10c1.4 0 2.7-.9 3.2-2.3.2-.6.2-1.2 0-1.8C19.8 10.5 18.5 9.5 17 9.5H7zm0 2h10c.6 0 1 .4 1 1v1.5H6v-1.5c0-.6.4-1 1-1z',
    espadas:
      'M12 .8L2 8.5c0 2.2 1.2 3.8 2.8 4.4.8.3 1.6.2 2.4-.2.8-.4 1.4-1 1.8-1.7.4-.7.6-1.5.6-2.3 0-.5-.1-1-.3-1.4L12 2.5l2.7 5.8c-.2.4-.3.9-.3 1.4 0 .8.2 1.6.6 2.3.4.7 1 1.3 1.8 1.7.8.4 1.6.5 2.4.2 1.6-.6 2.8-2.2 2.8-4.4L12 .8zm0 11.2l-1.5 5h3l-1.5-5z',
    bastos:
      'M12 1.2c-1.8 0-3.2 1-3.8 2.5-.3.6-.4 1.2-.4 1.8 0 .8.3 1.5.8 2.1.6.6 1.3 1 2.1 1.1.4.8 1 1.5 1.8 1.9.2 1 .9 1.8 1.8 2.2v2.5h2v-2.5c.9-.4 1.6-1.2 1.8-2.2.8-.4 1.4-1.1 1.8-1.9.8-.1 1.5-.5 2.1-1.1.5-.6.8-1.3.8-2.1 0-.6-.1-1.2-.4-1.8-.6-1.5-2-2.5-3.8-2.5z',
  }

  return (
    <svg viewBox={viewBox} width={W * s} height={H * s} aria-hidden>
      <path fill={c} d={paths[suit]} />
    </svg>
  )
}
