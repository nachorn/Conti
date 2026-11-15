import { useState, useEffect, useLayoutEffect, type ReactNode } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { useSocket } from './useSocket'
import { Lobby } from './components/Lobby'
import { Home } from './components/Home'
import { SiteHeader } from './components/SiteHeader'
import { SavedGames, PausedGame, SaveExitDialog } from './components/SavedGames'
import { RoomInvite } from './components/RoomInvite'
import { GameBoard } from './components/GameBoard'
import { ConnectionNotice } from './components/ConnectionNotice'
import { PochaBoard } from './components/PochaBoard'
import { usePochaMockState } from './usePochaMockState'
import { useContinentalMockState } from './useContinentalMockState'
import type { PochaDeckSize, PochaLobbyUpdate } from '@shared/pochaTypes'
import type { Lang } from './i18n'
import type { ActionResult } from './types'
import { Dashboard } from './components/Dashboard'
import { useMembership } from './useMembership'
import { Membership } from './components/Membership'
import { LeagueRoomSetup } from './components/LeagueRoomSetup'
import { AdGate } from './components/AdGate'
import { RoomChat } from './components/RoomChat'
import { useTurnSound } from './useTurnSound'
import { useRoomVerification } from './useRoomVerification'
import { gameHref, hostedCardGame } from './lib/platform'
import { GameSignIn } from './components/GameSignIn'
import { beginGameSignIn, consumeGameSignIn } from './lib/gameSignIn'

// Capture and scrub the one-use callback before mounting analytics, account
// refreshes or game sockets. The settled result survives StrictMode remounts.
const gameSignInReturn = typeof window !== 'undefined' && new URLSearchParams(window.location.hash.slice(1)).has('nrn-code')
  ? consumeGameSignIn().then(session => ({ session, failed: false }), () => ({ session: null, failed: true })) : null
let gameSignInReturnHandled = false

function usePlatformLanguage() {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = window.localStorage.getItem('conti-language')
      if (saved === 'en' || saved === 'es') return saved
    } catch { /* Keep a session-only language when storage is blocked. */ }
    return window.navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
  })
  useEffect(() => {
    document.documentElement.lang = lang
    try { window.localStorage.setItem('conti-language', lang) } catch { /* Session-only language. */ }
  }, [lang])
  return [lang, setLang] as const
}

/** Central sign-in never mounts a game socket or restores a room seat. */
function ConnectPage() {
  const membership = useMembership()
  const [lang, setLang] = usePlatformLanguage()
  const [open, setOpen] = useState(false)
  useEffect(() => { document.title = lang === 'es' ? 'Tu cuenta · NRN Play' : 'Your account · NRN Play' }, [lang])
  return <div className="nrn-platform">
    <SiteHeader lang={lang} setLang={setLang} accountName={membership.account?.name} onOpenAccount={() => setOpen(true)} />
    <Membership membership={membership} lang={lang} open={open} hideTrigger onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />
    <GameSignIn membership={membership} lang={lang} onOpenAccount={() => setOpen(true)} />
  </div>
}

export default function App() {
  // Do not mount useSocket on the dashboard: a copied player tab may contain a
  // recovery token, and monitoring must never reconnect or replace that seat.
  return <Routes>
    <Route path="/dashboard" element={<Dashboard />} />
    <Route path="/connect" element={<ConnectPage />} />
    <Route path="/*" element={<GameApp />} />
  </Routes>
}

/** Game routes and socket state. Syncs URL with in-game state. */
function GameApp() {
  const membership = useMembership()
  const [exitOpen, setExitOpen] = useState(false)
  const [membershipOpen, setMembershipOpen] = useState(false)
  const [adGateOpen, setAdGateOpen] = useState(false)
  const [lang, setLang] = usePlatformLanguage()
  const [signInError, setSignInError] = useState(false)
  const [signingIn, setSigningIn] = useState(!!gameSignInReturn && !gameSignInReturnHandled)
  const [showPochaDev, setShowPochaDev] = useState(false)
  const [showContinentalDev, setShowContinentalDev] = useState(false)
  const [chatPreviewTarget, setChatPreviewTarget] = useState<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const hostedGame = hostedCardGame(window.location.hostname)
  const isPlatformPage = ['/', '/conti', '/pocha'].includes(location.pathname)
  const pochaMock = usePochaMockState({ phase: 'playing', playerCount: 4 })
  const continentalMock = useContinentalMockState()
  const {
    state,
    roomLeague, configureLeague,
    chatMessages, sendChat,
    savedGames, resumeSavedGame, removeSavedGame, saveAndExit, continueSavedGame, deviceStorageAvailable,
    adGate,
    adGateRequested,
    beginAd,
    completeAd,
    pochaAction,
    configurePocha,
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
    rematch,
    socketId,
    connectionStatus,
    isConnected,
    recoveryRoomId,
    sessionStorageAvailable,
    reconnect,
  } = useSocket(membership.token, membership.refresh)
  const turnSound = useTurnSound(state, socketId, isConnected && !showPochaDev && !showContinentalDev)
  const roomVerification = useRoomVerification(lang)

  useEffect(() => {
    if (!gameSignInReturn || gameSignInReturnHandled) return
    let active = true
    void gameSignInReturn.then(result => {
      if (!active || gameSignInReturnHandled) return
      gameSignInReturnHandled = true
      setSignInError(result.failed || (!!result.session && !membership.adoptSession(result.session)))
      setSigningIn(false)
    })
    return () => { active = false }
  }, [membership.adoptSession])

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    if (query.get('nrn-signin') !== '1') return
    query.delete('nrn-signin')
    const search = query.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? '?' + search : ''}${window.location.hash}`)
    setSigningIn(true)
    void beginGameSignIn().catch(() => { setSigningIn(false); setSignInError(true) })
  }, [])

  const openAccount = () => {
    setAdGateOpen(false)
    if (!hostedGame || membership.account) { setMembershipOpen(true); return }
    setSigningIn(true); setSignInError(false)
    void beginGameSignIn().catch(() => { setSigningIn(false); setSignInError(true) })
  }

  useLayoutEffect(() => { window.scrollTo(0, 0) }, [location.pathname])

  useLayoutEffect(() => {
    if (!chatPreviewTarget) return
    // Share the real dock height with the game's sticky header, including text
    // scaling and device safe areas, so neither header covers the other.
    const updateHeight = () => document.documentElement.style.setProperty(
      '--room-chat-dock-height', `${chatPreviewTarget.getBoundingClientRect().height}px`,
    )
    updateHeight()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight)
    observer?.observe(chatPreviewTarget)
    window.addEventListener('resize', updateHeight)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateHeight)
      document.documentElement.style.removeProperty('--room-chat-dock-height')
    }
  }, [chatPreviewTarget])

  useEffect(() => {
    if (adGateRequested) { setMembershipOpen(false); setAdGateOpen(true) }
  }, [adGateRequested])

  useEffect(() => {
    if (!adGate?.required) setAdGateOpen(false)
  }, [adGate?.required])

  useEffect(() => {
    const pageName = location.pathname === '/conti' || (location.pathname === '/' && hostedGame === 'continental') ? 'Conti'
      : location.pathname === '/pocha' || (location.pathname === '/' && hostedGame === 'pocha') ? 'La Pocha'
      : location.pathname === '/game' && state ? (state.gameType === 'pocha' ? 'La Pocha' : 'Conti') : null
    document.title = pageName ? `${pageName} · NRN Play` : lang === 'es' ? 'NRN Play — Tu próxima partida empieza aquí' : 'NRN Play — Your next game starts here'
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (canonical) canonical.href = hostedGame ? `${window.location.origin}/`
      : location.pathname === '/conti' || location.pathname === '/pocha'
        ? new URL(gameHref(location.pathname === '/conti' ? 'conti' : 'pocha'), 'https://nrnplay.com').href
        : 'https://nrnplay.com/'
  }, [location.pathname, lang, state?.gameType, hostedGame])

  // When we have a real room (joined), go to /game
  useEffect(() => {
    if (state && roomId && location.pathname !== '/game') {
      navigate('/game', { replace: true })
    }
  }, [state, roomId, location.pathname, navigate])

  useEffect(() => { if (!state) setExitOpen(false) }, [state])

  const leaveAndGoHome = () => {
    setExitOpen(true)
    setShowPochaDev(false)
    setShowContinentalDev(false)
    // GamePage redirects only after the server confirms left. An offline click
    // must not abandon the saved seat or briefly show the wrong screen.
  }

  const handleCreateContinental = async (name: string, deckCount?: 2 | 3) => {
    if (!isConnected) return
    const proof = await roomVerification.verify()
    if (proof !== null) create(name, 'continental', deckCount, undefined, proof)
  }

  const openPochaPreview = (deckSize: PochaDeckSize) => {
    pochaMock.reset(deckSize)
    setShowPochaDev(true)
    navigate('/game')
  }
  const handleCreatePocha = async (deckSize: PochaDeckSize, name: string) => {
    if (!isConnected) return
    const proof = await roomVerification.verify()
    if (proof !== null) create(name, 'pocha', undefined, deckSize, proof)
  }

  const handleJoin = async (id: string, name: string) => {
    if (!isConnected) return false
    const proof = await roomVerification.verify()
    if (proof === null) return false
    join(id, name, proof)
    return true
  }

  const renderLobby = (gameType: 'continental' | 'pocha') => <Lobby
    key={gameType}
    gameType={gameType}
    playerName={membership.account?.name}
    savedGames={<SavedGames games={savedGames.filter(game => game.gameType === gameType)} lang={lang}
      connected={isConnected && !recoveryRoomId} resume={resumeSavedGame} forget={removeSavedGame} />}
    onCreateContinental={handleCreateContinental}
    onCreatePocha={handleCreatePocha}
    onJoin={handleJoin}
    error={error}
    isConnected={isConnected}
    lang={lang}
    setLang={setLang}
    onOpenPochaDev={openPochaPreview}
    onOpenContinentalDev={() => { setShowContinentalDev(true); navigate('/game') }}
  />

  return (
    <div className={isPlatformPage ? 'nrn-platform' : undefined}>
      {isPlatformPage && <SiteHeader lang={lang} setLang={setLang} accountName={membership.account?.name}
        onOpenAccount={openAccount} />}
      {signingIn && <p className="nrn-sign-in-status" role="status">{lang === 'es' ? 'Conectando tu cuenta de NRN Play…' : 'Connecting your NRN Play account…'}</p>}
      {signInError && <p className="nrn-sign-in-error" role="alert">{lang === 'es' ? 'No se pudo conectar tu cuenta. Puedes seguir como invitado o volver a iniciar sesión.' : 'Your account could not be connected. You can keep playing as a guest or sign in again.'} <button type="button" onClick={openAccount}>{lang === 'es' ? 'Iniciar sesión' : 'Sign in'}</button></p>}
      {roomVerification.dialog}
      {!showPochaDev && !showContinentalDev && <>
        {!location.pathname.startsWith('/room/') && <Membership membership={membership} lang={lang} open={membershipOpen}
          hideTrigger={isPlatformPage}
          onOpen={openAccount} onClose={() => setMembershipOpen(false)} />}
        <AdGate gate={adGate} state={state} playerId={socketId} lang={lang} connected={isConnected}
          open={adGateOpen} onOpen={() => { setMembershipOpen(false); setAdGateOpen(true) }} onClose={() => setAdGateOpen(false)}
          onAccount={openAccount} begin={beginAd} complete={completeAd} />
      </>}
      {!showPochaDev && !showContinentalDev && (hostedGame || location.pathname !== '/' || recoveryRoomId !== null) && (
        <ConnectionNotice
          status={connectionStatus}
          recoveryRoomId={recoveryRoomId}
          sessionStorageAvailable={sessionStorageAvailable}
          error={location.pathname === '/game' && !state ? error : null}
          lang={lang}
          onReconnect={reconnect}
        />
      )}
      {!showPochaDev && !showContinentalDev && state && roomId && <>
        <div className="saved-toolbar">
          <span className="save-status">{deviceStorageAvailable ? (lang === 'es' ? 'Guardado automático' : 'Autosaved') : (lang === 'es' ? 'Acceso sin guardar: permite el almacenamiento' : 'Access not saved: allow browser storage')}</span>
          <button className="save-subtle sound-toggle" type="button" aria-pressed={turnSound.enabled}
            aria-label={lang === 'es' ? (turnSound.enabled ? 'Silenciar aviso de turno' : 'Activar aviso de turno') : (turnSound.enabled ? 'Mute turn sound' : 'Enable turn sound')}
            title={lang === 'es' ? 'Sonido al llegar tu turno' : 'Sound when your turn starts'} onClick={turnSound.toggle}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4Z" />
              {turnSound.enabled ? <path d="M16 8c2 2 2 6 0 8m3-11c4 4 4 10 0 14" /> : <path d="m17 9 5 6m0-6-5 6" />}
            </svg>
          </button>
          {socketId && <RoomChat key={`${roomId}:${socketId}`} messages={chatMessages} playerId={socketId} lang={lang} connected={isConnected} send={sendChat} previewTarget={chatPreviewTarget} />}
          <button className="save-subtle" disabled={!isConnected} onClick={() => setExitOpen(true)}>{lang === 'es' ? 'Guardar y salir' : 'Save and exit'}</button>
        </div>
        <div className="room-chat-dock" ref={setChatPreviewTarget} />
        {exitOpen && <SaveExitDialog host={state.players[0]?.id === socketId} paused={state.savedGame?.paused ?? false}
          lang={lang} connected={isConnected} onSave={saveAndExit} onAbandon={leave} onClose={() => setExitOpen(false)} />}
      </>}
      <Routes>
        <Route
          path="/"
          element={
            hostedGame ? renderLobby(hostedGame) : <Home lang={lang} accountName={membership.account?.name} signedIn={!!membership.account} error={error} onOpenAccount={openAccount}
              savedGames={savedGames.length > 0 ? <SavedGames games={savedGames} lang={lang}
                connected={isConnected && !recoveryRoomId} resume={resumeSavedGame} forget={removeSavedGame} /> : undefined} />
          }
        />
        <Route path="/conti" element={renderLobby('continental')} />
        <Route path="/pocha" element={renderLobby('pocha')} />
        <Route
          path="/room/:roomId"
          element={
            <RoomInvite
              onJoin={handleJoin}
              error={error}
              isConnected={isConnected}
              lang={lang}
              setLang={setLang}
            />
          }
        />
        <Route
          path="/game"
          element={
            <GamePage
              lobbyExtra={state && <LeagueRoomSetup token={membership.token} roomLeague={roomLeague}
                gameType={state.gameType ?? 'continental'} isHost={state.players[0]?.id === socketId}
                nextGame={state.phase === 'game_end'}
                connected={isConnected} lang={lang} onSetLeague={configureLeague}
                onOpenAccount={openAccount} />}
              onContinueSaved={continueSavedGame}
              pochaAction={pochaAction}
              configurePocha={configurePocha}
              state={state}
              roomId={roomId}
              error={error}
              socketId={socketId}
              isConnected={isConnected}
              recovering={recoveryRoomId !== null}
              lang={lang}
              setLang={setLang}
              showPochaDev={showPochaDev}
              showContinentalDev={showContinentalDev}
              pochaMock={pochaMock}
              continentalMock={continentalMock}
              onLeave={leaveAndGoHome}
              onLeavePochaDev={() => {
                setShowPochaDev(false)
                navigate('/pocha')
              }}
              onLeaveContinentalDev={() => {
                setShowContinentalDev(false)
                navigate('/conti')
              }}
              start={(opts) => {
                if (adGate?.required && !adGate.canStart) setAdGateOpen(true)
                start(opts)
              }}
              draw={draw}
              playMelds={playMelds}
              addToMeld={addToMeld}
              swapJoker={swapJoker}
              discard={discard}
              takeDiscard={takeDiscard}
              passDiscard={passDiscard}
              nextRound={nextRound}
              rematch={() => {
                if (adGate?.required && !adGate.canStart) setAdGateOpen(true)
                rematch()
              }}
              setSeat={setSeat}
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Analytics />
      <SpeedInsights />
    </div>
  )
}

/** Renders the correct board for /game; redirects to / if not in a game. */
function GamePage({
  lobbyExtra,
  onContinueSaved,
  pochaAction,
  configurePocha,
  state,
  roomId,
  error,
  socketId,
  isConnected,
  recovering,
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
  rematch,
  setSeat,
}: {
  lobbyExtra?: ReactNode
  onContinueSaved: () => Promise<ActionResult>
  pochaAction: (action: import('@shared/pochaTypes').PochaAction) => Promise<ActionResult>
  configurePocha: (update: PochaLobbyUpdate) => Promise<ActionResult>
  state: import('./types').GameState | null
  roomId: string | null
  error: string | null
  socketId: string | null
  isConnected: boolean
  recovering: boolean
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
  addToMeld: (meldId: string, cards: import('./types').Card[]) => Promise<ActionResult>
  swapJoker: (meldId: string, cardId: string, jokerCardId: string) => Promise<ActionResult>
  discard: (cardId: string) => Promise<ActionResult>
  takeDiscard: () => void
  passDiscard: () => void
  nextRound: () => void
  rematch: () => void
  setSeat: (seatIndex: number) => void
}) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!showPochaDev && !showContinentalDev && !recovering && !(state && roomId)) {
      navigate('/', { replace: true })
    }
  }, [showPochaDev, showContinentalDev, recovering, state, roomId, navigate])

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
        onDiscard={async (id) => { continentalMock.discard(id); return { ok: true } }}
        onTakeDiscard={continentalMock.takeDiscard}
        onPassDiscard={continentalMock.passDiscard}
        onLeave={onLeaveContinentalDev}
        onNextRound={continentalMock.nextRound}
        onRematch={continentalMock.rematch}
        onDebugSkipRound={continentalMock.debugSkipRound}
        onSetSeat={continentalMock.setSeat}
      />
    )
  }

  if (state && roomId) {
    if (state.savedGame?.paused) return <PausedGame state={state} playerId={socketId} lang={lang}
      connected={isConnected} onContinue={onContinueSaved} onExit={onLeave} error={error} />
    const gameType = state.gameType ?? 'continental'
    if (gameType === 'pocha') {
      return state.pocha ? <PochaBoard state={state.pocha} socketId={socketId} lang={lang} setLang={setLang}
        lobbyExtra={lobbyExtra}
        isConnected={isConnected} error={error} onLeave={onLeave} onAction={pochaAction} onConfigure={configurePocha}
        onStart={() => start()} onNextRound={nextRound} onRematch={rematch} /> : null
    }
    return (
      <GameBoard
        state={state}
        lobbyExtra={lobbyExtra}
        socketId={socketId}
        isConnected={isConnected}
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
        onRematch={rematch}
        onSetSeat={setSeat}
      />
    )
  }

  return null
}
