import { useState, useEffect, useRef } from 'react'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import { copyReportToClipboard } from '../lib/reportBug'
import './Lobby.css'

interface LobbyProps {
  onCreateContinental: (name: string, deckCount?: 2 | 3) => void
  onCreatePocha: () => void
  onJoin: (roomId: string, name: string) => void
  error: string | null
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
  const joinSectionRef = useRef<HTMLElement | null>(null)
  const joinNameInputRef = useRef<HTMLInputElement | null>(null)

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
    <div className="lobby">
      <header className="lobby-header">
        <div className="lobby-lang" role="group" aria-label={t(lang, 'language')}>
          <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} aria-label={t(lang, 'langEn')} aria-pressed={lang === 'en'}>EN</button>
          <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')} aria-label={t(lang, 'langEs')} aria-pressed={lang === 'es'}>ES</button>
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
        <h1>{t(lang, 'appTitle')}</h1>
        <p className="lobby-subtitle">{t(lang, 'appSubtitle')}</p>
      </header>

      <div className="lobby-cards">
        <section className="lobby-card" ref={joinSectionRef as React.RefObject<HTMLElement>}>
          <h2>{t(lang, 'createContinental')}</h2>
          <p>{t(lang, 'createContinentalDesc')}</p>
          <input
            type="text"
            placeholder={t(lang, 'yourName')}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            maxLength={24}
          />
          <label className="lobby-deck-label">
            {t(lang, 'decks')}:
            <select value={createDecks} onChange={(e) => setCreateDecks(Number(e.target.value) as 2 | 3)}>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <button onClick={() => onCreateContinental(createName || 'Player', createDecks)} disabled={!createName.trim()}>
            {t(lang, 'createRoom')}
          </button>
        </section>

        <section className="lobby-card">
          <h2>{t(lang, 'createPocha')}</h2>
          <p>{t(lang, 'createPochaDesc')}</p>
          <button type="button" className="lobby-create-pocha-btn" onClick={onCreatePocha}>
            {t(lang, 'createPocha')}
          </button>
        </section>

        <section className="lobby-card">
          <h2>{t(lang, 'joinGame')}</h2>
          <p>{t(lang, 'joinGameDesc')}</p>
          <input
            type="text"
            placeholder={t(lang, 'roomCodePlaceholder')}
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value.replace(/\D/g, '').slice(0, 4))}
            maxLength={4}
            inputMode="numeric"
          />
          <input
            type="text"
            placeholder={t(lang, 'yourName')}
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            ref={joinNameInputRef}
            maxLength={24}
          />
          <button
            onClick={() => onJoin(joinRoomId, joinName || 'Player')}
            disabled={!joinRoomId.trim()}
          >
            {t(lang, 'joinRoom')}
          </button>
        </section>
      </div>

      {error && <p className="lobby-error">{error}</p>}

      {(onOpenPochaDev || onOpenContinentalDev) && (
        <p className="lobby-dev">
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
        </p>
      )}
    </div>
  )
}
