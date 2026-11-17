import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Lang } from '../i18n'
import './NRNPlay.css'
import { platformHomeHref } from '../lib/platform'

export function ProfileIcon({ className = '' }: { className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
}

export function SiteHeader({ lang, setLang, accountName, onOpenAccount, accountHref, connectionNotice }: {
  lang: Lang; setLang: (lang: Lang) => void; accountName?: string | null; onOpenAccount: () => void; accountHref?: string; connectionNotice?: ReactNode
}) {
  const es = lang === 'es'
  const profile = <>
    <span className="nrn-avatar" aria-hidden="true">{accountName ? accountName.charAt(0).toUpperCase() : <ProfileIcon />}</span>
    <span>{accountName || (es ? 'Mi perfil' : 'My profile')}</span>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 3 5 5-5 5" /></svg>
  </>
  return <header className="nrn-header">
    <div className="nrn-header-inner">
      <Link className="nrn-brand" to={platformHomeHref()} aria-label={es ? 'NRN Play, inicio' : 'NRN Play, home'}>
        <img src="/brand/nrn-play-selected.svg" alt="NRN Play" width="158" height="42" />
      </Link>
      <div className="nrn-header-actions">
        <div className="nrn-language" role="group" aria-label={es ? 'Idioma' : 'Language'}>
          <button type="button" aria-label="Español" aria-pressed={es} onClick={() => setLang('es')}>ES</button>
          <button type="button" aria-label="English" aria-pressed={!es} onClick={() => setLang('en')}>EN</button>
        </div>
        <span className="nrn-header-divider" aria-hidden="true" />
        {accountHref ? <Link className="nrn-profile-button" to={accountHref}>{profile}</Link>
          : <button className="nrn-profile-button" type="button" onClick={onOpenAccount} aria-haspopup="dialog">{profile}</button>}
      </div>
      {connectionNotice && <div className="nrn-header-warning">{connectionNotice}</div>}
    </div>
  </header>
}
