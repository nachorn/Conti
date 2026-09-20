import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../i18n'
import type { ActionResult, GameState } from '../types'
import type { SavedGame } from '../lib/savedGames'
import './SavedGames.css'

export function SavedGames({ games, lang, connected, resume, forget }: {
  games: SavedGame[]; lang: Lang; connected: boolean
  resume: (game: SavedGame) => void; forget: (game: SavedGame) => void
}) {
  const es = lang === 'es'
  return <section className="saved-games" aria-labelledby="saved-games-title">
    <h2 id="saved-games-title">{es ? 'Mis partidas' : 'My games'}</h2>
    <p>{es ? 'Sin cuentas. Vuelve desde este navegador; conservamos la partida durante 30 días de inactividad. Borrar los datos del navegador elimina tu acceso.' : 'No account needed. Return from this browser; games are kept for 30 days of inactivity. Clearing browser data removes your access.'}</p>
    {!games.length && <p className="saved-empty">{es ? 'Tus partidas aparecerán aquí al crear o unirte a una sala.' : 'Your games will appear here when you create or join a room.'}</p>}
    <div className="saved-game-list">{games.map(game => <article className="saved-game" key={`${game.roomId}:${game.playerId}`}>
      <div className="saved-game-copy">
        <strong>{game.gameType === 'pocha' ? 'La Pocha' : 'Conti'} <span>· {es ? 'Sala' : 'Room'} {game.roomId}</span></strong>
        <p>{game.playerName} · {es ? 'Ronda' : 'Round'} {game.round} · {game.paused ? (es ? 'En pausa' : 'Paused') : (es ? 'Guardado automático' : 'Autosaved')}</p>
        <p className="saved-roster">{game.players.join(' · ')}</p>
        <small>{es ? 'Última conexión: ' : 'Last connected: '}{new Date(game.updatedAt).toLocaleString(es ? 'es-ES' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</small>
      </div>
      <div className="saved-game-buttons">
        <button className="save-primary" disabled={!connected} onClick={() => resume(game)}>{es ? 'Volver a la sala' : 'Return to room'}</button>
        <button className="save-subtle" onClick={() => {
          if (window.confirm(es ? `¿Olvidar tu acceso como ${game.playerName} a la sala ${game.roomId}? No podrás recuperar este asiento desde Mis partidas.` : `Forget your access as ${game.playerName} to room ${game.roomId}? You will no longer be able to recover this seat from My games.`)) forget(game)
        }}>{es ? 'Olvidar' : 'Forget'}</button>
      </div>
    </article>)}</div>
  </section>
}

export function PausedGame({ state, playerId, lang, connected, onContinue, onExit, error }: {
  state: GameState; playerId: string | null; lang: Lang; connected: boolean
  onContinue: () => Promise<ActionResult>; onExit: () => void; error: string | null
}) {
  const es = lang === 'es'
  const [busy, setBusy] = useState(false)
  const host = state.players[0]?.id === playerId
  const ready = state.players.every(p => p.connected)
  return <main className="saved-pause"><section className="saved-pause-card">
    <span className="saved-eyebrow">{state.gameType === 'pocha' ? 'La Pocha' : 'Conti'} · {es ? 'Sala' : 'Room'} {state.roomId}</span>
    <h1>{es ? 'Partida guardada' : 'Game saved'}</h1>
    <p>{es ? 'Las cartas, los puntos y el turno os esperan. Cada jugador vuelve desde Mis partidas en su navegador.' : 'Your cards, scores and turn are waiting. Each player returns from My games in their browser.'}</p>
    <ul>{state.players.map(p => <li key={p.id}><span>{p.name}{p.id === playerId ? (es ? ' (tú)' : ' (you)') : ''}</span><strong className={p.connected ? 'save-online' : ''}>{p.connected ? (es ? 'En la sala' : 'In the room') : (es ? 'Pendiente' : 'Away')}</strong></li>)}</ul>
    <p role="status">{host
      ? ready ? (es ? 'Ya estáis todos. Podéis continuar.' : 'Everyone is here. You can continue.') : (es ? 'Podrás continuar cuando hayan vuelto todos.' : 'You can continue when everyone returns.')
      : (es ? `El anfitrión, ${state.players[0]?.name}, continuará cuando estéis todos.` : `The host, ${state.players[0]?.name}, will continue when everyone returns.`)}</p>
    {error && <p role="alert" className="save-error">{error}</p>}
    {host && <button className="save-primary" disabled={!ready || !connected || busy} onClick={async () => { setBusy(true); try { await onContinue() } finally { setBusy(false) } }}>{busy ? '…' : es ? 'Continuar partida' : 'Continue game'}</button>}
    <button className="save-subtle" disabled={!connected || busy} onClick={onExit}>{es ? 'Salir de la sala' : 'Exit room'}</button>
  </section></main>
}

export function SaveExitDialog({ host, paused, lang, connected, onSave, onAbandon, onClose }: {
  host: boolean; paused: boolean; lang: Lang; connected: boolean
  onSave: () => Promise<ActionResult>; onAbandon: () => void; onClose: () => void
}) {
  const es = lang === 'es'
  const dialog = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="save-dialog" aria-labelledby="save-exit-title" onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id="save-exit-title">{es ? '¿Lo dejamos para luego?' : 'Continue another time?'}</h2>
    <p>{paused ? (es ? 'La partida seguirá en pausa. Tu sitio y tus cartas se conservarán.' : 'The game will stay paused. Your seat and cards will be kept.')
      : host ? (es ? 'Guardar y salir pausará la partida para todos. Podréis retomarla desde Mis partidas, cada uno en su navegador.' : 'Save and exit pauses the game for everyone. Each player can return from My games in their browser.')
      : (es ? 'Conservaremos tu sitio y tus cartas. Los demás podrán seguir jugando; solo el anfitrión puede pausar la partida para todos.' : 'Your seat and cards will be kept. Others can keep playing; only the host can pause the game for everyone.')}</p>
    {error && <p role="alert" className="save-error">{error}</p>}
    <button className="save-primary" disabled={!connected || busy} onClick={async () => {
      setBusy(true)
      try { const result = await onSave(); if (result.ok) onClose(); else setError(result.error ?? 'Error') }
      finally { setBusy(false) }
    }}>{busy ? (es ? 'Guardando…' : 'Saving…') : es ? 'Guardar y salir' : 'Save and exit'}</button>
    <button className="save-subtle" disabled={busy} onClick={onClose}>{es ? 'Seguir aquí' : 'Stay here'}</button>
    <button className="save-danger" disabled={!connected || busy} onClick={() => {
      if (window.confirm(es ? '¿Abandonar definitivamente? Perderás tu asiento y tus cartas; la partida puede finalizar o reiniciarse para los demás. Para retomarla después, elige Guardar y salir.' : 'Leave permanently? You will lose your seat and cards; the game may end or reset for everyone. To return later, choose Save and exit.')) { onAbandon(); onClose() }
    }}>{es ? 'Abandonar definitivamente' : 'Leave permanently'}</button>
  </dialog>
}
