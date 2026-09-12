import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { RoomInviteInfo } from '@shared/roomInvite'
import type { Lang } from '../i18n'
import './RoomInvite.css'

const SERVER_URL = (import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')).replace(/\/+$/, '')

interface RoomInviteProps {
  onJoin: (roomId: string, name: string) => void
  error: string | null
  isConnected: boolean
  lang: Lang
  setLang: (lang: Lang) => void
}

export function RoomInvite({ onJoin, error, isConnected, lang, setLang }: RoomInviteProps) {
  const { roomId = '' } = useParams<{ roomId: string }>()
  const L = (es: string, en: string) => lang === 'es' ? es : en
  const [info, setInfo] = useState<RoomInviteInfo | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'missing' | 'unavailable'>('loading')
  const [name, setName] = useState('')
  const [joining, setJoining] = useState(false)
  const joiningRef = useRef(false)
  const [joinTimedOut, setJoinTimedOut] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const currentInfo = info?.roomId === roomId ? info : null
  const canJoin = isConnected && loadState === 'ready' && currentInfo?.status === 'open'

  useEffect(() => {
    setInfo(null)
    setLoadState(/^\d{4}$/.test(roomId) ? 'loading' : 'missing')
    if (!isConnected || !/^\d{4}$/.test(roomId)) return
    let stopped = false
    let request: AbortController | null = null
    let busy = false
    async function load() {
      if (busy || stopped) return
      busy = true
      const controller = new AbortController()
      request = controller
      const timeout = window.setTimeout(() => controller.abort(), 10_000)
      try {
        const response = await fetch(`${SERVER_URL}/api/rooms/${roomId}/invite`, { signal: controller.signal, cache: 'no-store' })
        if (stopped) return
        if (response.status === 404) { setInfo(null); setLoadState('missing'); return }
        if (!response.ok) throw new Error('Invitation unavailable')
        const next = await response.json() as RoomInviteInfo
        if (stopped) return
        if (next.roomId !== roomId || typeof next.hostName !== 'string' ||
            !['continental', 'pocha'].includes(next.gameType) || !['open', 'full', 'started'].includes(next.status)) {
          throw new Error('Invalid invitation')
        }
        setInfo(next); setLoadState('ready')
      } catch {
        if (!stopped) setLoadState('unavailable')
      } finally {
        window.clearTimeout(timeout)
        busy = false
      }
    }
    void load()
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    const timer = window.setInterval(onVisible, 10_000)
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true; request?.abort(); window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [roomId, isConnected, refresh, error])

  useEffect(() => {
    if (error || !isConnected) { joiningRef.current = false; setJoining(false) }
  }, [error, isConnected])

  useEffect(() => {
    if (!joining) return
    const timer = window.setTimeout(() => {
      joiningRef.current = false; setJoining(false); setJoinTimedOut(true)
      setRefresh(value => value + 1)
    }, 12_000)
    return () => window.clearTimeout(timer)
  }, [joining])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canJoin || !name.trim() || joiningRef.current) return
    joiningRef.current = true; setJoining(true); setJoinTimedOut(false)
    onJoin(roomId, name.trim())
  }

  const closed = currentInfo?.status === 'full' || currentInfo?.status === 'started'
  const problem = loadState === 'missing'
    ? L('Esta sala ya no está disponible. Pide al anfitrión una nueva invitación.', 'This room is no longer available. Ask the host for a new invitation.')
    : loadState === 'unavailable'
      ? L('No hemos podido comprobar la sala. Inténtalo de nuevo.', 'We could not check this room. Please try again.')
      : currentInfo?.status === 'full'
        ? L('La sala está llena. Podrás unirte cuando quede un sitio libre.', 'The room is full. You can join when a seat becomes available.')
        : currentInfo?.status === 'started'
          ? L('La partida ya ha empezado. Pide al anfitrión que te avise cuando vuelva a abrir la sala.', 'The game has already started. Ask the host to let you know when the room opens again.')
          : null
  const joinError = error === 'Room not found'
    ? L('Esta sala ya no está disponible.', 'This room is no longer available.')
    : error === 'Room full or game started'
      ? L('La sala se ha llenado o la partida acaba de empezar.', 'The room filled up or the game just started.')
      : error || joinTimedOut
        ? L('No se ha confirmado tu entrada. Comprueba la conexión y vuelve a intentarlo.', 'Your entry was not confirmed. Check your connection and try again.')
        : null

  return <main className="room-invite">
    <div className="room-invite-shell">
      <header className="room-invite-toolbar">
        <span>Continental <span aria-hidden="true">&</span> Pocha</span>
        <div role="group" aria-label={L('Idioma', 'Language')}>
          <button type="button" aria-label="Español" aria-pressed={lang === 'es'} onClick={() => setLang('es')}>ES</button>
          <button type="button" aria-label="English" aria-pressed={lang === 'en'} onClick={() => setLang('en')}>EN</button>
        </div>
      </header>
      <section className="room-invite-card" aria-labelledby="invite-title">
        <div className="room-invite-emblem" aria-hidden="true"><span>♣</span><span>♦</span></div>
        <p className="room-invite-eyebrow">{L('TIENES UNA INVITACIÓN', 'YOU’RE INVITED')}</p>
        <h1 id="invite-title">{loadState === 'missing' ? L('Invitación no disponible', 'Invitation unavailable') : L('La mesa te espera', 'Your seat awaits')}</h1>
        <p className="room-invite-intro">{loadState === 'missing' ? L('Comprueba el enlace con quien te ha invitado.', 'Check the link with the person who invited you.') : L('Una partida entre amigos. Solo falta tu nombre.', 'A game with friends. Just add your name.')}</p>

        <div className="room-invite-details" aria-live="polite">
          {currentInfo ? <>
            <span className="room-invite-game">{currentInfo.gameType === 'pocha' ? 'La Pocha' : 'Continental'}</span>
            <div className="room-invite-host"><span>{L('Anfitrión', 'Host')}</span><strong>{currentInfo.hostName}</strong></div>
            <div className="room-invite-meta">
              <div><span>{L('Sala', 'Room')}</span><strong className="room-invite-code">{roomId}</strong></div>
              <span>{currentInfo.playerCount} / {currentInfo.maxPlayers} {L('jugadores', 'players')}</span>
            </div>
          </> : <>
            <div className="room-invite-meta"><div><span>{L('Sala', 'Room')}</span><strong className="room-invite-code">{/^\d{4}$/.test(roomId) ? roomId : '—'}</strong></div></div>
            {loadState === 'loading' && <p role="status">{L('Comprobando la invitación…', 'Checking your invitation…')}</p>}
          </>}
        </div>

        {problem && <p className="room-invite-notice" role="status">{problem}</p>}
        {loadState !== 'missing' && !closed && <form onSubmit={submit} aria-label={L('Unirse a la partida', 'Join the game')}>
          <label htmlFor="invite-name">{L('Tu nombre', 'Your name')}</label>
          <input id="invite-name" name="name" value={name} onChange={event => setName(event.target.value)}
            maxLength={24} autoComplete="name" enterKeyHint="go" placeholder={L('¿Cómo te llamas?', 'What’s your name?')} required disabled={joining}/>
          {joinError && <p className="room-invite-error" role="alert">{joinError}</p>}
          <button className="room-invite-join" type="submit" disabled={!canJoin || !name.trim() || joining}>
            {joining ? L('Uniéndote…', 'Joining…') : !isConnected ? L('Conectando…', 'Connecting…') : L('Unirse', 'Join')}
            {!joining && isConnected && <span aria-hidden="true">→</span>}
          </button>
          <p className="room-invite-hint">{L('Entrarás directamente en esta sala.', 'You’ll go straight to this room.')}</p>
        </form>}
        {(problem || joinTimedOut) && <button className="room-invite-refresh" type="button" onClick={() => setRefresh(value => value + 1)} disabled={!isConnected}>
          {L('Volver a comprobar', 'Check again')}
        </button>}
      </section>
      <Link className="room-invite-home" to="/">{L('Ir al menú principal', 'Go to the main menu')}</Link>
    </div>
  </main>
}
