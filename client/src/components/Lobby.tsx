import { useState, useEffect, useRef, type ReactNode, type FormEvent } from 'react'
import type { PochaDeckSize } from '@shared/pochaTypes'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { copyReportToClipboard } from '../lib/reportBug'
import { SupportProject } from './SupportProject'
import './Lobby.css'

interface LobbyProps {
  savedGames?: ReactNode
  onCreateContinental: (name: string, deckCount?: 2 | 3) => void
  onCreatePocha: (deckSize: PochaDeckSize, name: string) => void
  onJoin: (roomId: string, name: string) => void
  error: string | null
  isConnected?: boolean
  lang: Lang
  setLang: (lang: Lang) => void
  /** Pre-fill join room code (e.g. from /room/:roomId) */
  initialJoinRoomId?: string | null
  /** Dev: open Pocha game with mock state */
  onOpenPochaDev?: (deckSize: PochaDeckSize) => void
  /** Dev: open Continental game with mock state */
  onOpenContinentalDev?: () => void
}

export function Lobby({
  savedGames,
  onCreateContinental,
  onCreatePocha,
  onJoin,
  error,
  isConnected = true,
  lang,
  setLang,
  initialJoinRoomId = null,
  onOpenPochaDev,
  onOpenContinentalDev,
}: LobbyProps) {
  const [createName, setCreateName] = useState('')
  const [createDecks, setCreateDecks] = useState<2 | 3>(2)
  const [pochaName, setPochaName] = useState('')
  const [joinRoomId, setJoinRoomId] = useState(initialJoinRoomId ?? '')
  const [joinName, setJoinName] = useState('')
  const [reportCopied, setReportCopied] = useState(false)
  const joinSectionRef = useRef<HTMLFormElement | null>(null)
  const joinNameInputRef = useRef<HTMLInputElement | null>(null)

  const handleCreateSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = createName.trim()
    if (name && isConnected) onCreateContinental(name, createDecks)
  }

  const handleCreatePochaSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = pochaName.trim()
    if (name && isConnected) onCreatePocha(40, name)
  }

  const handleJoinSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!isConnected || joinRoomId.length !== 4) return
    onJoin(joinRoomId, joinName.trim() || 'Player')
  }

  useEffect(() => {
    if (initialJoinRoomId != null) {
      setJoinRoomId(initialJoinRoomId)
      // Scroll to join card and focus name when coming from /room/:roomId
      setTimeout(() => {
        joinSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        joinNameInputRef.current?.focus()
      }, 0)
    }
  }, [initialJoinRoomId])

  return (
    <main className="lobby">
      <div className="lobby-shell">
        <div className="lobby-toolbar">
          <div className="lobby-lang" role="group" aria-label={t(lang, 'language')}>
            <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} aria-label={t(lang, 'langEn')} aria-pressed={lang === 'en'}>EN</button>
            <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')} aria-label={t(lang, 'langEs')} aria-pressed={lang === 'es'}>ES</button>
          </div>
          <button
            type="button"
            className="lobby-report-bug-btn"
            onClick={async () => {
              const ok = await copyReportToClipboard({ screen: 'lobby', error: error ?? undefined })
              if (ok) {
                setReportCopied(true)
                setTimeout(() => setReportCopied(false), 2500)
              }
            }}
            title={t(lang, 'reportBugTitle')}
            aria-label={t(lang, 'reportBug')}
          >
            {reportCopied ? t(lang, 'copied') : t(lang, 'reportBug')}
          </button>
        </div>

        <header className="lobby-header">
          <h1>{t(lang, 'appTitle')}</h1>
          <p className="lobby-subtitle">{t(lang, 'appSubtitle')}</p>
          <p className="lobby-intro">{lang === 'es'
            ? 'Tu mesa de cartas con amigos, estés donde estés. Juega a Continental o La Pocha en el navegador, con salas por invitación, sin instalar nada y sin crear una cuenta.'
            : 'Your card table with friends, wherever you are. Play Continental or La Pocha in your browser, with invitation rooms, no installation and no account needed.'}</p>
          <nav className="lobby-guide-nav" aria-label={lang === 'es' ? 'Guías y ayuda' : 'Guides and help'}>
            <a href={`/learn/${lang}/continental/`}>{lang === 'es' ? 'Cómo jugar a Continental' : 'How to play Continental'}</a>
            <a href={`/learn/${lang}/pocha/`}>{lang === 'es' ? 'Cómo jugar a Pocha' : 'How to play Pocha'}</a>
            <a href={`/learn/${lang}/help/`}>{lang === 'es' ? 'Ayuda' : 'Help'}</a>
          </nav>
        </header>

        {savedGames}

        <div className="lobby-cards">
          <form
            className="lobby-card lobby-card-create"
            onSubmit={handleCreateSubmit}
            aria-labelledby="create-continental-title"
            aria-describedby="create-continental-description"
          >
            <h2 id="create-continental-title">{t(lang, 'createContinental')}</h2>
            <p id="create-continental-description">{t(lang, 'createContinentalDesc')}</p>
            <label className="lobby-field" htmlFor="create-player-name">
              <span>{t(lang, 'yourName')}</span>
              <input
                id="create-player-name"
                name="createPlayerName"
                type="text"
                placeholder={t(lang, 'yourName')}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={24}
                autoComplete="name"
                enterKeyHint="done"
                required
              />
            </label>
            <label className="lobby-field" htmlFor="create-deck-count">
              <span>{t(lang, 'decks')}</span>
              <select
                id="create-deck-count"
                name="deckCount"
                value={createDecks}
                onChange={(e) => setCreateDecks(Number(e.target.value) as 2 | 3)}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </label>
            <button type="submit" disabled={!isConnected || !createName.trim()}>
              {t(lang, 'createRoom')}
            </button>
            <a className="lobby-rule-link" href={`/learn/${lang}/continental/`}>{lang === 'es' ? 'Reglas y ejemplos de Continental →' : 'Continental rules and examples →'}</a>
          </form>

          <form className="lobby-card lobby-card-pocha" onSubmit={handleCreatePochaSubmit} aria-labelledby="create-pocha-title" aria-describedby="create-pocha-description">
            <h2 id="create-pocha-title">{t(lang, 'createPocha')}</h2>
            <p id="create-pocha-description">{t(lang, 'createPochaDesc')}</p>
            <label className="lobby-field" htmlFor="pocha-player-name">
              <span>{t(lang, 'yourName')}</span>
              <input id="pocha-player-name" name="pochaPlayerName" type="text" autoComplete="name" enterKeyHint="done" required maxLength={24} value={pochaName} onChange={e => setPochaName(e.target.value)} />
            </label>
            <button type="submit" className="lobby-create-pocha-btn" disabled={!isConnected || !pochaName.trim()}>
              {t(lang, 'createRoom')}
            </button>
            <a className="lobby-rule-link" href={`/learn/${lang}/pocha/`}>{lang === 'es' ? 'Reglas y ejemplos de Pocha →' : 'Pocha rules and examples →'}</a>
          </form>

          <form
            className="lobby-card lobby-card-join"
            ref={joinSectionRef}
            onSubmit={handleJoinSubmit}
            aria-labelledby="join-game-title"
            aria-describedby="join-game-description"
          >
            <h2 id="join-game-title">{t(lang, 'joinGame')}</h2>
            <p id="join-game-description">{t(lang, 'joinGameDesc')}</p>
            <label className="lobby-field" htmlFor="join-room-code">
              <span>{t(lang, 'room')}</span>
              <input
                id="join-room-code"
                name="roomCode"
                type="text"
                placeholder={t(lang, 'roomCodePlaceholder')}
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value.replace(/\D/g, '').slice(0, 4))}
                maxLength={4}
                minLength={4}
                pattern="[0-9]{4}"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="next"
                required
              />
            </label>
            <label className="lobby-field" htmlFor="join-player-name">
              <span>{t(lang, 'yourName')}</span>
              <input
                id="join-player-name"
                name="joinPlayerName"
                type="text"
                placeholder={t(lang, 'yourName')}
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                ref={joinNameInputRef}
                maxLength={24}
                autoComplete="name"
                enterKeyHint="done"
              />
            </label>
            <button type="submit" disabled={!isConnected || joinRoomId.length !== 4}>
              {t(lang, 'joinRoom')}
            </button>
          </form>
        </div>

        <section className="lobby-learn" aria-labelledby="lobby-learn-title">
          <div className="lobby-learn-heading">
            <span className="lobby-eyebrow">{lang === 'es' ? 'Una mesa, dos maneras de jugar' : 'One table, two ways to play'}</span>
            <h2 id="lobby-learn-title">{lang === 'es' ? 'Elige tu próxima partida' : 'Choose your next game'}</h2>
          </div>
          <div className="lobby-learn-grid">
            <article>
              <h3>Continental Rummy</h3>
              <p>{lang === 'es'
                ? 'Completa contratos de tríos y escalas a lo largo de siete rondas. Roba del mazo o del descarte, decide cuándo bajar tus combinaciones y trata de cerrar antes que los demás. Las cartas que conservas suman puntos: gana quien termina con menos.'
                : 'Complete contracts of sets and runs over seven rounds. Draw from the stock or discard pile, decide when to lay down your combinations and try to go out before everyone else. Cards left in your hand add points: the lowest total wins.'}</p>
              <a href={`/learn/${lang}/continental/`}>{lang === 'es' ? 'Ver contratos, comodines y puntuación →' : 'Explore contracts, Jokers and scoring →'}</a>
            </article>
            <article>
              <h3>La Pocha</h3>
              <p>{lang === 'es'
                ? 'Predice cuántas bazas vas a ganar y juega para cumplir tu apuesta. Importan el palo de salida, el triunfo y lo que ya han jugado los demás. La mesa permite elegir baraja y rondas; la guía explica las opciones y cómo se cuentan los puntos.'
                : 'Predict how many tricks you will win, then play to meet your bid. The led suit, trump suit and cards already played all matter. Choose the deck and rounds at your table; the guide explains the options and how points are counted.'}</p>
              <a href={`/learn/${lang}/pocha/`}>{lang === 'es' ? 'Ver bazas, triunfo y ejemplos →' : 'Explore tricks, trump and examples →'}</a>
            </article>
          </div>
          <h3 className="lobby-steps-title">{lang === 'es' ? 'De la invitación a la primera carta' : 'From invitation to the first card'}</h3>
          <ol className="lobby-start-steps">
            <li><strong>{lang === 'es' ? 'Crea una sala' : 'Create a room'}</strong><p>{lang === 'es' ? 'Elige el juego e indica tu nombre. El anfitrión prepara las opciones de la mesa.' : 'Choose a game and enter your name. The host sets up the table options.'}</p></li>
            <li><strong>{lang === 'es' ? 'Invita a tus amigos' : 'Invite your friends'}</strong><p>{lang === 'es' ? 'Comparte el enlace de invitación o el código de cuatro cifras. Cada jugador entra desde su propio navegador.' : 'Share the invitation link or four-digit room code. Each player joins from their own browser.'}</p></li>
            <li><strong>{lang === 'es' ? 'Jugad a vuestro ritmo' : 'Play at your own pace'}</strong><p>{lang === 'es' ? 'La mesa lleva los turnos y los puntos. Podéis guardar y volver desde el mismo navegador; el anfitrión puede pausar para todos.' : 'The table tracks turns and scores. Save and return from the same browser; the host can pause for everyone.'}</p></li>
          </ol>
          <a className="lobby-help-link" href={`/learn/${lang}/help/`}>{lang === 'es' ? 'Consulta la ayuda sobre invitaciones, móvil y partidas guardadas →' : 'Read the help on invitations, mobile play and saved games →'}</a>
        </section>

        {initialJoinRoomId === null && <SupportProject lang={lang} />}

        <a className="lobby-dashboard-link" href="/dashboard" target="_blank" rel="noopener noreferrer">
          {lang === 'es' ? 'Panel privado' : 'Owner dashboard'} ↗
        </a>

        <nav className="lobby-legal-links" aria-label={lang === 'es' ? 'Información del servicio' : 'Service information'}>
          <a href={`/learn/${lang}/about/`}>{lang === 'es' ? 'Sobre Conti y contacto' : 'About Conti and contact'}</a>
          <span aria-hidden="true">·</span>
          <a href={`/privacy.html#${lang}`}>{lang === 'es' ? 'Privacidad' : 'Privacy'}</a>
          <span aria-hidden="true">·</span>
          <a href={`/terms.html#${lang}`}>{lang === 'es' ? 'Términos y condiciones' : 'Terms and conditions'}</a>
        </nav>
        <p className="lobby-author">{lang === 'es' ? 'Creado por' : 'Created by'} Ignacio Rodriguez Novas Catala</p>

        {error && (
          <p className="lobby-error" role="alert" aria-live="assertive">
            {error}
          </p>
        )}

        {import.meta.env.DEV && (onOpenPochaDev || onOpenContinentalDev) && (
          <div className="lobby-dev">
            {onOpenContinentalDev && (
              <button type="button" className="lobby-dev-btn" onClick={onOpenContinentalDev}>
                {t(lang, 'playContinentalDev')}
              </button>
            )}
            {onOpenPochaDev && (
              <button type="button" className="lobby-dev-btn" onClick={() => onOpenPochaDev(40)}>
                {t(lang, 'playPochaDev')}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
