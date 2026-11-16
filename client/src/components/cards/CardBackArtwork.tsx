import { useId } from 'react'
import type { CardBackStyle } from '../../lib/cosmetics'

export function CardBackArtwork({ variant = 'bull', width = 72, height = 100, label = 'Card back', count }: {
  variant?: CardBackStyle; width?: number; height?: number; label?: string; count?: number
}) {
  const pattern = useId()
  return <svg width={width} height={height} viewBox="0 0 72 100" className="card-back" role="img" aria-label={label}>
    <rect x="1" y="1" width="70" height="98" rx="8" fill={variant === 'linen' ? '#f1ead9' : '#142b43'} stroke="#d9bc75" strokeWidth="2" />
    {variant === 'bull' ? <image href="/bull-back.png" x="-2" y="-2" width="76" height="104" preserveAspectRatio="xMidYMid slice" /> : <>
      <defs><pattern id={pattern} width={variant === 'linen' ? 6 : 16} height={variant === 'linen' ? 6 : 16} patternUnits="userSpaceOnUse">
        {variant === 'linen' ? <path d="M0 1H6M1 0V6" stroke="#c6b48d" strokeWidth=".6" opacity=".65" /> : <path d="M8 0 16 8 8 16 0 8Z" fill="none" stroke="#d9bc75" strokeWidth=".75" opacity=".6" />}
      </pattern></defs>
      <rect x="6" y="6" width="60" height="88" rx="4" fill={`url(#${pattern})`} stroke={variant === 'linen' ? '#9b8153' : '#d9bc75'} />
      <path d="m36 31 13 19-13 19-13-19Z" fill={variant === 'linen' ? '#f1ead9' : '#142b43'} stroke={variant === 'linen' ? '#9b8153' : '#d9bc75'} strokeWidth="2" />
      <path d="m31 54 5-10 5 10m-8-3h6" fill="none" stroke={variant === 'linen' ? '#705832' : '#efd18b'} strokeWidth="1.5" />
    </>}
    {count !== undefined && <text x="66" y="10" textAnchor="end" dominantBaseline="hanging" fill={variant === 'linen' ? '#243723' : '#fff'} fontSize="12" fontWeight="700" fontFamily="system-ui, sans-serif">{count}</text>}
  </svg>
}
