import { useState, useEffect, useRef, type FormEvent } from 'react'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { copyReportToClipboard } from '../lib/reportBug'
import './Lobby.css'

interface LobbyProps {
  onCreateContinental: (name: string, deckCount?: 2 | 3) => void
  onCreatePocha: () => void
  onJoin: (roomId: string, name: string) => void
  error: string | null
  isConnected?: boolean
  lang: Lang
  setLang: (lang: Lang) => void
  /** Pre-fill join room code (e.g. from /room/:roomId) */
  initialJoinRoomId?: string | null
  /** Dev: open Pocha game with mock state */
  onOpenPochaDev?: () => void
  /** Dev: open Continental game with mock state */
  onOpenContinentalDev?: () => void
}

export function Lobby({
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
        </header>

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
          </form>

          <section className="lobby-card lobby-card-pocha" aria-labelledby="create-pocha-title">
            <h2 id="create-pocha-title">{t(lang, 'createPocha')}</h2>
            <p>{t(lang, 'createPochaDesc')}</p>
            <button type="button" className="lobby-create-pocha-btn" onClick={onCreatePocha}>
              {t(lang, 'createPocha')}
            </button>
          </section>

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
              <button type="button" className="lobby-dev-btn" onClick={onOpenPochaDev}>
                {t(lang, 'playPochaDev')}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  )
}
