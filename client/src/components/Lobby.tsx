import { useState } from 'react'
import './Lobby.css'

interface LobbyProps {
  onCreate: (name: string) => void
  onJoin: (roomId: string, name: string) => void
  error: string | null
}

export function Lobby({ onCreate, onJoin, error }: LobbyProps) {
  const [createName, setCreateName] = useState('')
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
          <button onClick={() => onCreate(createName || 'Player')} disabled={!createName.trim()}>
            Create room
          </button>
        </section>

        <section className="lobby-card">
          <h2>Join game</h2>
          <p>Enter the room code from the host.</p>
          <input
            type="text"
            placeholder="Room code"
            value={joinRoomId}
            onChange={(e) => setJoinRoomId(e.target.value)}
            maxLength={12}
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
