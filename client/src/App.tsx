import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { useSocket } from './useSocket'
import { Lobby } from './components/Lobby'
import { GameBoard } from './components/GameBoard'
import { PochaBoard } from './components/PochaBoard'
import { usePochaMockState } from './usePochaMockState'
import { useContinentalMockState } from './useContinentalMockState'
import type { Lang } from './i18n'

/** Root: routes and game/socket state. Syncs URL with in-game state. */
export default function App() {
  const [lang, setLang] = useState<Lang>('en')
  const [showPochaDev, setShowPochaDev] = useState(false)
  const [showContinentalDev, setShowContinentalDev] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
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
    debugSkipRound,
    socketId,
  } = useSocket()

  // When we have a real room (joined), go to /game
  useEffect(() => {
    if (state && roomId && location.pathname !== '/game') {
      navigate('/game', { replace: true })
    }
  }, [state, roomId, location.pathname, navigate])

  const leaveAndGoHome = () => {
    leave()
    setShowPochaDev(false)
    setShowContinentalDev(false)
    navigate('/')
  }

  const handleCreateContinental = (name: string, deckCount?: 2 | 3) => {
    create(name, 'continental', deckCount)
  }

  const handleCreatePocha = () => {
    setShowPochaDev(true)
    navigate('/game')
  }

  return (
    <>
      <Routes>
        <Route
          path="/"
          element={
            <Lobby
              onCreateContinental={handleCreateContinental}
              onCreatePocha={handleCreatePocha}
              onJoin={join}
              error={error}
              lang={lang}
              setLang={setLang}
              initialJoinRoomId={null}
              onOpenPochaDev={() => {
                setShowPochaDev(true)
                navigate('/game')
              }}
              onOpenContinentalDev={() => {
                setShowContinentalDev(true)
                navigate('/game')
              }}
            />
          }
        />
        <Route
          path="/room/:roomId"
          element={
            <LobbyWithRoomId
              onCreateContinental={handleCreateContinental}
              onCreatePocha={handleCreatePocha}
              onJoin={join}
              error={error}
              lang={lang}
              setLang={setLang}
              onOpenPochaDev={() => { setShowPochaDev(true); navigate('/game') }}
              onOpenContinentalDev={() => { setShowContinentalDev(true); navigate('/game') }}
            />
          }
        />
        <Route
          path="/game"
          element={
            <GamePage
              state={state}
              roomId={roomId}
              error={error}
              socketId={socketId}
              lang={lang}
              setLang={setLang}
              showPochaDev={showPochaDev}
              showContinentalDev={showContinentalDev}
              pochaMock={pochaMock}
              continentalMock={continentalMock}
              onLeave={leaveAndGoHome}
              onLeavePochaDev={() => {
                setShowPochaDev(false)
                navigate('/')
              }}
              onLeaveContinentalDev={() => {
                setShowContinentalDev(false)
                navigate('/')
              }}
              start={start}
              draw={draw}
              playMelds={playMelds}
              addToMeld={addToMeld}
              swapJoker={swapJoker}
              discard={discard}
              takeDiscard={takeDiscard}
              passDiscard={passDiscard}
              nextRound={nextRound}
              debugSkipRound={debugSkipRound}
              setSeat={setSeat}
            />
          }
        />
      </Routes>
      <Analytics />
      <SpeedInsights />
    </>
  )
}

/** Lobby when navigating to /room/:roomId; pre-fills the room code for join. */
function LobbyWithRoomId(props: Omit<React.ComponentProps<typeof Lobby>, 'initialJoinRoomId'>) {
  const { roomId } = useParams<{ roomId: string }>()
  return <Lobby {...props} initialJoinRoomId={roomId ?? null} />
}

/** Renders the correct board for /game; redirects to / if not in a game. */
function GamePage({
  state,
  roomId,
  error,
  socketId,
  lang,
  setLang,
  showPochaDev,
  showContinentalDev,
  pochaMock,
  continentalMock,
  onLeave,
  onLeavePochaDev,
  onLeaveContinentalDev,
  start,
  draw,
  playMelds,
  addToMeld,
  swapJoker,
  discard,
  takeDiscard,
  passDiscard,
  nextRound,
  debugSkipRound,
  setSeat,
}: {
  state: import('./types').GameState | null
  roomId: string | null
  error: string | null
  socketId: string | null
  lang: import('./i18n').Lang
  setLang: (l: import('./i18n').Lang) => void
  showPochaDev: boolean
  showContinentalDev: boolean
  pochaMock: ReturnType<typeof usePochaMockState>
  continentalMock: ReturnType<typeof useContinentalMockState>
  onLeave: () => void
  onLeavePochaDev: () => void
  onLeaveContinentalDev: () => void
  start: (opts?: object) => void
  draw: (fromDiscard: boolean) => void
  playMelds: (melds: { type: 'trio' | 'straight'; cards: import('./types').Card[] }[]) => void
  addToMeld: (meldId: string, cards: import('./types').Card[]) => void
  swapJoker: (meldId: string, cardId: string) => void
  discard: (cardId: string) => void
  takeDiscard: () => void
  passDiscard: () => void
  nextRound: () => void
  debugSkipRound?: () => void
  setSeat: (seatIndex: number) => void
}) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!showPochaDev && !showContinentalDev && !(state && roomId)) {
      navigate('/', { replace: true })
    }
  }, [showPochaDev, showContinentalDev, state, roomId, navigate])

  if (showPochaDev) {
    return (
      <PochaBoard
        state={pochaMock.state}
        socketId={pochaMock.socketId}
        lang={lang}
        setLang={setLang}
        onLeave={onLeavePochaDev}
        onBid={pochaMock.onBid}
        onPlayCard={pochaMock.onPlayCard}
      />
    )
  }

  if (showContinentalDev) {
    return (
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
        onLeave={onLeaveContinentalDev}
        onNextRound={continentalMock.nextRound}
        onDebugSkipRound={continentalMock.debugSkipRound}
        onSetSeat={continentalMock.setSeat}
      />
    )
  }

  if (state && roomId) {
    const gameType = state.gameType ?? 'continental'
    if (gameType === 'pocha') {
      // Server Pocha not wired yet; should not reach here with real socket
      return null
    }
    return (
      <GameBoard
        state={state}
        socketId={socketId}
        lang={lang}
        setLang={setLang}
        error={error}
        onStart={(opts) => start(opts)}
        onDraw={draw}
        onPlayMelds={playMelds}
        onAddToMeld={addToMeld}
        onSwapJoker={swapJoker}
        onDiscard={discard}
        onTakeDiscard={takeDiscard}
        onPassDiscard={passDiscard}
        onLeave={onLeave}
        onNextRound={nextRound}
        onDebugSkipRound={debugSkipRound}
        onSetSeat={setSeat}
      />
    )
  }

  return null
}
