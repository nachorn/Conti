import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Lang } from '../i18n'
import type { MembershipController } from '../useMembership'
import { gameCatalog } from '../lib/gameCatalog'
import { gameLaunchHref } from '../lib/platform'
import { useCosmetics } from './Cosmetics'
import { PersonalStats } from './PersonalStats'
import { Leagues } from './Leagues'
import { accountView } from '../lib/accountReadiness'
import './Membership.css'
import './UserDashboard.css'

export function UserDashboard({ membership, lang, onOpenAccount, onOpenPlus }: {
  membership: MembershipController
  lang: Lang
  onOpenAccount: () => void
  onOpenPlus: () => void
}) {
  const es = lang === 'es'
  const [gameType, setGameType] = useState<'continental' | 'pocha'>('continental')
  const [view, setView] = useState<'stats' | 'leagues'>('stats')
  const { active: plusActive } = useCosmetics()
  const { account, token } = membership
  const identity = accountView(membership)
  const retry = () => { void membership.retryConnection() }
  const signInAgain = () => { void membership.refresh().then(onOpenAccount) }

  return <main className="user-dashboard" id="main-content">
    <div className="user-dashboard-heading">
      <h1>{es ? 'Mi panel' : 'My dashboard'}</h1>
      <Link to="/" className="user-dashboard-home">← {es ? 'Todos los juegos' : 'All games'}</Link>
    </div>

    {!account ? identity === 'signed-out' ? <section className="user-dashboard-gate" aria-labelledby="user-dashboard-access-title">
      <h2 id="user-dashboard-access-title">{es ? 'Tu cuenta de NRN Play' : 'Your NRN Play account'}</h2>
      <p>{es ? 'Entra para ver tus resultados, ligas y ajustes de cuenta.' : 'Sign in to view your results, leagues and account settings.'}</p>
      <button className="user-dashboard-button" type="button" onClick={onOpenAccount} aria-haspopup="dialog">{es ? 'Entrar o crear cuenta' : 'Sign in or create an account'}</button>
    </section> : null : <>
      <div className="user-dashboard-account-grid">
        <section className="user-dashboard-account" aria-labelledby="user-dashboard-account-title">
          <div className="user-dashboard-identity">
            <span className="user-dashboard-avatar" aria-hidden="true">{(account.name || account.email).charAt(0).toUpperCase()}</span>
            <div><h2 id="user-dashboard-account-title">{account.name || (es ? 'Mi cuenta' : 'My account')}</h2><p>{account.email}</p></div>
          </div>
          <div className="user-dashboard-actions">
            <button className="user-dashboard-button" type="button" onClick={onOpenAccount} aria-haspopup="dialog">{es ? 'Gestionar cuenta' : 'Account settings'}</button>
            <button className="user-dashboard-button is-secondary" type="button" disabled={membership.busy} onClick={() => void membership.logout()}>{es ? 'Cerrar sesión' : 'Sign out'}</button>
          </div>
          {!membership.storageAvailable && <p className="user-dashboard-note" role="status">{es ? 'Este navegador no permite recordar tu sesión.' : 'This browser cannot remember your session.'}</p>}
          {membership.error && membership.error !== 'network' && membership.error !== 'unavailable' && <p className="user-dashboard-error" role="alert">{es ? 'No se pudo completar la última acción.' : 'The last action could not be completed.'} <button type="button" onClick={retry}>{es ? 'Reintentar' : 'Try again'}</button></p>}
        </section>

        <section className="user-dashboard-plus" aria-labelledby="user-dashboard-plus-title">
          <div><h2 id="user-dashboard-plus-title">NRN Plus</h2><span className={plusActive ? 'user-dashboard-status is-active' : 'user-dashboard-status'}>{plusActive ? (es ? 'Activo' : 'Active') : (es ? 'No activo' : 'Not active')}</span></div>
          {plusActive && account.expiresAt !== null && <p>{es ? 'Hasta el ' : 'Until '}{new Date(account.expiresAt).toLocaleDateString(es ? 'es-ES' : 'en-US')}</p>}
          <button className="user-dashboard-button is-secondary" type="button" onClick={onOpenPlus} aria-haspopup="dialog">{plusActive ? (es ? 'Gestionar Plus y estilos' : 'Manage Plus and styles') : (es ? 'Ver Plus' : 'View Plus')}</button>
        </section>
      </div>

      <section className="user-dashboard-games" aria-labelledby="user-dashboard-games-title">
        <h2 id="user-dashboard-games-title">{es ? 'Juegos' : 'Games'}</h2>
        <div className="user-dashboard-game-grid">{gameCatalog.map(game => {
          const content = <><span className={`user-dashboard-game-symbol is-${game.id}`} aria-hidden="true">{game.id === 'football' ? 'FC' : game.id === 'conti' ? 'C' : 'P'}</span><h3>{game.name}</h3><p>{game.description[lang]}</p><span className="user-dashboard-game-open">{es ? 'Abrir' : 'Open'} <span aria-hidden="true">↗</span></span></>
          const href = gameLaunchHref(game.href, true)
          const label = `${es ? 'Abrir' : 'Open'} ${game.name}`
          return game.external ? <a className="user-dashboard-game" href={href} key={game.id} aria-label={label}>{content}</a> : <Link className="user-dashboard-game" to={href} key={game.id} aria-label={label}>{content}</Link>
        })}</div>
        <p className="user-dashboard-note">{es ? 'La carrera de FootballChampion se guarda en el navegador. Sus estadísticas se consultan dentro del juego.' : 'Your FootballChampion career is saved in the browser. View its statistics inside the game.'}</p>
      </section>

      <section className="user-dashboard-results" aria-labelledby="user-dashboard-results-title">
        <div className="user-dashboard-section-heading"><h2 id="user-dashboard-results-title">{es ? 'Resultados y ligas' : 'Results and leagues'}</h2>
          <div className="user-dashboard-switch" role="group" aria-label={es ? 'Juego' : 'Game'}>
            <button type="button" aria-pressed={gameType === 'continental'} onClick={() => setGameType('continental')}>Conti</button>
            <button type="button" aria-pressed={gameType === 'pocha'} onClick={() => setGameType('pocha')}>La Pocha</button>
          </div>
        </div>
        <div className="user-dashboard-switch user-dashboard-view" role="group" aria-label={es ? 'Ver resultados o ligas' : 'View results or leagues'}>
          <button type="button" aria-pressed={view === 'stats'} onClick={() => setView('stats')}>{es ? 'Estadísticas' : 'Statistics'}</button>
          <button type="button" aria-pressed={view === 'leagues'} onClick={() => setView('leagues')}>{es ? 'Ligas' : 'Leagues'}</button>
        </div>
        <div className="user-dashboard-data">
          {view === 'stats' ? <PersonalStats key={gameType} token={token} gameType={gameType} lang={lang} active={membership.authReady} onSignIn={signInAgain} />
            : <Leagues key={gameType} token={token} gameType={gameType} lang={lang} active={membership.authReady} onSignIn={signInAgain} />}
        </div>
      </section>
    </>}
  </main>
}
