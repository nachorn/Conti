import { useState } from 'react'
import type { Lang } from '../i18n'
import { canOpenAdPreferences, openAdPreferences } from '../lib/adConsent'

export function AdPrivacyPreferences({ lang }: { lang: Lang }) {
  const [failed, setFailed] = useState(false)
  if (!canOpenAdPreferences()) return null
  return <span>
    <button type="button" onClick={() => setFailed(!openAdPreferences())}>{lang === 'es' ? 'Preferencias de anuncios' : 'Ad privacy choices'}</button>
    {failed && <span role="alert">{lang === 'es' ? 'No se pudieron abrir. Recarga la página e inténtalo de nuevo.' : 'Choices could not open. Reload the page and try again.'}</span>}
  </span>
}
