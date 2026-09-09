import { useEffect, useRef, useState, type RefObject } from 'react'
import type { GameState, PublicAction } from '../types'
import type { Lang } from '../i18n'
import { collectActions, actionDisplayTime, type ActionCursor } from '../lib/actionPlayback'
import { actionSummary, meldSummary } from '../lib/tableSummary'
import { orderMeldCardsForDisplay } from '../lib/meldTargeting'
import { cardLabel } from '../lib/cardActivity'
import { Card } from './Card'
import './ActionPopup.css'

export function ActionPopup({ state, lang, connected, boardRef }: { state: GameState; lang: Lang; connected: boolean; boardRef: RefObject<HTMLDivElement> }) {
  const cursor = useRef<ActionCursor | null>(null)
  const [queue, setQueue] = useState<PublicAction[]>([])
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [pageHidden, setPageHidden] = useState(() => document.hidden)
  const [placement, setPlacement] = useState({ top: 100, height: 240 })
  const action = queue[0]
  const es = lang === 'es'

  useEffect(() => {
    const update = () => setPageHidden(document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])

  useEffect(() => {
    const incoming = collectActions(cursor.current, state, connected)
    cursor.current = incoming.cursor
    if (incoming.reset) {
      setQueue([])
      setPaused(false)
    } else if (incoming.actions.length) setQueue(current => [...current, ...incoming.actions])
  }, [state, connected])

  useEffect(() => {
    if (!action || paused || hovered || pageHidden || placement.height < 44) return
    const timer = setTimeout(() => setQueue(current => current.slice(1)), actionDisplayTime(action))
    return () => clearTimeout(timer)
  }, [action, paused, hovered, pageHidden, placement.height])

  // Stay inside the table area so popups never cover hand or turn controls.
  useEffect(() => {
    const table = boardRef.current?.querySelector('.game-table-scroll')
    const position = () => {
      const rect = table?.getBoundingClientRect()
      setPlacement(rect ? { top: rect.top + 6, height: Math.max(0, rect.height - 12) }
        : { top: 12, height: Math.min(300, window.innerHeight * .45) })
    }
    position()
    const observer = new ResizeObserver(position)
    if (table) observer.observe(table)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [boardRef, state.phase])

  if (!action || placement.height < 44) return null
  const compact = placement.height < 145
  const changedIds = new Set(action.cards.map(card => card.id))
  return <aside className={`action-popup ${compact ? 'action-popup-short' : ''}`}
    style={{ top: placement.top, maxHeight: Math.min(300, placement.height) }} aria-label={es ? 'Jugada en curso' : 'Action playback'}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
    <div className="action-popup-controls">
      <span>{queue.length > 1 ? (es ? `${queue.length - 1} en cola` : `${queue.length - 1} queued`) : (es ? 'Última jugada' : 'Latest play')}</span>
      <button type="button" aria-pressed={paused} onClick={() => { setPaused(value => !value); setHovered(false) }}>{paused ? (es ? 'Continuar' : 'Play') : (es ? 'Pausar' : 'Pause')}</button>
      <button type="button" onClick={() => setQueue(current => current.slice(1))}>{es ? 'Siguiente' : 'Next'}</button>
      <button type="button" aria-label={es ? 'Cerrar jugadas' : 'Dismiss action popups'} onClick={() => { setQueue([]); setPaused(false); setHovered(false) }}>×</button>
    </div>
    <p className="action-popup-summary" role="status" aria-live="polite" aria-atomic="true">{actionSummary(compact ? action : { ...action, melds: undefined }, lang)}</p>
    {!compact && <div className="action-popup-detail">
      {action.cards.length > 0 && <div className="action-popup-cards" aria-label={es ? 'Cartas jugadas' : 'Played cards'}>
        {action.cards.map(card => <span key={card.id} aria-label={cardLabel(card, lang)}><Card card={card} size="small" /></span>)}
        {action.penaltyCount > 0 && <span className="action-popup-private">+1<br />{es ? 'penalización' : 'penalty'}</span>}
      </div>}
      {action.kind === 'stock' && <p className="action-popup-private">{es ? '1 carta privada del mazo' : '1 private card from stock'}</p>}
      {action.melds?.map(meld => <div key={meld.id} className="action-popup-meld">
        <strong>{action.kind === 'meld' ? (es ? 'Nueva bajada' : 'New meld') : (es ? 'Bajada de destino' : 'Destination meld')}{action.targetName ? ` · ${action.targetName}` : ''} · {meld.type === 'trio' ? (es ? 'Trío' : 'Trio') : (es ? 'Escalera' : 'Straight')}</strong>
        <div className="action-popup-cards" aria-label={meldSummary(meld, lang)}>
          {orderMeldCardsForDisplay(meld).map(card => <span key={card.id} className={changedIds.has(card.id) ? 'action-popup-added' : ''} aria-label={`${cardLabel(card, lang)}${changedIds.has(card.id) ? (es ? ', añadida' : ', added') : ''}`}><Card card={card} size="small" /></span>)}
        </div>
      </div>)}
    </div>}
  </aside>
}
