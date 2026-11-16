import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { MembershipAccount } from '@shared/membership'
import type { Lang } from '../i18n'
import { DEFAULT_COSMETICS, effectiveCosmetics, hasCosmeticAccess, readCosmetics, saveCosmetics, type CosmeticSelection } from '../lib/cosmetics'
import { CardBackArtwork } from './cards/CardBackArtwork'
import './Cosmetics.css'

type Controller = { selection: CosmeticSelection; active: boolean; storageAvailable: boolean; setSelection: (next: CosmeticSelection) => void; lang: Lang }
const CosmeticContext = createContext<Controller>({ selection: { ...DEFAULT_COSMETICS }, active: false, storageAvailable: true, setSelection: () => {}, lang: 'en' })
const storage = () => { try { return window.localStorage } catch { return null } }

export function CosmeticsProvider({ account, lang, children }: { account: MembershipAccount | null; lang: Lang; children: ReactNode }) {
  const owner = account?.id ?? null
  const [saved, setSaved] = useState(() => ({ owner, selection: readCosmetics(storage(), owner) }))
  const [storageAvailable, setStorageAvailable] = useState(true)
  const [expiryTick, tick] = useState(0)
  useEffect(() => { setSaved({ owner, selection: readCosmetics(storage(), owner) }); setStorageAvailable(true) }, [owner])
  useEffect(() => {
    if (!account?.expiresAt) return
    const remaining = account.expiresAt - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => tick(value => value + 1), Math.min(remaining + 10, 2_147_000_000))
    return () => window.clearTimeout(timer)
  }, [account?.expiresAt, expiryTick])
  const selected = saved.owner === owner ? saved.selection : { ...DEFAULT_COSMETICS }
  const selection = effectiveCosmetics(selected, account)
  const active = hasCosmeticAccess(account)
  const setSelection = (next: CosmeticSelection) => {
    if (!owner || !active) return
    const value = effectiveCosmetics(next, account)
    setSaved({ owner, selection: value })
    setStorageAvailable(saveCosmetics(storage(), owner, value))
  }
  return <CosmeticContext.Provider value={{ selection, active, storageAvailable, setSelection, lang }}>
    <div className="nrn-cosmetic-surface" data-nrn-table={selection.table}>{children}</div>
  </CosmeticContext.Provider>
}
export const useCosmetics = () => useContext(CosmeticContext)

export function CosmeticPicker() {
  const { selection, active, setSelection, storageAvailable, lang } = useCosmetics()
  const es = lang === 'es'
  const tables = [
    { id: 'classic', label: es ? 'Verde clásico' : 'Classic green' },
    { id: 'midnight', label: es ? 'Medianoche' : 'Midnight' },
    { id: 'wine', label: es ? 'Burdeos' : 'Burgundy' },
  ] as const
  const backs = [
    { id: 'bull', label: es ? 'Toro clásico' : 'Classic bull' },
    { id: 'linen', label: es ? 'Lino' : 'Linen' },
    { id: 'geometric', label: es ? 'Geometría' : 'Geometry' },
  ] as const
  return <section className="nrn-cosmetics" aria-labelledby="nrn-cosmetics-title">
    <h3 id="nrn-cosmetics-title">{es ? 'Tu estilo de mesa' : 'Your table style'}</h3>
    <p>{es ? 'Cambia los colores y reversos que ves en Conti y La Pocha. Son preferencias de este navegador; las reglas y las cartas de la partida no cambian.' : 'Change the colours and card backs you see in Conti and La Pocha. These are preferences for this browser; game rules and dealt cards stay the same.'}</p>
    {!active && <p>{es ? 'El estilo clásico es gratuito. Los estilos adicionales requieren acceso Plus activo.' : 'The classic style is free. Additional styles require active Plus access.'}</p>}
    <fieldset><legend>{es ? 'Mesa' : 'Table'}</legend><div className="nrn-cosmetic-options">{tables.map(option => <label key={option.id}>
      <input type="radio" name="nrn-table-style" value={option.id} checked={selection.table === option.id} disabled={!active}
        onChange={() => setSelection({ ...selection, table: option.id })} />
      <span className={`nrn-table-swatch nrn-table-swatch-${option.id}`} aria-hidden="true" /><span>{option.label}{option.id !== 'classic' && <small>Plus</small>}</span>
    </label>)}</div></fieldset>
    <fieldset><legend>{es ? 'Reverso de cartas' : 'Card back'}</legend><div className="nrn-cosmetic-options">{backs.map(option => <label key={option.id}>
      <input type="radio" name="nrn-card-back" value={option.id} checked={selection.cardBack === option.id} disabled={!active}
        onChange={() => setSelection({ ...selection, cardBack: option.id })} />
      <span aria-hidden="true"><CardBackArtwork variant={option.id} width={45} height={63} label={option.label} /></span><span>{option.label}{option.id !== 'bull' && <small>Plus</small>}</span>
    </label>)}</div></fieldset>
    <button type="button" className="membership-text" disabled={!active || (selection.table === 'classic' && selection.cardBack === 'bull')}
      onClick={() => setSelection({ ...DEFAULT_COSMETICS })}>{es ? 'Restaurar estilo clásico' : 'Restore classic style'}</button>
    {!storageAvailable && <p role="status">{es ? 'Tu selección funciona ahora, pero este navegador no permite recordarla.' : 'Your selection works now, but this browser cannot remember it.'}</p>}
  </section>
}
