import { useState } from 'react'
import './Lobby.css'

interface LobbyProps {
  onCreate: (name: string, deckCount?: 2 | 3) => void
  onJoin: (roomId: string, name: string) => void
  error: string | null
}

export function Lobby({ onCreate, onJoin, error }: LobbyProps) {
  const [createName, setCreateName] = useState('')
  const [createDecks, setCreateDecks] = useState<2 | 3>(2)
  const [joinRoomId, setJoinRoomId] = useState('')
  const [joinName, setJoinName] = useState('')

  return (
    <div className="lobby">
      <header className="lobby-header">
        <h1>Continental Rummy</h1>
        <p className="lobby-subtitle">2–10 players · 7 rounds · trios &amp; straights</p>
      </header>

      <div className="lobby-cards">
        <section className="lobby-card">
          <h2>Create game</h2>
          <p>Start a new room and share the code with friends.</p>
          <input
            type="text"
            placeholder="Your name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            maxLength={24}
          />
          <label className="lobby-deck-label">
            Decks:
            <select value={createDecks} onChange={(e) => setCreateDecks(Number(e.target.value) as 2 | 3)}>
              <option value={2}>2 decks</option>
              <option value={3}>3 decks</option>
            </select>
          </label>
          <button onClick={() => onCreate(createName || 'Player', createDecks)} disabled={!createName.trim()}>
            Create room
          </button>
        </section>

        <section className="lobby-card">
          <h2>Join game</h2>
          <p>Enter the room code from the host.</p>
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
            placeholder="Your name"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            maxLength={24}
          />
          <button
            onClick={() => onJoin(joinRoomId, joinName || 'Player')}
            disabled={!joinRoomId.trim()}
          >
            Join room
          </button>
        </section>
      </div>

      {error && <p className="lobby-error">{error}</p>}
    </div>
  )
}
