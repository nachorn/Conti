import { lazy, Suspense, useState, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { useSocket } from './useSocket'
import { Lobby } from './components/Lobby'
import { Home } from './components/Home'
import { SiteHeader } from './components/SiteHeader'
import { SavedGames, PausedGame, SaveExitDialog } from './components/SavedGames'
import { RoomInvite } from './components/RoomInvite'
import { ConnectionNotice, ServerConnectionWarning } from './components/ConnectionNotice'
import { usePochaMockState } from './usePochaMockState'
import { useContinentalMockState } from './useContinentalMockState'
import type { PochaDeckSize, PochaLobbyUpdate } from '@shared/pochaTypes'
import type { Lang } from './i18n'
import type { ActionResult } from './types'
import { useMembership } from './useMembership'
import { Membership } from './components/Membership'
import { LeagueRoomSetup } from './components/LeagueRoomSetup'
import { AdGate } from './components/AdGate'
import { RoomChat } from './components/RoomChat'
import { useTurnSound } from './useTurnSound'
import { useRoomVerification } from './useRoomVerification'
import { gameHref, hostedCardGame, platformAccountHref } from './lib/platform'
import { GameSignIn } from './components/GameSignIn'
import { beginGameSignIn, consumeGameSignIn } from './lib/gameSignIn'
import { CosmeticsProvider } from './components/Cosmetics'
import { PlusOffer } from './components/PlusOffer'
import { hasCosmeticAccess } from './lib/cosmetics'
import { UserDashboard } from './components/UserDashboard'
import { criticalConnectionState } from './lib/connectionFeedback'
import { useConnectionWarning } from './useConnectionWarning'
import { adminAccess, adminDestination } from './lib/adminRoute'
import { accountCookieEnabled } from './lib/accountTransport'

const GameBoard = lazy(() => import('./components/GameBoard').then(module => ({ default: module.GameBoard })))
const PochaBoard = lazy(() => import('./components/PochaBoard').then(module => ({ default: module.PochaBoard })))
const LeagueResult = lazy(() => import('./components/LeagueResult').then(module => ({ default: module.LeagueResult })))
const Dashboard = lazy(() => import('./components/Dashboard').then(module => ({ default: module.Dashboard })))

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
  const connectionNotice = membership.connectionWarning ? <ServerConnectionWarning accountUnavailable lang={lang} onRetry={() => void membership.retryConnection()} /> : undefined
  useEffect(() => { document.title = lang === 'es' ? 'Tu cuenta · NRN Play' : 'Your account · NRN Play' }, [lang])
  return <CosmeticsProvider account={membership.account} lang={lang}><div className="nrn-platform">
    <SiteHeader lang={lang} setLang={setLang} accountName={membership.account?.name} isAdmin={membership.account?.isAdmin === true && !!membership.token} onOpenAccount={() => setOpen(true)} connectionNotice={!open ? connectionNotice : undefined} />
    <Membership membership={membership} lang={lang} open={open} hideTrigger onOpen={() => setOpen(true)} onClose={() => setOpen(false)} connectionNotice={open ? connectionNotice : undefined} />
    <GameSignIn membership={membership} lang={lang} onOpenAccount={() => setOpen(true)} />
  </div></CosmeticsProvider>
}

/** Personal account data never mounts a game socket or an administrative API. */
function AccountPage() {
  const membership = useMembership()
  const [lang, setLang] = usePlatformLanguage()
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<'account' | 'plus'>('account')
  const openAccount = () => { setSection('account'); setOpen(true) }
  const openPlus = () => { setSection('plus'); setOpen(true) }
  const connectionNotice = membership.connectionWarning ? <ServerConnectionWarning accountUnavailable lang={lang} onRetry={() => void membership.retryConnection()} /> : undefined
  useEffect(() => { document.title = lang === 'es' ? 'Mi panel · NRN Play' : 'My dashboard · NRN Play' }, [lang])
  return <CosmeticsProvider account={membership.account} lang={lang}><div className="nrn-platform">
    <SiteHeader lang={lang} setLang={setLang} accountName={membership.account?.name} isAdmin={membership.account?.isAdmin === true && !!membership.token} onOpenAccount={openAccount} connectionNotice={!open ? connectionNotice : undefined} />
    <Membership membership={membership} lang={lang} open={open} initialSection={section} hideTrigger onOpen={openAccount} onClose={() => setOpen(false)} connectionNotice={open ? connectionNotice : undefined} />
    <UserDashboard membership={membership} lang={lang} onOpenAccount={openAccount} onOpenPlus={openPlus} />
  </div></CosmeticsProvider>
}

export default function App() {
  // Do not mount useSocket on the dashboard: a copied player tab may contain a
  // recovery token, and monitoring must never reconnect or replace that seat.
  return <Routes>
    <Route path="/admin/*" element={<AdminEntry />} />
    <Route path="/dashboard/*" element={<AdminEntry legacy />} />
    <Route path="/connect" element={<ConnectPage />} />
    <Route path="/account" element={<AccountPage />} />
    <Route path="/*" element={<GameApp />} />
  </Routes>
}

function AdminEntry({ legacy = false }: { legacy?: boolean }) {
  const destination = adminDestination(window.location.hostname)
  const external = destination.startsWith('https://')
  useEffect(() => { if (external) window.location.replace(destination) }, [destination, external])
  if (external) return null
  if (legacy) return <Navigate to="/admin" replace />
  return <AdminGate />
}

/** Account verification is separate from game state and never mounts a room socket. */
export function AdminGate() {
  const membership = useMembership()
  const [lang] = usePlatformLanguage()
  const [rechecking, setRechecking] = useState(false)
  const access = adminAccess(membership)
  if (access === 'denied') return <Navigate to={membership.account ? '/' : '/account'} replace />
  if (access === 'pending' || rechecking) return membership.connectionWarning ? <div className="nrn-connection-corner"><ServerConnectionWarning accountUnavailable lang={lang} onRetry={() => void membership.retryConnection()} /></div> : null
  const revalidate = () => {
    setRechecking(true)
    void membership.refresh().finally(() => setRechecking(false))
  }
  return <Suspense fallback={null}><Dashboard key={membership.token} adminToken={membership.token!} onAccountExpired={revalidate} /></Suspense>
}

/** Game routes and socket state. Syncs URL with in-game state. */
function GameApp() {
  const membership = useMembership()
  const cookieAccount = accountCookieEnabled()
  const [exitOpen, setExitOpen] = useState(false)
  const [membershipOpen, setMembershipOpen] = useState(() => window.location.hash === '#plus')
  const [membershipSection, setMembershipSection] = useState<'account' | 'plus'>(() => window.location.hash === '#plus' ? 'plus' : 'account')
  const [adGateOpen, setAdGateOpen] = useState(false)
  const [lang, setLang] = usePlatformLanguage()
  const [signInError, setSignInError] = useState(false)
  const [, setSigningIn] = useState(!!gameSignInReturn && !gameSignInReturnHandled)
  const [showPochaDev, setShowPochaDev] = useState(false)
  const [showContinentalDev, setShowContinentalDev] = useState(false)
  const [chatPreviewTarget, setChatPreviewTarget] = useState<HTMLDivElement | null>(null)
  const [enteringRoom, setEnteringRoom] = useState(false)
  const roomEntryPending = useRef(false)
  const navigate = useNavigate()
  const location = useLocation()
  const entryLocation = useRef(location.key)
  entryLocation.current = location.key
  const hostedGame = hostedCardGame(window.location.hostname)
  const isPlatformPage = ['/', '/conti', '/pocha'].includes(location.pathname)
  const pochaMock = usePochaMockState({ phase: 'playing', playerCount: 4 })
  const continentalMock = useContinentalMockState()
  const {
    state,
    roomLeague, leagueResultId, configureLeague,
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
    ensureConnected,
  } = useSocket(membership.token, membership.refresh)
  const socketRelevant = !showPochaDev && !showContinentalDev && connectionStatus !== 'idle'
  const canEnterRoom = !enteringRoom && !recoveryRoomId
  const recoveryRejected = recoveryRoomId !== null && !!error && !state
  const criticalConnection = criticalConnectionState(connectionStatus, recoveryRoomId, sessionStorageAvailable, recoveryRejected)
  const recoveringSeat = recoveryRoomId !== null && connectionStatus !== 'connected'
  const socketWarning = useConnectionWarning(socketRelevant && !criticalConnection && (connectionStatus === 'reconnecting' || recoveringSeat),
    !socketRelevant || criticalConnection || connectionStatus === 'connected')
  const noticeInModal = membershipOpen && !location.pathname.startsWith('/room/') && !showPochaDev && !showContinentalDev
  const connectionNotice = (noticeInModal || !criticalConnection) && (membership.connectionWarning || socketWarning) ? <ServerConnectionWarning
    accountUnavailable={membership.connectionWarning} gameUnavailable={socketWarning} recoveringGame={recoveringSeat} lang={lang} onRetry={() => {
      if (socketWarning) reconnect()
      if (membership.connectionWarning) void membership.retryConnection()
    }} /> : undefined
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
    if (cookieAccount && !membership.authReady) return
    query.delete('nrn-signin')
    const search = query.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search ? '?' + search : ''}${window.location.hash}`)
    const previousToken = cookieAccount ? null : membership.token
    membership.clearLocalSession()
    setSigningIn(true)
    void beginGameSignIn({ previousToken }).catch(() => { setSigningIn(false); setSignInError(true) })
  }, [cookieAccount, membership.authReady, membership.clearLocalSession, membership.token])

  const showAccount = () => {
    setAdGateOpen(false)
    if (!hostedGame || membership.account || membership.token || cookieAccount && !membership.authReady) { setMembershipOpen(true); return }
    const previousToken = cookieAccount ? null : membership.token
    membership.clearLocalSession()
    setSigningIn(true); setSignInError(false)
    void beginGameSignIn({ previousToken }).catch(() => { setSigningIn(false); setSignInError(true) })
  }
  const openAccount = () => { setMembershipSection('account'); showAccount() }
  const openPlus = () => { setMembershipSection('plus'); showAccount() }
  const closeAccount = () => {
    setMembershipOpen(false)
    if (window.location.hash === '#plus') window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }
  useEffect(() => {
    const requested = () => {
      if (window.location.hash === '#plus') { setMembershipSection('plus'); setMembershipOpen(true) }
    }
    window.addEventListener('hashchange', requested)
    return () => window.removeEventListener('hashchange', requested)
  }, [])

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
    document.title = pageName ? `${pageName} · NRN Play` : 'NRN Play'
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

  const enterRoom = async (submit: (proof: string | undefined) => boolean) => {
    if (roomEntryPending.current || recoveryRoomId) return false
    const origin = entryLocation.current
    roomEntryPending.current = true
    setEnteringRoom(true)
    try {
      if (!await ensureConnected() || origin !== entryLocation.current) return false
      const proof = await roomVerification.verify()
      return proof !== null && origin === entryLocation.current && submit(proof)
    } finally {
      roomEntryPending.current = false
      setEnteringRoom(false)
    }
  }

  const handleCreateContinental = (name: string, deckCount?: 2 | 3) =>
    enterRoom(proof => create(name, 'continental', deckCount, undefined, proof))

  const openPochaPreview = (deckSize: PochaDeckSize) => {
    pochaMock.reset(deckSize)
    setShowPochaDev(true)
    navigate('/game')
  }
  const handleCreatePocha = (deckSize: PochaDeckSize, name: string) =>
    enterRoom(proof => create(name, 'pocha', undefined, deckSize, proof))

  const handleJoin = (id: string, name: string) => enterRoom(proof => join(id, name, proof))

  const renderLobby = (gameType: 'continental' | 'pocha') => <Lobby
    key={gameType}
    gameType={gameType}
    playerName={membership.account?.name}
    savedGames={<SavedGames games={savedGames.filter(game => game.gameType === gameType)} lang={lang}
      connected={canEnterRoom} resume={resumeSavedGame} forget={removeSavedGame} />}
    onCreateContinental={handleCreateContinental}
    onCreatePocha={handleCreatePocha}
    onJoin={handleJoin}
    error={error}
    isConnected={canEnterRoom}
    lang={lang}
    setLang={setLang}
    onOpenPochaDev={openPochaPreview}
    onOpenContinentalDev={() => { setShowContinentalDev(true); navigate('/game') }}
  />

  const accountGameType = location.pathname === '/conti' ? 'continental'
    : location.pathname === '/pocha' ? 'pocha'
    : location.pathname === '/game' && state ? state.gameType ?? 'continental'
    : location.pathname === '/' ? hostedGame : null

  return (
    <CosmeticsProvider account={membership.account} lang={lang}>
    <div className={isPlatformPage ? 'nrn-platform' : undefined}>
      {isPlatformPage && <SiteHeader lang={lang} setLang={setLang} accountName={membership.account?.name}
        isAdmin={membership.account?.isAdmin === true && !!membership.token}
        accountHref={!hostedGame && location.pathname === '/' ? platformAccountHref() : undefined}
        connectionNotice={!noticeInModal ? connectionNotice : undefined}
        onOpenAccount={openAccount} />}
      {!isPlatformPage && !noticeInModal && connectionNotice && <div className="nrn-connection-corner nrn-connection-corner--game">{connectionNotice}</div>}
      {signInError && <p className="nrn-sign-in-error" role="alert">{lang === 'es' ? 'No se pudo conectar tu cuenta. Puedes volver a iniciar sesión.' : 'Your account could not be connected. You can sign in again.'} <button type="button" onClick={openAccount}>{lang === 'es' ? 'Iniciar sesión' : 'Sign in'}</button></p>}
      {roomVerification.dialog}
      {!showPochaDev && !showContinentalDev && <>
        {!location.pathname.startsWith('/room/') && <Membership membership={membership} lang={lang} open={membershipOpen} gameType={accountGameType}
          hideTrigger={isPlatformPage}
          initialSection={membershipSection}
          connectionNotice={noticeInModal ? connectionNotice : undefined}
          onOpen={openAccount} onClose={closeAccount} />}
        <AdGate gate={adGate} state={state} playerId={socketId} lang={lang} connected={isConnected}
          open={adGateOpen} onOpen={() => { setMembershipOpen(false); setAdGateOpen(true) }} onClose={() => setAdGateOpen(false)}
          onAccount={openAccount} begin={beginAd} complete={completeAd} />
      </>}
      {socketRelevant && criticalConnection && (
        <ConnectionNotice
          status={connectionStatus}
          recoveryRoomId={recoveryRoomId}
          sessionStorageAvailable={sessionStorageAvailable}
          error={recoveryRejected ? error : null}
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
            hostedGame ? renderLobby(hostedGame) : <Home lang={lang} accountName={membership.account?.name} signedIn={!!membership.token} error={error} onOpenAccount={() => navigate('/account')} profileHref={platformAccountHref()}
              onOpenPlus={openPlus} plusActive={hasCosmeticAccess(membership.account)}
              savedGames={savedGames.length > 0 ? <SavedGames games={savedGames} lang={lang}
                connected={canEnterRoom} resume={resumeSavedGame} forget={removeSavedGame} /> : undefined} />
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
              entryAvailable={canEnterRoom}
              entryPending={enteringRoom}
              lang={lang}
              setLang={setLang}
            />
          }
        />
        <Route
          path="/game"
          element={
            <GamePage
              leagueResultExtra={state?.phase === 'game_end' && leagueResultId && <Suspense fallback={null}>
                <LeagueResult token={membership.token} matchId={leagueResultId} roomId={roomId} lang={lang} />
              </Suspense>}
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
      {location.pathname === '/game' && state?.phase === 'game_end' && <PlusOffer lang={lang} onOpen={openPlus} active={hasCosmeticAccess(membership.account)} />}
      <Analytics />
      <SpeedInsights />
    </div>
    </CosmeticsProvider>
  )
}

/** Renders the correct board for /game; redirects to / if not in a game. */
function GamePage(props: Parameters<typeof GamePageContent>[0]) {
  return <Suspense fallback={<p role="status">Loading… / Cargando…</p>}><GamePageContent {...props} /></Suspense>
}

function GamePageContent({
  leagueResultExtra,
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
  leagueResultExtra?: ReactNode
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
        leagueResultExtra={leagueResultExtra}
        isConnected={isConnected} error={error} onLeave={onLeave} onAction={pochaAction} onConfigure={configurePocha}
        onStart={() => start()} onNextRound={nextRound} onRematch={rematch} /> : null
    }
    return (
      <GameBoard
        state={state}
        lobbyExtra={lobbyExtra}
        leagueResultExtra={leagueResultExtra}
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
