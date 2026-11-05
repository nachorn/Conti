import { renderToStaticMarkup } from 'react-dom/server'
import { Lobby } from './components/Lobby'
import { SavedGames } from './components/SavedGames'

/** Render the real public lobby at build time; no socket, account or room state. */
export function renderPublicLobby() {
  const noop = () => {}
  return renderToStaticMarkup(<Lobby lang="en" setLang={noop} error={null} isConnected={false}
    onCreateContinental={noop} onCreatePocha={noop} onJoin={noop}
    savedGames={<SavedGames games={[]} lang="en" connected={false} resume={noop} forget={noop} />} />)
}
