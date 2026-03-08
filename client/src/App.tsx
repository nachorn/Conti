import { useSocket } from './useSocket'
import { Lobby } from './components/Lobby'
import { GameBoard } from './components/GameBoard'

/** Root: lobby or game board based on room state. */
export default function App() {
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
        onStart={(opts) => start(opts)}
        onDraw={draw}
        onPlayMelds={playMelds}
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
    />
  )
}
