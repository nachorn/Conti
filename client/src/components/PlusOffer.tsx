import type { Lang } from '../i18n'

export function PlusOffer({ lang, onOpen, active = false }: { lang: Lang; onOpen: () => void; active?: boolean }) {
  const es = lang === 'es'
  return <aside className="nrn-plus-invite" aria-label="NRN Plus">
    <span aria-hidden="true">✦</span><div><strong>NRN Plus</strong><p>{active ? es ? 'Personaliza tu mesa de Conti y La Pocha.' : 'Personalise your Conti and La Pocha table.' : es ? 'Estilos de mesa y apoyo al proyecto. Jugar sigue siendo gratis.' : 'Table styles and support for the project. Playing stays free.'}</p></div>
    <button type="button" onClick={onOpen} aria-haspopup="dialog">{active ? es ? 'Elegir mi estilo' : 'Choose my style' : es ? 'Ver Plus' : 'Explore Plus'} <span aria-hidden="true">→</span></button>
  </aside>
}
