import type { Lang } from '../i18n'

export function PlusOffer({ lang, onOpen, active = false }: { lang: Lang; onOpen: () => void; active?: boolean }) {
  const es = lang === 'es'
  return <aside className="nrn-plus-invite" aria-label="NRN Plus">
    <span aria-hidden="true">✦</span><div><strong>NRN Plus</strong><p>{active ? es ? 'Tu acceso está activo.' : 'Your access is active.' : es ? 'Mesas y reversos para Conti y Pocha.' : 'Table styles and card backs for Conti and Pocha.'}</p></div>
    <button type="button" onClick={onOpen} aria-haspopup="dialog">{active ? es ? 'Elegir mi estilo' : 'Choose my style' : es ? 'Ver planes' : 'View plans'} <span aria-hidden="true">→</span></button>
  </aside>
}
