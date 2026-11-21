import { useState } from 'react'
import type { Lang } from '../i18n'
import type { ActionResult } from '../types'
import './RemoveLobbyPlayer.css'

export function RemoveLobbyPlayer({ player, lang, available, onRemove }: {
  player: { id: string; name: string; connected: boolean }
  lang: Lang
  available: boolean
  onRemove?: (playerId: string) => Promise<ActionResult>
}) {
  const [pending, setPending] = useState(false)
  if (player.connected || !onRemove) return null
  const es = lang === 'es'
  return <button type="button" className="lobby-remove-player" disabled={!available || pending}
    aria-label={es ? `Quitar a ${player.name} del lobby` : `Remove ${player.name} from the lobby`}
    onClick={async () => {
      setPending(true)
      try { await onRemove(player.id) } finally { setPending(false) }
    }}>
    {es ? 'Quitar' : 'Remove'}
  </button>
}
