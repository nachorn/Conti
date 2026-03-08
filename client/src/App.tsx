import { useSocket } from './useSocket'
import { Lobby } from './components/Lobby'
import { GameBoard } from './components/GameBoard'

export default function App() {
  const {
    state,
    roomId,
    error,
    create,
    join,
    start,
    draw,
    playMelds,
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
        onStart={start}
        onDraw={draw}
        onPlayMelds={playMelds}
        onDiscard={discard}
        onTakeDiscard={takeDiscard}
        onPassDiscard={passDiscard}
        onLeave={leave}
        onNextRound={nextRound}
      />
    )
  }

  return (
    <Lobby
      onCreate={create}
      onJoin={join}
      error={error}
    />
  )
}
