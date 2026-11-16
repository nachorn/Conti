import { useEffect, useState } from 'react'
import type { Lang } from '../i18n'
import './InstallApp.css'

interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallApp({ lang }: { lang: Lang }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [installed, setInstalled] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
    setInstalled(standalone)
    const available = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    const completed = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', completed)
    return () => { window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', completed) }
  }, [])
  if (installed) return null
  const es = lang === 'es'
  const install = async () => {
    if (!prompt || busy) return
    const current = prompt
    setBusy(true)
    try { await current.prompt(); await current.userChoice } catch { /* The browser may decline or expire this optional prompt. */ }
    finally { setPrompt(null); setBusy(false) }
  }
  return <aside className="nrn-install">
    <div><h2>{es ? 'NRN Play, a mano' : 'Keep NRN Play close'}</h2>
      <p>{es ? 'Añade la web a la pantalla de inicio para volver con un toque. En iPhone, usa Compartir → Añadir a pantalla de inicio. Las partidas en grupo necesitan conexión.' : 'Add the website to your home screen to return with a tap. On iPhone, use Share → Add to Home Screen. Group games need an internet connection.'}</p></div>
    {prompt && <button type="button" disabled={busy} onClick={() => { void install() }}>{es ? 'Instalar NRN Play' : 'Install NRN Play'}</button>}
  </aside>
}
