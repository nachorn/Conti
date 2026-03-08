import type { SpanishSuit } from '@shared/pochaTypes'

export const POCHA_SUIT_COLOR: Record<SpanishSuit, string> = {
  oros: '#c9a227',
  copas: '#a52a2a',
  espadas: '#1a1a1a',
  bastos: '#2d5a27',
}

export const POCHA_SUIT_LABEL: Record<SpanishSuit, string> = {
  oros: 'Oros',
  copas: 'Copas',
  espadas: 'Espadas',
  bastos: 'Bastos',
}

/** Short rank label: 1=As, 2-7, 10=Sota, 11=Caballo, 12=Rey */
export function pochaRankLabel(rank: number): string {
  if (rank >= 1 && rank <= 7) return String(rank)
  const face: Record<number, string> = { 10: 'S', 11: 'C', 12: 'R' }
  return face[rank] ?? '?'
}

/** Long rank label for accessibility */
export function pochaRankLong(rank: number): string {
  if (rank === 1) return 'As'
  if (rank >= 2 && rank <= 7) return String(rank)
  if (rank === 10) return 'Sota'
  if (rank === 11) return 'Caballo'
  if (rank === 12) return 'Rey'
  return '?'
}
