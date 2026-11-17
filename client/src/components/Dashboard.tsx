import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardOperations, DashboardRoom } from '@shared/dashboard'
import type { AdminGameSummary, AdminOverview } from '@shared/platformAdmin'
import type { Lang } from '../i18n'
import './Dashboard.css'
import { MemberAccess } from './MemberAccess'
import { PlusAdmin } from './PlusAdmin'
import { AdminSession, adminFetch, configureAdminToken } from '../lib/adminApi'
import { AdminAccounts } from './AdminAccounts'
import { readAdminOverview } from '../lib/adminOverview'

const copy = {
  en: {
    brand: 'NRN Play', owner: 'ADMIN', title: 'Administration',
    subtitle: '', back: 'Back to games',
    private: 'Private access', privateInfo: 'Enter your administration key.',
    accessKey: 'Access key', unlock: 'Open dashboard', connecting: 'Connecting…', lock: 'Sign out',
    remember: 'Remember me for 30 days', checking: 'Checking your saved session…', signingOut: 'Signing out…',
    restoreError: 'Your saved session could not be checked. Try again when your connection returns.',
    logoutError: 'Sign out could not be confirmed. Try again to remove access from this device.',
    retry: 'Try again', retryLogout: 'Retry sign out', expired: 'Your session has expired. Please enter your access key again.',
    keyHint: 'Only remember access on your own device. Sign out to remove it.',
    unauthorized: 'That access key is not valid. Please try again.',
    rateLimited: 'Too many attempts. Please wait one minute before trying again.',
    unconfigured: 'Private access has not been set up yet. Contact the app owner to enable it.',
    unavailable: 'The live update could not be loaded. Please try again.',
    stale: 'Updates interrupted. The information below is from the last successful refresh.',
    live: 'Live', reconnecting: 'Waiting for update', refresh: 'Refresh', updating: 'Updating…',
    refreshed: 'Rooms updated', cadence: 'Rooms refresh every 5 seconds.',
    online: 'Players online', active: 'Games in progress', waiting: 'Waiting to start', offlineRooms: 'Offline rooms',
    tables: 'Tables', activeTab: 'Active now', allTab: 'All saved rooms',
    search: 'Search player or room', searchPlaceholder: 'Find a player or room code…', game: 'Game', allGames: 'All games',
    noPlayers: 'No active rooms', noPlayersInfo: '',
    noMatches: 'No matching tables', noMatchesInfo: 'Try another name, room code, or game filter.',
    noSaved: 'No saved rooms yet', noSavedInfo: 'Rooms will appear here after players join a game.',
    savedHint: 'Offline rooms keep their saved seats for up to 30 days of inactivity.',
    seatHint: 'Names identify player seats, not verified people. One person can have more than one seat.',
    room: 'Room', playersOnline: 'online', host: 'Host', turn: 'Up next', offline: 'Offline', onlinePlayer: 'Online',
    round: 'Round', of: 'of', updated: 'Updated', justNow: 'just now', minutes: 'min ago', hours: 'h ago', days: 'd ago',
    phases: { lobby: 'Waiting to start', playing: 'Playing', round_end: 'Round complete', game_end: 'Finished', auction: 'Auction', choosing_trump: 'Choosing trump', bidding: 'Bidding', hand_end: 'Round complete' },
  },
  es: {
    brand: 'NRN Play', owner: 'ADMIN', title: 'Administración',
    subtitle: '', back: 'Volver a los juegos',
    private: 'Acceso privado', privateInfo: 'Introduce tu clave de administración.',
    accessKey: 'Clave de acceso', unlock: 'Abrir panel', connecting: 'Conectando…', lock: 'Cerrar sesión',
    remember: 'Recordarme durante 30 días', checking: 'Comprobando tu sesión guardada…', signingOut: 'Cerrando sesión…',
    restoreError: 'No se pudo comprobar tu sesión guardada. Inténtalo de nuevo cuando recuperes la conexión.',
    logoutError: 'No se pudo confirmar el cierre de sesión. Inténtalo de nuevo para quitar el acceso de este dispositivo.',
    retry: 'Reintentar', retryLogout: 'Reintentar cierre de sesión', expired: 'Tu sesión ha caducado. Introduce tu clave de acceso de nuevo.',
    keyHint: 'Recuerda el acceso solo en tu dispositivo. Cierra sesión para quitarlo.',
    unauthorized: 'La clave de acceso no es válida. Inténtalo de nuevo.',
    rateLimited: 'Demasiados intentos. Espera un minuto antes de volver a intentarlo.',
    unconfigured: 'El acceso privado aún no está configurado. Contacta con el propietario para activarlo.',
    unavailable: 'No se pudo cargar la actualización. Inténtalo de nuevo.',
    stale: 'Actualizaciones interrumpidas. Se muestra la última información recibida.',
    live: 'En directo', reconnecting: 'Esperando actualización', refresh: 'Actualizar', updating: 'Actualizando…',
    refreshed: 'Salas actualizadas', cadence: 'Las salas se actualizan cada 5 segundos.',
    online: 'Jugadores en línea', active: 'Partidas en curso', waiting: 'Esperando el inicio', offlineRooms: 'Salas sin conexión',
    tables: 'Mesas', activeTab: 'Activas ahora', allTab: 'Todas las salas',
    search: 'Buscar jugador o sala', searchPlaceholder: 'Buscar jugador o código de sala…', game: 'Juego', allGames: 'Todos los juegos',
    noPlayers: 'No hay salas activas', noPlayersInfo: '',
    noMatches: 'No hay mesas que coincidan', noMatchesInfo: 'Prueba otro nombre, código de sala o filtro de juego.',
    noSaved: 'Aún no hay salas guardadas', noSavedInfo: 'Las salas aparecerán aquí cuando se unan jugadores.',
    savedHint: 'Las salas sin conexión conservan sus sitios hasta 30 días de inactividad.',
    seatHint: 'Los nombres identifican sitios de jugador, no personas verificadas. Una persona puede ocupar varios sitios.',
    room: 'Sala', playersOnline: 'en línea', host: 'Anfitrión', turn: 'Siguiente', offline: 'Sin conexión', onlinePlayer: 'En línea',
    round: 'Ronda', of: 'de', updated: 'Actualizado', justNow: 'ahora', minutes: 'min atrás', hours: 'h atrás', days: 'd atrás',
    phases: { lobby: 'Esperando el inicio', playing: 'Jugando', round_end: 'Ronda terminada', game_end: 'Finalizada', auction: 'Subasta', choosing_trump: 'Eligiendo triunfo', bidding: 'Apuestas', hand_end: 'Ronda terminada' },
  },
}
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
type Section = 'overview' | 'accounts' | 'continental' | 'pocha' | 'football' | 'plus'

export function Dashboard({ adminToken, onSignOut, onSessionExpired }: { adminToken: string; onSignOut: () => void; onSessionExpired: () => void }) {
  const [lang, setLang] = useState<Lang>(() => {
    try { const saved = localStorage.getItem('conti-language'); if (saved === 'en' || saved === 'es') return saved } catch { /* Optional preference. */ }
    return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
  })
  const c = copy[lang]
  const [session] = useState(() => new AdminSession())
  const { phase, snapshot, error, busy: loading, receivedAt } = useSyncExternalStore(session.subscribe, session.getState)
  const [clock, setClock] = useState(Date.now())
  const [showOffline, setShowOffline] = useState(false)
  const [query, setQuery] = useState('')
  const [section, setSection] = useState<Section>('overview')
  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [overviewError, setOverviewError] = useState(false)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewRevision, setOverviewRevision] = useState(0)
  const overviewChanged = useCallback(() => setOverviewRevision(value => value + 1), [])
  const heading = useRef<HTMLHeadingElement>(null)
  const unauthorized = useRef(onSessionExpired)
  unauthorized.current = onSessionExpired
  const unlocked = snapshot !== null

  useLayoutEffect(() => configureAdminToken(() => adminToken, () => { session.expire(); unauthorized.current() }), [adminToken, session])

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = `${copy[lang].title} · ${copy[lang].brand}`
    try { localStorage.setItem('conti-language', lang) } catch { /* Optional preference. */ }
  }, [lang])
  useEffect(() => {
    if (unlocked) heading.current?.focus()
  }, [unlocked, phase])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const resume = () => { if (!document.hidden) void session.refresh() }
    void session.refresh()
    const timer = window.setInterval(resume, 5_000)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      window.clearInterval(timer)
      session.cancel()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }, [session])

  useEffect(() => {
    if (!unlocked) { setOverview(null); setOverviewError(false); return }
    let active = true, request: AbortController | null = null
    const load = async () => {
      if (document.hidden || request) return
      const controller = new AbortController(); request = controller
      const timeout = window.setTimeout(() => controller.abort(), 10_000)
      setOverviewLoading(true)
      try {
        const response = await adminFetch('/api/admin/overview', { signal: controller.signal })
        if (response.status === 401) { if (active) session.expire(); return }
        const value = readAdminOverview(await response.json())
        if (!response.ok || !value) throw new Error('Invalid overview')
        if (active && !controller.signal.aborted) { setOverview(value); setOverviewError(false) }
      } catch { if (active) setOverviewError(true) }
      finally { window.clearTimeout(timeout); request = null; if (active) setOverviewLoading(false) }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 15_000)
    const visible = () => { if (!document.hidden) void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; request?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [unlocked, session, overviewRevision])

  function lock() {
    session.expire()
    setQuery(''); setShowOffline(false); setSection('overview'); setOverview(null)
    onSignOut()
  }
  const fresh = !!snapshot && !error && clock - receivedAt < 15_000
  const search = normalized(query.trim())
  const rooms = snapshot?.rooms.filter(room =>
    (showOffline || room.onlinePlayers > 0) && room.gameType === section &&
    (!search || room.roomId.includes(search) || room.players.some(player => normalized(player.name).includes(search)))
  ) ?? []
  const hasFilters = !!search
  const tabs: { id: Section; label: string }[] = [
    { id: 'overview', label: lang === 'es' ? 'Resumen' : 'Overview' }, { id: 'accounts', label: lang === 'es' ? 'Usuarios' : 'Users' },
    { id: 'continental', label: 'Conti' }, { id: 'pocha', label: 'Pocha' }, { id: 'football', label: 'FootballChampion' }, { id: 'plus', label: 'Plus' },
  ]
  const currentGame = overview?.games.find(game => game.gameType === section)

  return <main className="dashboard">
    <div className="dashboard-shell">
      <nav className="dashboard-nav" aria-label={c.owner}>
        <Link className="dashboard-brand" to="/">{c.brand}<span>{c.owner}</span></Link>
        <div className="dashboard-nav-actions">
          <div className="dashboard-language" role="group" aria-label="Language / Idioma">
            {(['en', 'es'] as const).map(value => <button key={value} aria-label={value === 'en' ? 'English' : 'Español'} aria-pressed={lang === value} onClick={() => setLang(value)}>{value.toUpperCase()}</button>)}
          </div>
          {unlocked ? <button className="dashboard-button" onClick={lock}>{c.lock}</button> : <Link className="dashboard-back" to="/">{c.back} ↗</Link>}
        </div>
      </nav>

      <header className="dashboard-header">
        <div><p className="dashboard-eyebrow">NRN Play</p><h1 ref={heading} tabIndex={-1}>{c.title}</h1></div>
        {snapshot && <div className="dashboard-live-controls">
          <span className={`dashboard-live ${fresh ? 'is-live' : ''}`} role="status"><i aria-hidden="true" />{fresh ? c.live : c.reconnecting}</span>
          <button className="dashboard-button" disabled={loading || overviewLoading} onClick={() => { void session.refresh(); overviewChanged() }}>{loading || overviewLoading ? c.updating : c.refresh}</button>
        </div>}
      </header>

      {!snapshot ? <section className="dashboard-login" aria-labelledby="dashboard-login-title">
        <div className="dashboard-lock-icon" aria-hidden="true">♠</div>
        {phase === 'unavailable' ? <><h2 id="dashboard-login-title">{lang === 'es' ? 'Panel no disponible' : 'Dashboard unavailable'}</h2>
          <p className="dashboard-error" role="alert">{c.unavailable}</p>
          <button className="dashboard-primary" disabled={loading} onClick={() => void session.refresh()}>{loading ? c.connecting : c.retry}</button></>
          : <p id="dashboard-login-title" role="status">{lang === 'es' ? 'Comprobando acceso…' : 'Checking access…'}</p>}
      </section> : <>
        {!fresh && <p className="dashboard-error" role="alert">{c.stale}</p>}
        <nav className="dashboard-main-tabs" aria-label={lang === 'es' ? 'Secciones de administración' : 'Administration sections'}>
          {tabs.map(tab => <button type="button" key={tab.id} aria-pressed={section === tab.id} onClick={() => setSection(tab.id)}>{tab.label}</button>)}
        </nav>
        {overviewError && <p className="dashboard-error" role="alert">{lang === 'es' ? 'No se pudo actualizar el resumen.' : 'The overview could not be refreshed.'}</p>}
        {section === 'overview' && <>
        <section className="dashboard-stats" aria-label={c.title}>
          {[
            [lang === 'es' ? 'Usuarios' : 'Users', overview?.accounts.total ?? '—'],
            ['Plus', overview?.accounts.plusActive ?? '—'], [c.online, snapshot.summary.onlinePlayers], [c.active, snapshot.summary.activeRooms],
          ].map(([label, value], index) => <div className={`dashboard-stat ${index === 0 ? 'is-highlighted' : ''}`} key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </section>
        <div className="dashboard-game-summaries">{(['continental', 'pocha'] as const).map(game => <button key={game} type="button" className="dashboard-game-summary" onClick={() => setSection(game)}>
          <strong>{game === 'continental' ? 'Conti' : 'Pocha'}</strong><span>{overview?.games.find(item => item.gameType === game)?.recordedGames ?? '—'} {lang === 'es' ? 'partidas registradas' : 'recorded games'}</span><span>{overview?.games.find(item => item.gameType === game)?.leagues ?? '—'} {lang === 'es' ? 'ligas' : 'leagues'} ↗</span>
        </button>)}<button type="button" className="dashboard-game-summary" onClick={() => setSection('football')}><strong>FootballChampion</strong><span>{lang === 'es' ? 'Actividad' : 'Activity'}</span><span>{overview?.football.available ? (lang === 'es' ? 'Ver informe' : 'View report') : (lang === 'es' ? 'Sin informe' : 'No report')} ↗</span></button></div>
        {snapshot.operations && <details className="dashboard-details"><summary>{lang === 'es' ? 'Servidor y almacenamiento' : 'Server and storage'}</summary><OperationsPanel operations={snapshot.operations} lang={lang} /></details>}
        </>}
        {section === 'accounts' && <AdminAccounts lang={lang} onSessionExpired={session.expire} onSaved={overviewChanged} onManagePlus={() => setSection('plus')} />}
        {section === 'plus' && <>
          <PlusAdmin lang={lang} onSessionExpired={session.expire} />
          <details className="dashboard-details"><summary>{lang === 'es' ? 'Cortesías por email y gestión avanzada' : 'Email gifts and advanced access'}</summary><MemberAccess lang={lang} onSessionExpired={session.expire} /></details>
        </>}
        {section === 'football' && <FootballPanel data={overview?.football ?? null} lang={lang} loading={overviewLoading} />}
        {(section === 'continental' || section === 'pocha') && <>
        <GameHistory summary={currentGame} lang={lang} />
        <section className="dashboard-tables" aria-labelledby="dashboard-tables-title">
          <div className="dashboard-section-heading"><h2 id="dashboard-tables-title">{c.tables} <span>{rooms.length}</span></h2>
            <div className="dashboard-tabs" role="group" aria-label={c.tables}>
              <button aria-pressed={!showOffline} onClick={() => setShowOffline(false)}>{c.activeTab}</button>
              <button aria-pressed={showOffline} onClick={() => setShowOffline(true)}>{c.allTab}</button>
            </div>
          </div>
          <div className="dashboard-filters">
            <label><span>{c.search}</span><input type="search" value={query} placeholder={c.searchPlaceholder} onChange={event => setQuery(event.target.value)} /></label>
          </div>
          {rooms.length ? <div className="dashboard-rooms">{rooms.map(room => <RoomCard key={room.roomId} room={room} lang={lang} now={snapshot.generatedAt} />)}</div>
            : <div className="dashboard-empty"><span aria-hidden="true">♣</span><h3>{hasFilters ? c.noMatches : showOffline ? c.noSaved : c.noPlayers}</h3><p>{hasFilters ? c.noMatchesInfo : showOffline ? c.noSavedInfo : c.noPlayersInfo}</p></div>}
        </section>
        </>}
        <footer className="dashboard-footer"><p>{c.refreshed} <time dateTime={new Date(receivedAt).toISOString()}>{new Date(receivedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time> · {c.cadence}</p>{(section === 'continental' || section === 'pocha') && <p>{c.savedHint} {c.seatHint}</p>}</footer>
      </>}
    </div>
  </main>
}

function GameHistory({ summary, lang }: { summary?: AdminGameSummary; lang: Lang }) {
  const es = lang === 'es'
  return <section className="dashboard-history" aria-label={es ? 'Historial del juego' : 'Game history'}>
    <div className="dashboard-stats dashboard-stats-three">{[
      [es ? 'Partidas registradas' : 'Recorded games', summary?.recordedGames ?? '—'],
      [es ? 'Jugadores con resultados' : 'Players with results', summary?.registeredPlayers ?? '—'],
      [es ? 'Ligas' : 'Leagues', summary?.leagues ?? '—'],
    ].map(([label, value]) => <div className="dashboard-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <details className="dashboard-details"><summary>{es ? 'Últimas partidas registradas' : 'Recent recorded games'}</summary>
      {summary?.recentGames.length ? <ul className="dashboard-history-list">{summary.recentGames.map(game => <li key={game.id}>
        <div><time dateTime={new Date(game.finishedAt).toISOString()}>{new Date(game.finishedAt).toLocaleString(es ? 'es-ES' : 'en-US')}</time><span>{game.playerCount} {es ? 'jugadores' : 'players'}</span></div>
        <strong>{game.winners.join(', ')}</strong>
      </li>)}</ul> : <p className="dashboard-note">{summary ? (es ? 'No hay partidas registradas.' : 'No recorded games.') : (es ? 'Historial no disponible.' : 'History unavailable.')}</p>}
    </details>
  </section>
}

function FootballPanel({ data, lang, loading }: { data: AdminOverview['football'] | null; lang: Lang; loading: boolean }) {
  const es = lang === 'es', report = data?.report
  const metric = (key: string) => report && typeof report.totals[key] === 'number' ? report.totals[key] : '—'
  return <section className="dashboard-football" aria-labelledby="dashboard-football-title">
    <div className="dashboard-section-heading"><h2 id="dashboard-football-title">FootballChampion</h2>
      {report && <span className="dashboard-note">{new Date(report.since).toLocaleDateString(lang)} – {new Date(report.until).toLocaleDateString(lang)}</span>}</div>
    <p className="dashboard-note">{es ? 'Actividad agregada. Las carreras se guardan en el navegador de cada jugador.' : 'Aggregated activity. Careers are saved in each player’s browser.'}</p>
    {data?.stale && <p className="dashboard-error" role="status">{es ? 'Se muestra el último informe disponible.' : 'Showing the last available report.'}</p>}
    {!report ? <p className="dashboard-note" role="status">{loading ? (es ? 'Cargando informe…' : 'Loading report…') : (es ? 'No hay un informe disponible.' : 'No report available.')}</p> : <>
      <div className="dashboard-stats dashboard-stats-three">{[
        [es ? 'Visitas' : 'Visits', metric('landing_view')], [es ? 'Carreras creadas' : 'Careers created', metric('career_created')],
        [es ? 'Primer partido completado' : 'First match completed', metric('first_match_completed')],
      ].map(([label, value]) => <div className="dashboard-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <div className="dashboard-report-grid">
        <ReportCounts title={es ? 'Pantallas' : 'Screens'} rows={report.screens.map(row => ({ label: row.screen, count: row.count }))} />
        <ReportCounts title={es ? 'Dispositivos' : 'Devices'} rows={report.devices.map(row => ({ label: row.device, count: row.count }))} />
      </div>
      <details className="dashboard-details"><summary>{es ? 'Actividad por día' : 'Daily activity'}</summary>
        <div className="dashboard-table-scroll"><table className="dashboard-report-table"><thead><tr><th>{es ? 'Fecha' : 'Date'}</th><th>{es ? 'Eventos' : 'Events'}</th><th>{es ? 'Carreras creadas' : 'Careers created'}</th><th>{es ? 'Primer partido completado' : 'First match completed'}</th></tr></thead>
          <tbody>{report.daily.map(row => <tr key={row.date}><th scope="row">{row.date}</th><td>{row.events}</td><td>{row.careersCreated}</td><td>{row.firstMatchesCompleted}</td></tr>)}</tbody></table></div>
      </details>
      <ReportCounts title={es ? 'Errores' : 'Errors'} rows={report.errors.map(row => ({ label: `${row.name} · ${row.source}`, count: row.count }))} />
      <details className="dashboard-details"><summary>{es ? 'Todos los eventos' : 'All events'}</summary><dl className="dashboard-counts">{Object.entries(report.totals).map(([name, count]) => <div key={name}><dt>{name.replace(/_/g, ' ')}</dt><dd>{count}</dd></div>)}</dl></details>
    </>}
  </section>
}

function ReportCounts({ title, rows }: { title: string; rows: { label: string; count: number }[] }) {
  return <details className="dashboard-details"><summary>{title} <span>{rows.length}</span></summary>
    <dl className="dashboard-counts">{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.count}</dd></div>)}</dl>
  </details>
}

function OperationsPanel({ operations, lang }: { operations: DashboardOperations; lang: Lang }) {
  const es = lang === 'es'
  const stores = [
    [es ? 'Partidas e historial' : 'Games and history', operations.storage.games],
    [es ? 'Cuentas' : 'Accounts', operations.storage.accounts],
  ] as const
  const warning = stores.some(([, store]) => store?.warning)
  return <section className="dashboard-operations" aria-labelledby="dashboard-operations-title">
    <h2 id="dashboard-operations-title">{es ? 'Estado del servicio' : 'Service status'}</h2>
    <p>{operations.healthy ? (es ? 'Funcionando correctamente' : 'Running normally') : (es ? 'El servicio necesita atención' : 'The service needs attention')}
      {' · '}{es ? 'Memoria utilizada' : 'Memory used'}: {Math.round(operations.process.rssBytes / 1024 / 1024)} MB</p>
    <div className="dashboard-storage-grid">{stores.map(([label, store]) => store && <div key={label}>
      <label>{label} <strong>{store.usedPercent}%</strong>
        <meter min={0} max={store.limitBytes} value={store.bytes} high={store.limitBytes * .75} low={0} optimum={0} />
      </label>
      <small>{(store.bytes / 1024 / 1024).toFixed(2)} / {(store.limitBytes / 1024 / 1024).toFixed(0)} MB</small>
    </div>)}</div>
    {warning && <p className="dashboard-error">{es ? 'Queda poco margen de crecimiento. Revisa la capacidad antes de admitir más partidas o cuentas.' : 'Growth capacity is running low. Review storage before admitting more games or accounts.'}</p>}
    {operations.email && <small>{es ? 'Correos pendientes' : 'Emails pending'}: {operations.email.pending}{' · '}
      {es ? 'Envíos fallidos desde el último reinicio' : 'Failed deliveries since last restart'}: {operations.email.failures}</small>}
  </section>
}

function RoomCard({ room, lang, now }: { room: DashboardRoom; lang: Lang; now: number }) {
  const c = copy[lang]
  const age = Math.max(0, now - room.updatedAt)
  const updated = age < 60_000 ? c.justNow : age < 3_600_000 ? `${Math.floor(age / 60_000)} ${c.minutes}` : age < 86_400_000 ? `${Math.floor(age / 3_600_000)} ${c.hours}` : `${Math.floor(age / 86_400_000)} ${c.days}`
  return <article className={`dashboard-room ${room.onlinePlayers ? '' : 'is-offline'}`} aria-label={`${c.room} ${room.roomId}`}>
    <header><div><p className="dashboard-game-label">{room.gameType === 'pocha' ? 'Pocha' : 'Continental'}</p><h3>{c.room} <span>{room.roomId}</span></h3></div><span className={`dashboard-phase ${room.onlinePlayers ? 'is-active' : ''}`}>{room.onlinePlayers ? c.phases[room.phase] : c.offline}</span></header>
    <div className="dashboard-room-detail"><span>{room.onlinePlayers}/{room.players.length} {c.playersOnline}</span><span>{room.round !== null ? `${c.round} ${room.round}${room.totalRounds ? ` ${c.of} ${room.totalRounds}` : ''}` : c.phases.lobby}</span></div>
    <ul className="dashboard-players">{room.players.map(player => <li key={player.id}>
      <span className={`dashboard-avatar ${player.online ? 'is-online' : ''}`} aria-hidden="true">{Array.from(player.name.trim())[0]?.toUpperCase() || '?'}</span>
      <div className="dashboard-player-name"><strong>{player.name}</strong><span>{player.online ? c.onlinePlayer : c.offline}{player.host ? ` · ${c.host}` : ''}</span></div>
      {room.currentPlayerId === player.id && <span className="dashboard-turn">{c.turn}</span>}
    </li>)}</ul>
    <footer>{c.updated} <time dateTime={new Date(room.updatedAt).toISOString()} title={new Date(room.updatedAt).toLocaleString(lang)}>{updated}</time>{!room.onlinePlayers && room.phase === 'game_end' ? ` · ${c.phases.game_end}` : ''}</footer>
  </article>
}
