import type { ConnectionStatus } from '../useSocket'
import type { Lang } from '../i18n'
import { criticalConnectionState } from '../lib/connectionFeedback'
import './ConnectionNotice.css'

interface Props {
  status: ConnectionStatus
  recoveryRoomId: string | null
  sessionStorageAvailable: boolean
  error?: string | null
  lang: Lang
  onReconnect: () => void
}

export function ConnectionNotice({ status, recoveryRoomId, sessionStorageAvailable, error, lang, onReconnect }: Props) {
  const es = lang === 'es'
  if (!criticalConnectionState(status, recoveryRoomId, sessionStorageAvailable, !!error)) return null

  const title = status === 'connected'
    ? (es ? 'La recuperación está limitada en este navegador' : 'Recovery is limited in this browser')
    : status === 'paused'
      ? (es ? 'El servidor no puede guardar ahora' : 'Saving is temporarily unavailable')
      : status === 'replaced'
      ? (es ? 'Tu asiento está abierto en otra pestaña' : 'Your seat is open in another tab')
      : (es ? 'No se pudo recuperar tu asiento' : 'Your seat could not be restored')

  const description = status === 'connected'
    ? (es ? 'Mantén esta pestaña abierta. El navegador no permite guardar tu acceso para recuperar el asiento al recargar.' : 'Keep this tab open. Your browser is blocking the saved access needed to recover your seat after a reload.')
    : status === 'paused'
      ? (es ? 'Las jugadas están desactivadas hasta que el servidor pueda guardarlas. Conservamos tu acceso al asiento; reintenta la conexión para recuperar la partida.' : 'Moves are disabled until the server can save them safely. Your seat access is kept; try reconnecting to restore the game.')
      : status === 'replaced'
      ? (es ? 'Continúa allí o recupera el control aquí. Solo una conexión puede controlar tu asiento.' : 'Continue there, or reconnect here. Only one connection can control your seat.')
      : recoveryRoomId
        ? (es ? 'Las jugadas siguen desactivadas hasta recuperar tu asiento.' : 'Moves stay disabled until your seat is restored.')
        : (es ? 'Reintenta la conexión para continuar.' : 'Reconnect to continue.')

  return (
    <section className="connection-notice" aria-label={es ? 'Conexión' : 'Connection'}>
      <div className="connection-notice-copy" role="status" aria-live="polite">
        <strong>{title}</strong>
        <p>{description}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      {status !== 'connected' && (
        <button type="button" onClick={onReconnect}>
          {status === 'replaced' ? (es ? 'Reconectar aquí' : 'Reconnect here') : (es ? 'Reintentar' : 'Try again')}
        </button>
      )}
    </section>
  )
}

/** The single compact warning for confirmed account/transport outages. */
export function ServerConnectionWarning({ accountUnavailable, gameUnavailable, recoveringGame = false, lang, onRetry }: {
  accountUnavailable: boolean; gameUnavailable?: boolean; recoveringGame?: boolean; lang: Lang; onRetry: () => void
}) {
  if (!accountUnavailable && !gameUnavailable) return null
  const es = lang === 'es'
  const label = gameUnavailable ? recoveringGame ? (es ? 'Recuperando partida' : 'Restoring game') : (es ? 'Sin conexión' : 'Connection lost') : (es ? 'Cuenta sin conexión' : 'Account offline')
  return <aside className="server-connection-warning" aria-label={es ? 'Estado del servidor' : 'Server status'}>
    <span className="server-connection-warning-copy" role="status" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3v.5" /></svg>
      <span>{label}</span>
    </span>
    <button type="button" onClick={onRetry} aria-label={es ? 'Reintentar conexión' : 'Retry connection'} title={es ? 'Reintentar' : 'Retry'}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1" /></svg>
    </button>
  </aside>
}
