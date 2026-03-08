import { useState } from 'react'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { useSocket } from './useSocket'
import { Lobby } from './components/Lobby'
import { GameBoard } from './components/GameBoard'
import { PochaBoard } from './components/PochaBoard'
import { usePochaMockState } from './usePochaMockState'
import { useContinentalMockState } from './useContinentalMockState'
import type { Lang } from './i18n'

/** Root: lobby or game board based on room state. Pocha/Continental dev use mock state. */
export default function App() {
  const [lang, setLang] = useState<Lang>('en')
  const [showPochaDev, setShowPochaDev] = useState(false)
  const [showContinentalDev, setShowContinentalDev] = useState(false)
  const pochaMock = usePochaMockState({ phase: 'playing', playerCount: 4 })
  const continentalMock = useContinentalMockState()
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
    swapJoker,
    discard,
    takeDiscard,
    passDiscard,
    leave,
    nextRound,
    socketId,
  } = useSocket()

  return (
    <>
      {showPochaDev ? (
        <PochaBoard
          state={pochaMock.state}
          socketId={pochaMock.socketId}
          lang={lang}
          setLang={setLang}
          onLeave={() => setShowPochaDev(false)}
          onBid={pochaMock.onBid}
          onPlayCard={pochaMock.onPlayCard}
        />
      ) : showContinentalDev ? (
        <GameBoard
          state={continentalMock.state}
          socketId={continentalMock.socketId}
          lang={lang}
          setLang={setLang}
          onStart={continentalMock.start}
          onDraw={continentalMock.draw}
          onPlayMelds={continentalMock.playMelds}
          onAddToMeld={continentalMock.addToMeld}
          onSwapJoker={continentalMock.swapJoker}
          onDiscard={continentalMock.discard}
          onTakeDiscard={continentalMock.takeDiscard}
          onPassDiscard={continentalMock.passDiscard}
          onLeave={() => setShowContinentalDev(false)}
          onNextRound={continentalMock.nextRound}
          onSetSeat={continentalMock.setSeat}
        />
      ) : state && roomId ? (
        <GameBoard
          state={state}
          socketId={socketId}
          lang={lang}
          setLang={setLang}
          onStart={(opts) => start(opts)}
          onDraw={draw}
          onPlayMelds={playMelds}
          onAddToMeld={addToMeld}
          onSwapJoker={swapJoker}
          onDiscard={discard}
          onTakeDiscard={takeDiscard}
          onPassDiscard={passDiscard}
          onLeave={leave}
          onNextRound={nextRound}
          onSetSeat={setSeat}
        />
      ) : (
        <Lobby
          onCreate={create}
          onJoin={join}
          error={error}
          lang={lang}
          setLang={setLang}
          onOpenPochaDev={() => setShowPochaDev(true)}
          onOpenContinentalDev={() => setShowContinentalDev(true)}
        />
      )}
      <Analytics />
      <SpeedInsights />
    </>
  )
}
