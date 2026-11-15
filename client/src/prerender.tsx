import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import { Home } from './components/Home'
import { SiteHeader } from './components/SiteHeader'
import { Lobby } from './components/Lobby'
import { GAME_ORIGINS, gameSubdomainsEnabled } from './lib/platform'

export function publicGameUrl(path: '/conti' | '/pocha') {
  return gameSubdomainsEnabled ? `${GAME_ORIGINS[path === '/conti' ? 'conti' : 'pocha']}/` : `https://nrnplay.com${path}`
}

/** Serve the same public pages to crawlers and visitors before React loads. */
export function renderPublicPage(path: '/' | '/conti' | '/pocha' = '/') {
  const noop = () => {}
  return renderToStaticMarkup(<StaticRouter location={path}>
    <div className="nrn-platform">
      <SiteHeader lang="en" setLang={noop} onOpenAccount={noop} />
      {path === '/' ? <Home lang="en" onOpenAccount={noop} /> : <Lobby
        gameType={path === '/pocha' ? 'pocha' : 'continental'}
        lang="en" setLang={noop} error={null} isConnected={false}
        onCreateContinental={noop} onCreatePocha={noop} onJoin={noop} />}
    </div>
  </StaticRouter>)
}
