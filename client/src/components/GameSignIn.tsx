import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../i18n'
import type { MembershipController } from '../useMembership'
import { createGameSignInContinuation, parseGameConnectionRequest } from '../lib/gameSignIn'
import './GameSignIn.css'

const games: Record<string, string> = {
  'https://football.nrnplay.com': 'FootballChampion', 'https://footballchampion.net': 'FootballChampion',
  'https://conti.nrnplay.com': 'Conti', 'https://pocha.nrnplay.com': 'La Pocha',
}

/** Central /connect screen; the parent supplies the shared header and existing account modal. */
export function GameSignIn({ membership, lang, onOpenAccount }: {
  membership: MembershipController; lang: Lang; onOpenAccount: () => void
}) {
  const es = lang === 'es'
  const [request] = useState(() => parseGameConnectionRequest(window.location.search, import.meta.env.DEV))
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(false)
  const currentToken = useRef(membership.token)
  currentToken.current = membership.token
  const [continuation] = useState(() => createGameSignInContinuation({
    development: import.meta.env.DEV,
    navigate: url => window.location.assign(url),
    isCurrent: token => mounted.current && currentToken.current === token,
    onState: state => { if (mounted.current) { setBusy(state.busy); setFailed(state.failed) } },
  }))
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const gameName = request ? (games[request.origin] ?? (es ? 'el juego local' : 'the local game')) : ''

  useEffect(() => {
    if (request && membership.account && membership.token && !membership.busy) void continuation.run(request, membership.token)
  }, [request, membership.account?.id, membership.token, membership.busy, continuation])

  return <main className="game-sign-in">
    <section className="game-sign-in-card" aria-labelledby="game-sign-in-title">
      <span className="game-sign-in-symbol" aria-hidden="true">↗</span>
      <p className="game-sign-in-eyebrow">NRN PLAY</p>
      <h1 id="game-sign-in-title">{!request ? (es ? 'Enlace de acceso no válido' : 'Invalid sign-in link')
        : es ? `Tu cuenta para ${gameName}` : `Your account for ${gameName}`}</h1>
      {!request ? <>
        <p>{es ? 'Vuelve al juego e inicia sesión de nuevo para obtener un enlace nuevo.' : 'Return to the game and sign in again to get a new link.'}</p>
        <a className="game-sign-in-home" href="/">{es ? 'Volver a NRN Play' : 'Back to NRN Play'} →</a>
      </> : <>
        <div className="game-sign-in-target"><span>{es ? 'Vas a continuar en' : 'You will continue to'}</span><strong>{new URL(request.origin).host}</strong></div>
        {failed && membership.account && membership.token ? <>
          <p className="game-sign-in-error" role="alert">{es ? 'No hemos podido conectar tu cuenta.' : 'We could not connect your account.'}</p>
          <button type="button" className="game-sign-in-primary" disabled={busy || membership.busy} onClick={() => { if (request && membership.token) void continuation.run(request, membership.token, true) }}>{es ? 'Reintentar' : 'Try again'}</button>
        </> : membership.account && membership.token ? <p role="status">{es ? 'Conectando tu cuenta…' : 'Connecting your account…'}</p>
          : membership.token ? <p role="status">{membership.serverStatus === 'unavailable' ? (es ? 'No se pudo recuperar tu sesión. Reintenta la conexión.' : 'Your session could not be restored. Retry the connection.') : (es ? 'Recuperando tu sesión…' : 'Restoring your session…')}</p>
          : !membership.loaded || membership.serverStatus === 'connecting' ? <p role="status">{es ? 'Consultando tu cuenta…' : 'Checking your account…'}</p>
          : membership.serverStatus === 'unavailable' ? <p role="status">{es ? 'No hay conexión con el servidor.' : 'The server is unavailable.'}</p>
          : <button type="button" className="game-sign-in-primary" disabled={membership.busy} onClick={onOpenAccount}>{es ? 'Entrar con mi cuenta' : 'Sign in to my account'}<span aria-hidden="true">→</span></button>}
        <a className="game-sign-in-home" href="/">{es ? 'Volver a NRN Play' : 'Back to NRN Play'}</a>
      </>}
    </section>
  </main>
}
