import { useState } from 'react'
import { useSocket } from './useSocket'
import { Lobby } from './components/Lobby'
import { GameBoard } from './components/GameBoard'
import type { Lang } from './i18n'

/** Root: lobby or game board based on room state. */
export default function App() {
  const [lang, setLang] = useState<Lang>('en')
  const {
    state,
    roomId,
    error,
    create,
    join,
    setSeat,
    start,
    draw,
    playMelds,
    addToMeld,
    discard,
    takeDiscard,
    passDiscard,
    leave,
    nextRound,
    socketId,
  } = useSocket()

  if (state && roomId) {
    return (
      <GameBoard
        state={state}
        socketId={socketId}
        lang={lang}
        setLang={setLang}
        onStart={(opts) => start(opts)}
        onDraw={draw}
        onPlayMelds={playMelds}
        onAddToMeld={addToMeld}
        onDiscard={discard}
        onTakeDiscard={takeDiscard}
        onPassDiscard={passDiscard}
        onLeave={leave}
        onNextRound={nextRound}
        onSetSeat={setSeat}
      />
    )
  }

  return (
    <Lobby
      onCreate={create}
      onJoin={join}
      error={error}
      lang={lang}
      setLang={setLang}
    />
  )
}
