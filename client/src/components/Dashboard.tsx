import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { DashboardRoom, DashboardSnapshot } from '@shared/dashboard'
import type { Lang } from '../i18n'
import './Dashboard.css'

const SERVER_URL = (import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')).replace(/\/+$/, '')
const copy = {
  en: {
    brand: 'Continental & Pocha', owner: 'OWNER DASHBOARD', title: 'Who’s playing?',
    subtitle: 'A live look at your tables, wherever you are.', back: 'Back to games',
    private: 'Your private view', privateInfo: 'Enter your access key to see players and tables.',
    accessKey: 'Access key', unlock: 'Open dashboard', connecting: 'Connecting…', lock: 'Lock dashboard',
    keyHint: 'Access stays unlocked until you reload or close this page.',
    unauthorized: 'That access key is not valid. Please try again.',
    unconfigured: 'Private access has not been set up yet. Contact the app owner to enable it.',
    unavailable: 'The live update could not be loaded. Please try again.',
    stale: 'Updates interrupted. The information below is from the last successful refresh.',
    live: 'Live', reconnecting: 'Waiting for update', refresh: 'Refresh', updating: 'Updating…',
    refreshed: 'Last refreshed', cadence: 'Refreshes every 5 seconds while this page is visible.',
    online: 'Players online', active: 'Games in progress', waiting: 'Waiting to start', offlineRooms: 'Offline rooms',
    tables: 'Tables', activeTab: 'Active now', allTab: 'All saved rooms',
    search: 'Search player or room', searchPlaceholder: 'Find a player or room code…', game: 'Game', allGames: 'All games',
    noPlayers: 'The tables are quiet', noPlayersInfo: 'When someone creates or joins a room, they’ll appear here automatically.',
    noMatches: 'No matching tables', noMatchesInfo: 'Try another name, room code, or game filter.',
    noSaved: 'No saved rooms yet', noSavedInfo: 'Rooms will appear here after players join a game.',
    savedHint: 'Offline rooms keep their saved seats for up to 72 hours of inactivity.',
    seatHint: 'Names identify player seats, not verified people. One person can have more than one seat.',
    room: 'Room', playersOnline: 'online', host: 'Host', turn: 'Up next', offline: 'Offline', onlinePlayer: 'Online',
    round: 'Round', of: 'of', updated: 'Updated', justNow: 'just now', minutes: 'min ago', hours: 'h ago', days: 'd ago',
    phases: { lobby: 'Waiting to start', playing: 'Playing', round_end: 'Round complete', game_end: 'Finished', auction: 'Auction', choosing_trump: 'Choosing trump', bidding: 'Bidding', hand_end: 'Round complete' },
  },
  es: {
    brand: 'Continental y Pocha', owner: 'PANEL PRIVADO', title: '¿Quién está jugando?',
    subtitle: 'Tus mesas en directo, estés donde estés.', back: 'Volver a los juegos',
    private: 'Tu vista privada', privateInfo: 'Introduce tu clave de acceso para ver jugadores y mesas.',
    accessKey: 'Clave de acceso', unlock: 'Abrir panel', connecting: 'Conectando…', lock: 'Bloquear panel',
    keyHint: 'El acceso permanece abierto hasta que recargues o cierres esta página.',
    unauthorized: 'La clave de acceso no es válida. Inténtalo de nuevo.',
    unconfigured: 'El acceso privado aún no está configurado. Contacta con el propietario para activarlo.',
    unavailable: 'No se pudo cargar la actualización. Inténtalo de nuevo.',
    stale: 'Actualizaciones interrumpidas. Se muestra la última información recibida.',
    live: 'En directo', reconnecting: 'Esperando actualización', refresh: 'Actualizar', updating: 'Actualizando…',
    refreshed: 'Última actualización', cadence: 'Se actualiza cada 5 segundos mientras la página está visible.',
    online: 'Jugadores en línea', active: 'Partidas en curso', waiting: 'Esperando el inicio', offlineRooms: 'Salas sin conexión',
    tables: 'Mesas', activeTab: 'Activas ahora', allTab: 'Todas las salas',
    search: 'Buscar jugador o sala', searchPlaceholder: 'Buscar jugador o código de sala…', game: 'Juego', allGames: 'Todos los juegos',
    noPlayers: 'Las mesas están tranquilas', noPlayersInfo: 'Los jugadores aparecerán aquí al crear una sala o unirse a una.',
    noMatches: 'No hay mesas que coincidan', noMatchesInfo: 'Prueba otro nombre, código de sala o filtro de juego.',
    noSaved: 'Aún no hay salas guardadas', noSavedInfo: 'Las salas aparecerán aquí cuando se unan jugadores.',
    savedHint: 'Las salas sin conexión conservan sus sitios hasta 72 horas de inactividad.',
    seatHint: 'Los nombres identifican sitios de jugador, no personas verificadas. Una persona puede ocupar varios sitios.',
    room: 'Sala', playersOnline: 'en línea', host: 'Anfitrión', turn: 'Siguiente', offline: 'Sin conexión', onlinePlayer: 'En línea',
    round: 'Ronda', of: 'de', updated: 'Actualizado', justNow: 'ahora', minutes: 'min atrás', hours: 'h atrás', days: 'd atrás',
    phases: { lobby: 'Esperando el inicio', playing: 'Jugando', round_end: 'Ronda terminada', game_end: 'Finalizada', auction: 'Subasta', choosing_trump: 'Eligiendo triunfo', bidding: 'Apuestas', hand_end: 'Ronda terminada' },
  },
}
type DashboardError = 'unauthorized' | 'unconfigured' | 'unavailable'
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function Dashboard() {
  const [lang, setLang] = useState<Lang>(() => {
    try { const saved = localStorage.getItem('conti-language'); if (saved === 'en' || saved === 'es') return saved } catch { /* Optional preference. */ }
    return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
  })
  const c = copy[lang]
  // Keep the access key only in memory, never in URLs, storage, or analytics.
  const [key, setKey] = useState('')
  const [input, setInput] = useState('')
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [error, setError] = useState<DashboardError | null>(null)
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [receivedAt, setReceivedAt] = useState(0)
  const [clock, setClock] = useState(Date.now())
  const [showOffline, setShowOffline] = useState(false)
  const [query, setQuery] = useState('')
  const [game, setGame] = useState('all')
  const heading = useRef<HTMLHeadingElement>(null)
  const keyInput = useRef<HTMLInputElement>(null)
  const unlocked = snapshot !== null

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = `${copy[lang].title} · ${copy[lang].brand}`
    try { localStorage.setItem('conti-language', lang) } catch { /* Optional preference. */ }
  }, [lang])
  useEffect(() => {
    if (unlocked) heading.current?.focus()
    else keyInput.current?.focus()
  }, [unlocked])
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!key) return
    let cancelled = false
    let busy = false
    let timer: number | undefined
    let controller: AbortController | undefined
    async function update() {
      if (cancelled || busy || document.hidden) return
      window.clearTimeout(timer)
      busy = true
      setLoading(true)
      controller = new AbortController()
      const timeout = window.setTimeout(() => controller?.abort(), 10_000)
      try {
        const response = await fetch(`${SERVER_URL}/api/admin/dashboard`, {
          headers: { Authorization: `Bearer ${key}` }, cache: 'no-store',
          credentials: 'omit', signal: controller.signal,
        })
        if (cancelled) return
        if (response.status === 401) {
          setKey(''); setSnapshot(null); setError('unauthorized')
          return
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          if (cancelled) return
          if (body?.error === 'dashboard_not_configured') {
            setKey(''); setSnapshot(null); setError('unconfigured')
            return
          }
          throw new Error('Dashboard unavailable')
        }
        const next = await response.json() as DashboardSnapshot
        if (cancelled) return
        setSnapshot(next); setReceivedAt(Date.now()); setClock(Date.now()); setError(null)
      } catch {
        if (!cancelled) setError('unavailable')
      } finally {
        window.clearTimeout(timeout)
        busy = false
        if (!cancelled) {
          setLoading(false)
          timer = window.setTimeout(update, 5_000)
        }
      }
    }
    const resume = () => { if (!document.hidden) void update() }
    void update()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      controller?.abort()
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }, [key, refresh])

  function unlock(event: FormEvent) {
    event.preventDefault()
    if (!input.trim()) return
    setError(null); setLoading(true); setKey(input.trim()); setInput(''); setRefresh(value => value + 1)
  }
  function lock() {
    setKey(''); setInput(''); setSnapshot(null); setError(null); setLoading(false)
    setQuery(''); setShowOffline(false); setGame('all')
  }
  const fresh = !!snapshot && !error && clock - receivedAt < 15_000
  const search = normalized(query.trim())
  const rooms = snapshot?.rooms.filter(room =>
    (showOffline || room.onlinePlayers > 0) && (game === 'all' || room.gameType === game) &&
    (!search || room.roomId.includes(search) || room.players.some(player => normalized(player.name).includes(search)))
  ) ?? []
  const hasFilters = !!search || game !== 'all'

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
        <div><p className="dashboard-eyebrow">{c.owner}</p><h1 ref={heading} tabIndex={-1}>{c.title}</h1><p>{c.subtitle}</p></div>
        {snapshot && <div className="dashboard-live-controls">
          <span className={`dashboard-live ${fresh ? 'is-live' : ''}`} role="status"><i aria-hidden="true" />{fresh ? c.live : c.reconnecting}</span>
          <button className="dashboard-button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? c.updating : c.refresh}</button>
        </div>}
      </header>

      {!snapshot ? <section className="dashboard-login" aria-labelledby="dashboard-login-title">
        <div className="dashboard-lock-icon" aria-hidden="true">♠</div>
        <h2 id="dashboard-login-title">{c.private}</h2><p>{c.privateInfo}</p>
        <form onSubmit={unlock}>
          <label htmlFor="dashboard-key">{c.accessKey}</label>
          <input ref={keyInput} id="dashboard-key" type="password" autoComplete="current-password" value={input} onChange={event => setInput(event.target.value)} maxLength={256} required spellCheck={false} />
          {error && <p className="dashboard-error" role="alert">{c[error]}</p>}
          <button className="dashboard-primary" disabled={!input.trim() || loading}>{loading ? c.connecting : c.unlock}</button>
        </form>
        <small>{c.keyHint}</small>
      </section> : <>
        {!fresh && <p className="dashboard-error" role="alert">{c.stale}</p>}
        <section className="dashboard-stats" aria-label={c.title}>
          {([
            ['onlinePlayers', c.online], ['activeRooms', c.active], ['waitingRooms', c.waiting], ['offlineRooms', c.offlineRooms],
          ] as const).map(([field, label]) => <div className={`dashboard-stat ${field === 'onlinePlayers' ? 'is-highlighted' : ''}`} key={field}><span>{label}</span><strong>{snapshot.summary[field]}</strong></div>)}
        </section>
        <section className="dashboard-tables" aria-labelledby="dashboard-tables-title">
          <div className="dashboard-section-heading"><h2 id="dashboard-tables-title">{c.tables} <span>{rooms.length}</span></h2>
            <div className="dashboard-tabs" role="group" aria-label={c.tables}>
              <button aria-pressed={!showOffline} onClick={() => setShowOffline(false)}>{c.activeTab}</button>
              <button aria-pressed={showOffline} onClick={() => setShowOffline(true)}>{c.allTab}</button>
            </div>
          </div>
          <div className="dashboard-filters">
            <label><span>{c.search}</span><input type="search" value={query} placeholder={c.searchPlaceholder} onChange={event => setQuery(event.target.value)} /></label>
            <label><span id="dashboard-game-label">{c.game}</span><select aria-labelledby="dashboard-game-label" value={game} onChange={event => setGame(event.target.value)}><option value="all">{c.allGames}</option><option value="continental">Continental</option><option value="pocha">Pocha</option></select></label>
          </div>
          {rooms.length ? <div className="dashboard-rooms">{rooms.map(room => <RoomCard key={room.roomId} room={room} lang={lang} now={snapshot.generatedAt} />)}</div>
            : <div className="dashboard-empty"><span aria-hidden="true">♣</span><h3>{hasFilters ? c.noMatches : showOffline ? c.noSaved : c.noPlayers}</h3><p>{hasFilters ? c.noMatchesInfo : showOffline ? c.noSavedInfo : c.noPlayersInfo}</p></div>}
        </section>
        <footer className="dashboard-footer"><p>{c.refreshed} <time dateTime={new Date(receivedAt).toISOString()}>{new Date(receivedAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time> · {c.cadence}</p><p>{c.savedHint} {c.seatHint}</p></footer>
      </>}
    </div>
  </main>
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
