import { useState, useEffect, useRef, type ReactNode, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import type { PochaDeckSize } from '@shared/pochaTypes'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { copyReportToClipboard } from '../lib/reportBug'
import { SupportProject } from './SupportProject'
import './Lobby.css'
import { platformHomeHref } from '../lib/platform'

interface LobbyProps {
  gameType: 'continental' | 'pocha'
  playerName?: string
  savedGames?: ReactNode
  onCreateContinental: (name: string, deckCount?: 2 | 3) => void
  onCreatePocha: (deckSize: PochaDeckSize, name: string) => void
  onJoin: (roomId: string, name: string) => void
  error: string | null
  isConnected?: boolean
  lang: Lang
  setLang: (lang: Lang) => void
  initialJoinRoomId?: string | null
  onOpenPochaDev?: (deckSize: PochaDeckSize) => void
  onOpenContinentalDev?: () => void
}

export function Lobby({
  gameType,
  playerName = '',
  savedGames,
  onCreateContinental,
  onCreatePocha,
  onJoin,
  error,
  isConnected = true,
  lang,
  initialJoinRoomId = null,
  onOpenPochaDev,
  onOpenContinentalDev,
}: LobbyProps) {
  const es = lang === 'es'
  const pocha = gameType === 'pocha'
  const title = pocha ? 'La Pocha' : 'Conti'
  const guide = pocha ? 'pocha' : 'continental'
  const [createName, setCreateName] = useState(playerName)
  const [createDecks, setCreateDecks] = useState<2 | 3>(2)
  const [joinRoomId, setJoinRoomId] = useState(initialJoinRoomId ?? '')
  const [joinName, setJoinName] = useState(playerName)
  const [reportCopied, setReportCopied] = useState(false)
  const createNameEdited = useRef(false)
  const joinNameEdited = useRef(false)
  const joinSectionRef = useRef<HTMLFormElement | null>(null)
  const joinNameInputRef = useRef<HTMLInputElement | null>(null)
  const reportTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Accounts can finish loading after the lobby; keep any names already typed.
  useEffect(() => {
    if (!createNameEdited.current) setCreateName(playerName)
    if (!joinNameEdited.current) setJoinName(playerName)
  }, [playerName])

  useEffect(() => () => { if (reportTimer.current) clearTimeout(reportTimer.current) }, [])

  useEffect(() => {
    if (initialJoinRoomId == null) return
    setJoinRoomId(initialJoinRoomId)
    const timer = window.setTimeout(() => {
      joinSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      joinNameInputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [initialJoinRoomId])

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = createName.trim()
    if (!name || !isConnected) return
    if (pocha) onCreatePocha(40, name)
    else onCreateContinental(name, createDecks)
  }

  const handleJoinSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isConnected || !/^\d{4}$/.test(joinRoomId)) return
    onJoin(joinRoomId, joinName.trim() || (es ? 'Jugador' : 'Player'))
  }

  return (
    <main className={`lobby lobby-${gameType}`}>
      <div className="lobby-shell">
        <Link className="lobby-back" to={platformHomeHref()}><span aria-hidden="true">←</span> {es ? 'Todos los juegos' : 'All games'}</Link>

        <header className="lobby-header">
          <div className="lobby-game-mark" aria-hidden="true">{pocha ? '✦' : '♠'}</div>
          <div>
            <h1>{title}</h1>
            <p className="lobby-intro">{pocha
              ? es ? 'Juego de bazas con baraja española.' : 'Trick-taking game with a Spanish deck.'
              : es ? 'Juego de cartas de tríos y escalas.' : 'Card game with sets and runs.'}</p>
            <a className="lobby-rule-link" href={`/learn/${lang}/${guide}/`}>{es ? 'Cómo jugar' : 'How to play'} <span aria-hidden="true">↗</span></a>
          </div>
        </header>

        {error && <p className="lobby-error" role="alert" aria-live="assertive">{error}</p>}

        <div className="lobby-cards">
          <form className="lobby-card lobby-card-create" onSubmit={handleCreateSubmit} aria-labelledby="create-game-title" aria-describedby="create-game-description">
            <span className="lobby-card-number" aria-hidden="true">01</span>
            <h2 id="create-game-title">{es ? 'Crear sala' : 'Create a room'}</h2>
            <p id="create-game-description">{es ? 'Comparte el enlace o el código con los demás jugadores.' : 'Share the link or code with other players.'}</p>
            <label className="lobby-field" htmlFor="create-player-name">
              <span>{t(lang, 'yourName')}</span>
              <input id="create-player-name" name="createPlayerName" type="text" placeholder={t(lang, 'yourName')} value={createName}
                onChange={event => { createNameEdited.current = true; setCreateName(event.target.value) }} maxLength={24} autoComplete="name" enterKeyHint="done" required />
            </label>
            {!pocha && <label className="lobby-field" htmlFor="create-deck-count">
              <span>{t(lang, 'decks')}</span>
              <select id="create-deck-count" name="deckCount" value={createDecks} onChange={event => setCreateDecks(Number(event.target.value) as 2 | 3)}>
                <option value={2}>{es ? '2 barajas' : '2 decks'}</option>
                <option value={3}>{es ? '3 barajas' : '3 decks'}</option>
              </select>
            </label>}
            {pocha && <p className="lobby-setup-note">{es ? 'Elegirás la baraja y las rondas dentro de la sala.' : 'Choose the deck and rounds inside your room.'}</p>}
            <button className="lobby-primary" type="submit" disabled={!isConnected || !createName.trim()}>{t(lang, 'createRoom')} <span aria-hidden="true">→</span></button>
          </form>

          <form className="lobby-card lobby-card-join" ref={joinSectionRef} onSubmit={handleJoinSubmit} aria-labelledby="join-game-title" aria-describedby="join-game-description">
            <span className="lobby-card-number" aria-hidden="true">02</span>
            <h2 id="join-game-title">{es ? 'Unirse a una sala' : 'Join a room'}</h2>
            <p id="join-game-description">{es ? 'Introduce el código de 4 cifras.' : 'Enter the 4-digit room code.'}</p>
            <div className="lobby-join-fields">
              <label className="lobby-field" htmlFor="join-player-name">
                <span>{t(lang, 'yourName')}</span>
                <input id="join-player-name" name="joinPlayerName" type="text" placeholder={t(lang, 'yourName')} value={joinName} ref={joinNameInputRef}
                  onChange={event => { joinNameEdited.current = true; setJoinName(event.target.value) }} maxLength={24} autoComplete="name" enterKeyHint="next" />
              </label>
              <label className="lobby-field" htmlFor="join-room-code">
                <span>{es ? 'Código de sala' : 'Room code'}</span>
                <input id="join-room-code" name="roomCode" type="text" placeholder="0000" value={joinRoomId}
                  onChange={event => setJoinRoomId(event.target.value.replace(/\D/g, '').slice(0, 4))} maxLength={4} minLength={4} pattern="[0-9]{4}"
                  inputMode="numeric" autoComplete="off" enterKeyHint="done" required />
              </label>
            </div>
            <button className="lobby-secondary" type="submit" disabled={!isConnected || joinRoomId.length !== 4}>{t(lang, 'joinRoom')} <span aria-hidden="true">→</span></button>
          </form>
        </div>

        <p className="lobby-guest-note">{es ? 'Puedes jugar sin cuenta.' : 'You can play without an account.'}</p>

        {savedGames}

        <details className="lobby-learn">
          <summary>{es ? `Reglas de ${title}` : `${title} rules`}<span aria-hidden="true">+</span></summary>
          <div className="lobby-learn-content">
            <p>{pocha
              ? es ? 'Antes de cada mano, indica cuántas bazas crees que ganarás. Se puntúa según aciertos y fallos. El anfitrión elige la baraja y las rondas.' : 'Before each hand, bid the number of tricks you expect to win. Scores depend on whether your bid is correct. The host chooses the deck and rounds.'
              : es ? 'Completa los contratos de tríos y escalas durante siete rondas. Gana quien termine con menos puntos.' : 'Complete the set and run contracts over seven rounds. The player with the fewest points wins.'}</p>
            <ol className="lobby-start-steps">
              <li><strong>{es ? 'Crear sala' : 'Create a room'}</strong><p>{es ? 'Escribe tu nombre y pulsa Crear sala.' : 'Enter your name and select Create room.'}</p></li>
              <li><strong>{es ? 'Compartir invitación' : 'Share an invitation'}</strong><p>{es ? 'Envía el enlace o el código de 4 cifras.' : 'Send the link or 4-digit room code.'}</p></li>
              <li><strong>{es ? 'Iniciar partida' : 'Start the game'}</strong><p>{es ? 'El anfitrión puede empezar cuando haya al menos dos jugadores.' : 'The host can start once at least two players have joined.'}</p></li>
            </ol>
            <a href={`/learn/${lang}/${guide}/`}>{es ? 'Reglas completas' : 'Full rules'} <span aria-hidden="true">→</span></a>
          </div>
        </details>

        <SupportProject lang={lang} />

        <footer className="lobby-footer">
          <span>NRN Play <span aria-hidden="true">·</span> {title}</span>
          <nav className="lobby-legal-links" aria-label={es ? 'Información del servicio' : 'Service information'}>
            <a href={`/learn/${lang}/help/`}>{es ? 'Ayuda' : 'Help'}</a>
            <a href={`/learn/${lang}/about/`}>{es ? 'Contacto' : 'Contact'}</a>
            <a href={`/privacy.html#${lang}`}>{es ? 'Privacidad' : 'Privacy'}</a>
            <a href={`/terms.html#${lang}`}>{es ? 'Términos' : 'Terms'}</a>
            <button type="button" className="lobby-report-bug-btn" onClick={async () => {
              if (await copyReportToClipboard({ screen: `${gameType}-lobby`, error: error ?? undefined })) {
                setReportCopied(true)
                if (reportTimer.current) clearTimeout(reportTimer.current)
                reportTimer.current = setTimeout(() => setReportCopied(false), 2500)
              }
            }} title={t(lang, 'reportBugTitle')}>{reportCopied ? t(lang, 'copied') : t(lang, 'reportBug')}</button>
          </nav>
        </footer>

        {import.meta.env.DEV && <div className="lobby-dev">
          {!pocha && onOpenContinentalDev && <button type="button" className="lobby-dev-btn" onClick={onOpenContinentalDev}>{t(lang, 'playContinentalDev')}</button>}
          {pocha && onOpenPochaDev && <button type="button" className="lobby-dev-btn" onClick={() => onOpenPochaDev(40)}>{t(lang, 'playPochaDev')}</button>}
        </div>}
      </div>
    </main>
  )
}
