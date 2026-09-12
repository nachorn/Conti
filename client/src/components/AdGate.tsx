import { useEffect, useRef, useState } from 'react'
import type { AdBeginResult, AdCompletePayload, AdGateState } from '@shared/adGate'
import type { ActionResult, GameState } from '../types'
import type { Lang } from '../i18n'
import { playStartAd, prepareAdProvider } from '../lib/adProvider'
import './AdGate.css'

const copy = {
  es: {
    title: 'Antes de empezar', intro: 'Antes de empezar se mostrará un breve anuncio. La publicidad ayuda a mantener esta web activa.',
    rule: 'La partida podrá empezar cuando todos hayan terminado su anuncio. Puedes usar el botón de cerrar o saltar cuando el anuncio lo permita.',
    continue: 'Continuar con el anuncio', loading: 'Preparando el anuncio…', ready: 'Listo', viewing: 'En el anuncio', pending: 'Pendiente', offline: 'Sin conexión', you: 'Tú', player: 'Jugador',
    wait: 'Tu anuncio ha terminado. Esperando al resto de la mesa.', allReady: 'Todos listos. El anfitrión ya puede empezar la partida.',
    unavailable: 'No se ha podido mostrar un anuncio. La mesa sigue esperando. Puedes volver a intentarlo en unos instantes.',
    retry: 'Volver a intentar', close: 'Volver a la mesa', account: 'Usar acceso sin anuncios',
    exempt: 'Esta mesa juega sin anuncios', progress: 'Preparación de la mesa', sync: 'No hemos podido confirmar el anuncio. Reconecta y comprueba tu estado antes de volver a intentarlo.',
    recover: 'Esperando la confirmación del anuncio. Si no aparece, vuelve a intentarlo en unos minutos.',
  },
  en: {
    title: 'Before we start', intro: 'A short ad will play before the game starts. Advertising helps keep this website running.',
    rule: 'The game can start once everyone has finished their ad. Use the close or skip button when the ad makes it available.',
    continue: 'Continue to ad', loading: 'Preparing your ad…', ready: 'Ready', viewing: 'In the ad', pending: 'Pending', offline: 'Offline', you: 'You', player: 'Player',
    wait: 'Your ad has finished. Waiting for the rest of the table.', allReady: 'Everyone is ready. The host can now start the game.',
    unavailable: 'An ad could not be shown. The table is still waiting. You can try again in a moment.',
    retry: 'Try again', close: 'Back to the table', account: 'Use ad-free access',
    exempt: 'This table plays without ads', progress: 'Table readiness', sync: 'We could not confirm your ad. Reconnect and check your status before trying again.',
    recover: 'Waiting for ad confirmation. If it does not appear, try again in a few minutes.',
  },
}

export function AdGate({ gate, state, playerId, lang, connected, open, onOpen, onClose, onAccount, begin, complete }: {
  gate: AdGateState | null; state: GameState | null; playerId: string | null; lang: Lang; connected: boolean
  open: boolean; onOpen: () => void; onClose: () => void; onAccount: () => void
  begin: () => Promise<AdBeginResult>; complete: (payload: AdCompletePayload) => Promise<ActionResult>
}) {
  const t = copy[lang]
  const [busy, setBusy] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [failure, setFailure] = useState<'unavailable' | 'sync' | 'recover' | null>(null)
  const panel = useRef<HTMLElement>(null)
  const operation = useRef(0)
  const pendingAd = useRef<AbortController | null>(null)
  const currentGate = useRef(gate)
  currentGate.current = gate
  const me = gate?.players.find(player => player.playerId === playerId)
  const visible = Boolean(gate?.required && open && !playing)
  const previousFocus = useRef<HTMLElement | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    ++operation.current
    pendingAd.current?.abort()
    setFailure(null)
    setBusy(false)
    return () => { ++operation.current; pendingAd.current?.abort() }
  }, [gate?.roomId, gate?.cycle, gate?.required])

  useEffect(() => {
    if (gate?.required && gate.provider === 'google-h5' && gate.publisherId) {
      void prepareAdProvider(gate.publisherId).catch(() => { /* A click offers a visible retry. */ })
    }
  }, [gate?.required, gate?.provider, gate?.publisherId])

  useEffect(() => {
    if (!visible) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    panel.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const focusable = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')
      const first = focusable?.[0]
      const last = focusable?.[focusable.length - 1]
      if (!first || !last) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previousFocus.current?.focus() }
  }, [visible])

  const watch = async () => {
    if (!gate?.publisherId || busy || !connected || me?.status === 'ready') return
    const generation = ++operation.current
    const controller = new AbortController()
    pendingAd.current = controller
    const cycle = gate.cycle
    setFailure(null); setBusy(true)
    const attempt = await begin()
    if (generation !== operation.current || currentGate.current?.cycle !== cycle) return
    if (!attempt.ok || !attempt.attemptId) { setBusy(false); setFailure(attempt.code === 'ad_in_progress' ? 'recover' : 'sync'); return }
    const outcome = await playStartAd(gate.publisherId, setPlaying, controller.signal)
    if (generation !== operation.current || currentGate.current?.cycle !== cycle) return
    const result = await complete({ attemptId: attempt.attemptId, outcome })
    if (generation !== operation.current) return
    setBusy(false)
    if (outcome === 'unavailable' || outcome === 'error') setFailure('unavailable')
    else if (!result.ok) setFailure('sync')
  }

  if (!gate?.enabled || (!gate.required && !gate.exempt) || !state) return null
  const readyCount = gate.players.filter(player => player.status === 'ready').length
  const players = state.gameType === 'pocha' ? state.pocha?.players ?? state.players : state.players
  return <>
    <div className="ad-gate-summary" role="status">
      {gate.exempt ? <span>✦ {t.exempt}</span> : <button onClick={onOpen}>{t.progress}: {readyCount}/{gate.players.length}</button>}
    </div>
    {visible && <div className="ad-gate-backdrop">
      <section ref={panel} className="ad-gate-panel" role="dialog" aria-modal="true" aria-labelledby="ad-gate-title" tabIndex={-1}>
        <div className="ad-gate-heading"><span aria-hidden="true">▷</span><h2 id="ad-gate-title">{t.title}</h2></div>
        <p>{t.intro}</p>
        <p className="ad-gate-rule">{t.rule}</p>
        <ul className="ad-gate-players" aria-label={t.progress}>
          {gate.players.map((player, index) => <li key={player.playerId}>
            <span>{players.find(item => item.id === player.playerId)?.name || `${t.player} ${index + 1}`}{player.playerId === playerId ? ` (${t.you})` : ''}</span>
            <span className={`ad-gate-status ${player.status}`}>{!player.connected ? t.offline : player.status === 'ready' ? `✓ ${t.ready}` : player.status === 'viewing' ? t.viewing : t.pending}</span>
          </li>)}
        </ul>
        {failure && <p className="ad-gate-error" role="alert">{t[failure]}</p>}
        {me?.status === 'ready' ? <p className="ad-gate-ready" role="status">{gate.canStart ? t.allReady : t.wait}</p> : <button className="ad-gate-primary" disabled={busy || !connected} onClick={() => void watch()}>{busy ? t.loading : failure ? t.retry : t.continue}</button>}
        <div className="ad-gate-actions">
          <button onClick={onClose}>{t.close}</button>
          <button disabled={busy} onClick={() => { onClose(); onAccount() }}>{t.account}</button>
        </div>
      </section>
    </div>}
  </>
}
