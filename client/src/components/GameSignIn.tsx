import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../i18n'
import type { MembershipController } from '../useMembership'
import { authorizeGameSignIn, gameSignInReturnUrl, parseGameConnectionRequest } from '../lib/gameSignIn'
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
  const sequence = useRef(0)
  const currentToken = useRef(membership.token)
  currentToken.current = membership.token
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++sequence.current } }, [])
  const gameName = request ? (games[request.origin] ?? (es ? 'el juego local' : 'the local game')) : ''

  async function continueToGame() {
    const token = membership.token
    if (!request || !token || !membership.account || busy) return
    const attempt = ++sequence.current
    setBusy(true); setFailed(false)
    try {
      const code = await authorizeGameSignIn(request, token)
      if (!mounted.current || attempt !== sequence.current || currentToken.current !== token) return
      window.location.assign(gameSignInReturnUrl(request, code, import.meta.env.DEV))
    } catch {
      if (mounted.current && attempt === sequence.current) setFailed(true)
    } finally { if (mounted.current && attempt === sequence.current) setBusy(false) }
  }

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
        <p>{es ? 'Usa la misma cuenta que en Conti y Pocha. Tus partidas guardadas se conservan en cada juego.' : 'Use the same account as Conti and Pocha. Your saved games stay in each game.'}</p>
        <div className="game-sign-in-target"><span>{es ? 'Vas a continuar en' : 'You will continue to'}</span><strong>{new URL(request.origin).host}</strong></div>
        {failed && <p className="game-sign-in-error" role="alert">{es ? 'No hemos podido conectar tu cuenta. Inténtalo de nuevo o vuelve a iniciar sesión.' : 'We could not connect your account. Try again or sign in again.'}</p>}
        {!membership.loaded ? <p role="status">{es ? 'Consultando tu cuenta…' : 'Checking your account…'}</p>
          : membership.account && membership.token ? <button type="button" className="game-sign-in-primary" disabled={busy || membership.busy} onClick={() => void continueToGame()}>
            {busy ? (es ? 'Conectando…' : 'Connecting…') : es ? `Continuar como ${membership.account.name ?? membership.account.email}` : `Continue as ${membership.account.name ?? membership.account.email}`}<span aria-hidden="true">→</span>
          </button> : <button type="button" className="game-sign-in-primary" disabled={membership.busy} onClick={onOpenAccount}>{es ? 'Entrar con mi cuenta' : 'Sign in to my account'}<span aria-hidden="true">→</span></button>}
        <a className="game-sign-in-home" href="/">{es ? 'Volver a NRN Play' : 'Back to NRN Play'}</a>
      </>}
    </section>
  </main>
}
