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
            <span className="lobby-eyebrow">{es ? 'JUEGOS DE CARTAS · CON AMIGOS' : 'CARD GAMES · WITH FRIENDS'}</span>
            <h1>{title}<span className="lobby-title-dot">.</span></h1>
            <p className="lobby-intro">{pocha
              ? es ? 'Apuesta tus bazas. Lee la mesa. Clava tu predicción.' : 'Bid your tricks. Read the table. Make your prediction count.'
              : es ? 'Tríos, escalas y una buena mano. Tu mesa de siempre, online.' : 'Sets, runs and a good hand. Your favourite card table, online.'}</p>
            <a className="lobby-rule-link" href={`/learn/${lang}/${guide}/`}>{es ? 'Cómo jugar' : 'How to play'} <span aria-hidden="true">↗</span></a>
          </div>
        </header>

        {error && <p className="lobby-error" role="alert" aria-live="assertive">{error}</p>}

        <div className="lobby-cards">
          <form className="lobby-card lobby-card-create" onSubmit={handleCreateSubmit} aria-labelledby="create-game-title" aria-describedby="create-game-description">
            <span className="lobby-card-number" aria-hidden="true">01</span>
            <h2 id="create-game-title">{es ? 'Prepara tu mesa' : 'Set up your table'}</h2>
            <p id="create-game-description">{es ? 'Crea una sala privada e invita a tus amigos.' : 'Create a private room and invite your friends.'}</p>
            <label className="lobby-field" htmlFor="create-player-name">
              <span>{t(lang, 'yourName')}</span>
              <input id="create-player-name" name="createPlayerName" type="text" placeholder={es ? '¿Cómo te llamas?' : 'What should we call you?'} value={createName}
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
            <h2 id="join-game-title">{es ? '¿Te han invitado?' : 'Already invited?'}</h2>
            <p id="join-game-description">{es ? 'Entra con el código de cuatro cifras de tu sala.' : 'Join with your room’s four-digit code.'}</p>
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

        <p className="lobby-guest-note"><span aria-hidden="true">✓</span> {es ? 'Gratis, sin instalar nada. También puedes jugar sin cuenta.' : 'Free, with nothing to install. You can play without an account too.'}</p>

        {savedGames}

        <details className="lobby-learn">
          <summary>{es ? 'Tu primera partida de ' : 'Your first game of '}{title}<span aria-hidden="true">+</span></summary>
          <div className="lobby-learn-content">
            <p>{pocha
              ? es ? 'Predice cuántas bazas vas a ganar y juega para cumplir tu apuesta. El palo de salida, el triunfo y las cartas de los demás te darán las pistas. El anfitrión elige la baraja y las rondas antes de empezar.' : 'Predict how many tricks you will win, then play to meet your bid. Watch the led suit, trump and the cards already played. The host chooses the deck and rounds before you start.'
              : es ? 'Completa contratos de tríos y escalas a lo largo de siete rondas. Roba, baja tus combinaciones y trata de cerrar antes que los demás. Las cartas que conservas suman puntos: gana quien termina con menos.' : 'Complete contracts of sets and runs over seven rounds. Draw, lay down your combinations and try to go out before everyone else. Cards left in your hand add points: the lowest total wins.'}</p>
            <ol className="lobby-start-steps">
              <li><strong>{es ? 'Crea una sala' : 'Create a room'}</strong><p>{es ? 'Escribe tu nombre y prepara la partida.' : 'Enter your name and set up your game.'}</p></li>
              <li><strong>{es ? 'Invita a tus amigos' : 'Invite your friends'}</strong><p>{es ? 'Comparte el enlace o el código de cuatro cifras.' : 'Share the invitation link or four-digit code.'}</p></li>
              <li><strong>{es ? 'Jugad a vuestro ritmo' : 'Play at your own pace'}</strong><p>{es ? 'La mesa lleva los turnos y los puntos. Podéis guardar y volver.' : 'The table tracks turns and scores. Save your game and return later.'}</p></li>
            </ol>
            <a href={`/learn/${lang}/${guide}/`}>{es ? 'Ver todas las reglas y ejemplos' : 'Read all the rules and examples'} <span aria-hidden="true">→</span></a>
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
