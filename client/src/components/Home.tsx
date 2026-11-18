import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Lang } from '../i18n'
import { gameCatalog } from '../lib/gameCatalog'
import { GameArtwork } from './GameArtwork'
import { ProfileIcon } from './SiteHeader'
import './NRNPlay.css'
import { gameLaunchHref } from '../lib/platform'
import { AdPrivacyPreferences } from './AdPrivacyPreferences'
import { PlusOffer } from './PlusOffer'
import { InstallApp } from './InstallApp'

export function Home({ lang, accountName, signedIn = !!accountName, onOpenAccount, onOpenPlus = onOpenAccount, plusActive = false, savedGames, error, profileHref = '/account' }: {
  lang: Lang; accountName?: string | null; signedIn?: boolean; onOpenAccount: () => void; onOpenPlus?: () => void; plusActive?: boolean; savedGames?: ReactNode; error?: string | null; profileHref?: string
}) {
  const es = lang === 'es'
  return <main className="nrn-home" id="main-content">
    <header className="nrn-hero">
      <h1 id="nrn-home-title">{es ? 'Juegos' : 'Games'}</h1>
    </header>

    <section className="nrn-games" aria-labelledby="nrn-home-title">
      <div className="nrn-game-grid">
        {gameCatalog.map(game => {
          const content = <>
            <div className={`nrn-game-cover nrn-game-cover-${game.id}`}><GameArtwork game={game.id} /><span className="nrn-game-cover-label">{game.id === 'football' ? 'FC' : game.id === 'conti' ? 'CONTINENTAL' : game.id === 'pocha' ? (es ? 'BARAJA ESPAÑOLA' : 'SPANISH DECK') : 'NRN PLAY'}</span></div>
            <div className="nrn-game-copy">
              <span className="nrn-game-category">{game.category[lang]}</span>
              <h2>{game.name}</h2>
              <p>{game.description[lang]}</p>
              <div className="nrn-game-bottom"><span><ProfileIcon />{game.detail[lang]}</span><span className="nrn-game-play">{es ? 'Jugar' : 'Play'} <span aria-hidden="true">↗</span></span></div>
            </div>
          </>
          return game.external
            ? <a className={`nrn-game-card nrn-game-${game.id}`} key={game.id} href={gameLaunchHref(game.href, signedIn)} aria-label={`${es ? 'Jugar a' : 'Play'} ${game.name}`}>{content}</a>
            : <Link className={`nrn-game-card nrn-game-${game.id}`} key={game.id} to={game.href} aria-label={`${es ? 'Jugar a' : 'Play'} ${game.name}`}>{content}</Link>
        })}
      </div>
    </section>

    <section className="nrn-profile-panel" aria-labelledby="nrn-profile-title">
      <span className="nrn-profile-symbol" aria-hidden="true">{accountName ? accountName.charAt(0).toUpperCase() : <ProfileIcon />}</span>
      <div><h2 id="nrn-profile-title">{accountName || (es ? 'Mi perfil' : 'My profile')}</h2><p>{es ? 'Usa la misma cuenta en Conti, Pocha y FootballChampion.' : 'Use the same account in Conti, Pocha and FootballChampion.'}</p></div>
      <Link to={profileHref}>{signedIn ? (es ? 'Abrir mi panel' : 'Open my dashboard') : (es ? 'Entrar o crear cuenta' : 'Sign in or join')}<span aria-hidden="true">→</span></Link>
    </section>

    <PlusOffer lang={lang} onOpen={onOpenPlus} active={plusActive} />
    {error && <p className="nrn-home-error" role="alert">{error}</p>}
    {savedGames && <div className="nrn-home-saved">{savedGames}</div>}
    <section className="nrn-play-guide" aria-labelledby="nrn-play-guide-title">
      <h2 id="nrn-play-guide-title">{es ? 'Guías y ayuda' : 'Guides and help'}</h2>
      <nav aria-label={es ? 'Guías de los juegos' : 'Game guides'}><a href={`/learn/${lang}/continental/`}>{es ? 'Reglas de Continental' : 'Continental rules'}</a><a href={`/learn/${lang}/pocha/`}>{es ? 'Reglas de La Pocha' : 'La Pocha rules'}</a><a href={`/learn/${lang}/standings/`}>{es ? 'Resultados y clasificación' : 'Results and standings'}</a><a href={`/learn/${lang}/help/`}>{es ? 'Invitar, guardar y volver' : 'Inviting, saving and returning'}</a></nav>
      <p>{es ? 'Para mover tu carrera de FootballChampion a otro navegador, exporta una copia desde el juego.' : 'To move your FootballChampion career to another browser, export a backup from the game.'}</p>
    </section>
    <InstallApp lang={lang} />
    <footer className="nrn-footer">
      <span>NRN Play</span>
      <nav aria-label={es ? 'Información y ayuda' : 'Information and help'}>
        <a href={`/learn/${lang}/help/`}>{es ? 'Ayuda' : 'Help'}</a>
        <a href={`/privacy.html#${lang}`}>{es ? 'Privacidad' : 'Privacy'}</a>
        <a href={`/terms.html#${lang}`}>{es ? 'Términos' : 'Terms'}</a>
        <a href="mailto:nacho@nrnplay.com">{es ? 'Contacto' : 'Contact'}</a>
        <AdPrivacyPreferences lang={lang} />
      </nav>
    </footer>
  </main>
}
