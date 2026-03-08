import { useState } from 'react'
import type { Lang } from '../i18n'
import { t } from '../i18n'
import './Lobby.css'

interface LobbyProps {
  onCreate: (name: string, deckCount?: 2 | 3) => void
  onJoin: (roomId: string, name: string) => void
  error: string | null
  lang: Lang
  setLang: (lang: Lang) => void
}

export function Lobby({ onCreate, onJoin, error, lang, setLang }: LobbyProps) {
  const [createName, setCreateName] = useState('')
  const [createDecks, setCreateDecks] = useState<2 | 3>(2)
  const [joinRoomId, setJoinRoomId] = useState('')
  const [joinName, setJoinName] = useState('')

  return (
    <div className="lobby">
      <header className="lobby-header">
        <div className="lobby-lang">
          <button type="button" className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')}>EN</button>
          <button type="button" className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')}>ES</button>
        </div>
        <h1>Continental Rummy</h1>
        <p className="lobby-subtitle">2–10 players · 7 rounds · trios &amp; straights</p>
      </header>

      <div className="lobby-cards">
        <section className="lobby-card">
          <h2>{lang === 'es' ? 'Crear partida' : 'Create game'}</h2>
          <p>{lang === 'es' ? 'Crea una sala y comparte el código.' : 'Start a new room and share the code with friends.'}</p>
          <input
            type="text"
            placeholder={lang === 'es' ? 'Tu nombre' : 'Your name'}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            maxLength={24}
          />
          <label className="lobby-deck-label">
            {lang === 'es' ? 'Mazos:' : 'Decks:'}
            <select value={createDecks} onChange={(e) => setCreateDecks(Number(e.target.value) as 2 | 3)}>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <button onClick={() => onCreate(createName || 'Player', createDecks)} disabled={!createName.trim()}>
            {t(lang, 'createRoom')}
          </button>
        </section>

        <section className="lobby-card">
          <h2>{lang === 'es' ? 'Unirse' : 'Join game'}</h2>
          <p>{lang === 'es' ? 'Código de sala del host.' : 'Enter the room code from the host.'}</p>
          <input
            type="text"
            placeholder="4-digit code (e.g. 1234)"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value.replace(/\D/g, '').slice(0, 4))}
            maxLength={4}
            inputMode="numeric"
          />
          <input
            type="text"
            placeholder={lang === 'es' ? 'Tu nombre' : 'Your name'}
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
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
    </div>
  )
}
