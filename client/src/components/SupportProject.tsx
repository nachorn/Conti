import type { Lang } from '../i18n'
import './SupportProject.css'

const copy = {
  es: {
    title: 'Apoyar el proyecto',
    description: 'Aportaciones voluntarias para mantener la web. Jugar es gratis.',
    action: 'Apoyar el proyecto',
    destination: 'Aportación voluntaria a través de la página de Football Champion en Buy Me a Coffee. Se abre en otra pestaña.',
  },
  en: {
    title: 'Support the project',
    description: 'Voluntary contributions help maintain the website. Playing is free.',
    action: 'Support the project',
    destination: 'Optional contribution through Football Champion’s page on Buy Me a Coffee. Opens in a new tab.',
  },
}

export function SupportProject({ lang }: { lang: Lang }) {
  const t = copy[lang]
  return <section className="support-project" aria-labelledby="support-project-title">
    <div className="support-project-copy">
      <h2 id="support-project-title">{t.title}</h2>
      <p>{t.description}</p>
    </div>
    <a className="support-project-button" href="https://buymeacoffee.com/footballchampion" target="_blank" rel="noopener noreferrer" aria-describedby="support-project-destination">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 9h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9ZM16 10h2a3 3 0 0 1 0 6h-2M7 3v2M11 3v2M15 3v2" />
      </svg>
      {t.action}<span aria-hidden="true">↗</span>
    </a>
    <p className="support-project-destination" id="support-project-destination">{t.destination}</p>
  </section>
}
