import type { Lang } from '../i18n'
import type { MembershipController } from '../useMembership'
import './AccountConnection.css'

export function AccountConnection({ membership, lang }: { membership: MembershipController; lang: Lang }) {
  if (membership.serverStatus === 'ready') return null
  const es = lang === 'es'
  const connecting = membership.serverStatus === 'connecting'
  return <section className="account-connection" aria-label={es ? 'Conexión de la cuenta' : 'Account connection'}>
    <div role="status"><strong>{connecting ? (es ? 'Conectando con el servidor…' : 'Connecting to the server…') : (es ? 'No se ha podido conectar con el servidor.' : 'Could not connect to the server.')}</strong>
      <p>{connecting ? (es ? 'Si estaba inactivo, el arranque puede tardar un minuto. Reintentamos automáticamente.' : 'If it was idle, startup can take a minute. We are retrying automatically.') : (es ? 'Comprueba tu conexión y vuelve a intentarlo aquí.' : 'Check your connection and try again here.')}</p>
      {membership.token && membership.storageAvailable && <p>{es ? 'Tu sesión sigue guardada en este dispositivo.' : 'Your session is still saved on this device.'}</p>}
    </div>
    <button type="button" onClick={() => void membership.retryConnection()}>{es ? 'Reintentar' : 'Try again'}</button>
  </section>
}
