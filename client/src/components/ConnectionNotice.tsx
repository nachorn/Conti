import type { ConnectionStatus } from '../useSocket'
import type { Lang } from '../i18n'
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
  if (status === 'connected' && (sessionStorageAvailable || !recoveryRoomId)) return null

  const title = status === 'connected'
    ? (es ? 'La recuperación está limitada en este navegador' : 'Recovery is limited in this browser')
    : status === 'paused'
      ? (es ? 'El servidor no puede guardar ahora' : 'Saving is temporarily unavailable')
      : status === 'replaced'
      ? (es ? 'Tu asiento está abierto en otra pestaña' : 'Your seat is open in another tab')
      : status === 'resuming'
        ? (es ? `Recuperando la sala ${recoveryRoomId ?? ''}…` : `Restoring room ${recoveryRoomId ?? ''}…`)
        : status === 'connecting'
          ? (es ? 'Conectando con el servidor…' : 'Connecting to the server…')
          : (es ? 'Sin conexión. Reconectando…' : 'Connection lost. Reconnecting…')

  const description = status === 'connected'
    ? (es ? 'Mantén esta pestaña abierta. El navegador no permite guardar tu acceso para recuperar el asiento al recargar.' : 'Keep this tab open. Your browser is blocking the saved access needed to recover your seat after a reload.')
    : status === 'paused'
      ? (es ? 'Las jugadas están desactivadas hasta que el servidor pueda guardarlas. Conservamos tu acceso al asiento; reintenta la conexión para recuperar la partida.' : 'Moves are disabled until the server can save them safely. Your seat access is kept; try reconnecting to restore the game.')
      : status === 'replaced'
      ? (es ? 'Continúa allí o recupera el control aquí. Solo una conexión puede controlar tu asiento.' : 'Continue there, or reconnect here. Only one connection can control your seat.')
      : recoveryRoomId
        ? (es ? 'No se enviarán jugadas hasta recuperar tu asiento. Mantén esta pestaña abierta; si el servidor está dormido, puede tardar un minuto en despertar.' : 'Moves are disabled until your seat is restored. Keep this tab open; a sleeping server may take a minute to wake up.')
        : (es ? 'Esperaremos a tener conexión para crear o unirte a una partida. Si el servidor está dormido, puede tardar un minuto en despertar.' : 'Creating or joining a game needs a connection. A sleeping server may take a minute to wake up; we’ll keep trying automatically.')

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
