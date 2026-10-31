import { useCallback, useEffect, useRef, useState } from 'react'
import type { Lang } from './i18n'
import './components/RoomVerification.css'

const API_URL = (import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')).replace(/\/+$/, '')
type TurnstileAPI = {
  render(container: HTMLElement, options: Record<string, unknown>): string
  remove(widget: string): void
}
declare global { interface Window { turnstile?: TurnstileAPI; contiTurnstileLoaded?: () => void } }
let sdk: Promise<TurnstileAPI> | null = null

function loadTurnstile(): Promise<TurnstileAPI> {
  if (sdk) return sdk
  if (window.turnstile) return Promise.resolve(window.turnstile)
  sdk = new Promise<TurnstileAPI>((resolve, reject) => {
    const script = document.createElement('script')
    const timeout = window.setTimeout(() => fail(), 12_000)
    const fail = () => {
      window.clearTimeout(timeout)
      script.remove()
      delete window.contiTurnstileLoaded
      reject(new Error('Verification unavailable'))
    }
    window.contiTurnstileLoaded = () => {
      window.clearTimeout(timeout)
      delete window.contiTurnstileLoaded
      if (window.turnstile) resolve(window.turnstile)
      else fail()
    }
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=contiTurnstileLoaded'
    script.async = true
    script.onerror = fail
    document.head.append(script)
  }).catch(error => { sdk = null; throw error })
  return sdk
}

type VerificationState = { kind: 'loading' | 'error' } | { kind: 'challenge'; siteKey: string }

function VerificationDialog({ state, lang, onComplete, onCancel, onRetry }: {
  state: VerificationState; lang: Lang; onComplete: (token: string) => void; onCancel: () => void; onRetry: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const widgetRef = useRef<HTMLDivElement>(null)
  const [failed, setFailed] = useState(false)
  const siteKey = state.kind === 'challenge' ? state.siteKey : null
  const es = lang === 'es'

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [])

  useEffect(() => {
    setFailed(false)
    if (!siteKey || !widgetRef.current) return
    let disposed = false
    let widget: string | undefined
    let api: TurnstileAPI | undefined
    const timeout = window.setTimeout(() => { if (!disposed) setFailed(true) }, 30_000)
    void loadTurnstile().then(loaded => {
      api = loaded
      if (disposed || !widgetRef.current) return
      try {
          widget = loaded.render(widgetRef.current, {
            sitekey: siteKey, action: 'room_entry', theme: 'auto', language: lang, size: 'flexible', 'response-field': false,
            callback: (token: string) => {
              if (disposed) return
              window.clearTimeout(timeout)
              if (typeof token === 'string' && token.length > 0 && token.length <= 2048) onComplete(token)
              else setFailed(true)
            },
            'error-callback': (code: string) => {
              if (!disposed) {
                if (/^\d{6}$/.test(String(code))) console.warn('Security widget failed.', code)
                setFailed(true)
              }
            },
            'unsupported-callback': () => { if (!disposed) setFailed(true) },
            'expired-callback': () => { if (!disposed) setFailed(true) },
            'timeout-callback': () => { if (!disposed) setFailed(true) },
          })
        } catch (error) {
          console.warn('Security widget initialization failed.', error instanceof Error ? error.message : 'Unknown widget error')
          setFailed(true)
        }
    }).catch(error => {
      if (!disposed) {
        console.warn('Security widget loading failed.', error instanceof Error ? error.message : 'Unknown loading error')
        setFailed(true)
      }
    })
    return () => { disposed = true; window.clearTimeout(timeout); if (widget !== undefined) api?.remove(widget) }
  }, [siteKey, lang, onComplete])

  return <dialog ref={dialogRef} className="room-verification" aria-labelledby="room-verification-title"
    aria-describedby="room-verification-info" onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="room-verification-title">{es ? 'Comprobación de seguridad' : 'Security check'}</h2>
    <p id="room-verification-info">{es ? 'Un momento mientras comprobamos el acceso a la sala.' : 'One moment while we check access to the room.'}</p>
    {state.kind === 'loading' && <p role="status">{es ? 'Conectando…' : 'Connecting…'}</p>}
    {state.kind === 'challenge' && <div ref={widgetRef} className="room-verification-widget" />}
    {(state.kind === 'error' || failed) && <>
      <p role="alert">{es ? 'No se pudo completar la comprobación. Revisa la conexión y vuelve a intentarlo.' : 'The check could not be completed. Check your connection and try again.'}</p>
      <button className="save-primary" onClick={onRetry}>{es ? 'Volver a intentar' : 'Try again'}</button>
    </>}
    <button className="save-subtle" onClick={onCancel}>{es ? 'Cancelar' : 'Cancel'}</button>
    <p className="room-verification-privacy"><a href={`/privacy.html#${lang}`} target="_blank" rel="noopener noreferrer">{es ? 'Privacidad' : 'Privacy'}</a> · Cloudflare Turnstile</p>
  </dialog>
}

/** A one-use proof for an entry attempt. No tokens enter storage or logs. */
export function useRoomVerification(lang: Lang) {
  const [state, setState] = useState<VerificationState | null>(null)
  const resolveRef = useRef<((token: string | null) => void) | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const finish = useCallback((token: string | null) => {
    generation.current++
    requestRef.current?.abort()
    const resolve = resolveRef.current
    resolveRef.current = null
    setState(null)
    resolve?.(token)
  }, [])

  const loadConfig = useCallback(async () => {
    const current = ++generation.current
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    setState({ kind: 'loading' })
    try {
      const response = await fetch(`${API_URL}/api/security/config`, { cache: 'no-store', signal: controller.signal })
      // Older game servers have no verification endpoint. An enabled newer
      // server independently rejects entries without a valid proof.
      if (response.status === 404) { if (current === generation.current) finish(''); return }
      if (!response.ok) throw new Error('Verification unavailable')
      const config: unknown = await response.json()
      if (current !== generation.current) return
      if (!config || typeof config !== 'object' || !('turnstileSiteKey' in config)) throw new Error('Invalid configuration')
      if (config.turnstileSiteKey === null) { finish(''); return }
      if (typeof config.turnstileSiteKey !== 'string' || !/^[\w-]{10,100}$/.test(config.turnstileSiteKey)) throw new Error('Invalid configuration')
      setState({ kind: 'challenge', siteKey: config.turnstileSiteKey })
    } catch {
      if (current === generation.current) setState({ kind: 'error' })
    } finally { window.clearTimeout(timeout) }
  }, [finish])

  const verify = useCallback(() => {
    if (resolveRef.current) return Promise.resolve(null)
    return new Promise<string | null>(resolve => { resolveRef.current = resolve; void loadConfig() })
  }, [loadConfig])

  useEffect(() => () => {
    generation.current++
    requestRef.current?.abort()
    resolveRef.current?.(null)
    resolveRef.current = null
  }, [])

  return {
    verify,
    dialog: state && <VerificationDialog state={state} lang={lang} onComplete={finish}
      onCancel={() => finish(null)} onRetry={() => void loadConfig()} />,
  }
}
