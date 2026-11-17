import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { Lang } from '../i18n'
import { AdminAccountsController, type GiftDuration } from '../lib/adminAccounts'
import './AdminAccounts.css'

export function AdminAccounts({ lang, onSessionExpired, onSaved, onManagePlus }: {
  lang: Lang; onSessionExpired: () => void; onSaved: () => void; onManagePlus: () => void
}) {
  const es = lang === 'es'
  const [controller] = useState(() => new AdminAccountsController({ onSessionExpired, onSaved }))
  const { data, loading, savingId, error, saved } = useSyncExternalStore(controller.subscribe, controller.getState)
  const [query, setQuery] = useState(''), [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null), [duration, setDuration] = useState<GiftDuration>('30d')
  const busy = savingId !== null
  useEffect(() => {
    const timer = window.setTimeout(() => { void controller.load(query, offset) }, query ? 300 : 0)
    return () => { window.clearTimeout(timer); controller.cancel() }
  }, [query, offset, controller])
  const date = (value: number) => new Date(value).toLocaleDateString(es ? 'es-ES' : 'en-US')
  const messages = {
    load: es ? 'No se pudo cargar la lista.' : 'The list could not be loaded.',
    save: es ? 'No se pudo confirmar el cambio. Actualiza la lista antes de volver a enviarlo.' : 'The change could not be confirmed. Refresh the list before sending it again.',
    active: es ? 'Este usuario ya tiene Plus. Usa la pestaña Plus para gestionarlo.' : 'This user already has Plus. Manage it in the Plus tab.',
    invalid: es ? 'Actualiza la lista y selecciona el usuario de nuevo.' : 'Refresh the list and select the user again.',
  }
  async function grant(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault()
    if (await controller.grant(id, duration)) setSelected(null)
  }
  return <section className="admin-accounts" aria-labelledby="admin-accounts-title">
    <div className="dashboard-section-heading"><h2 id="admin-accounts-title">{es ? 'Usuarios' : 'Users'}{data && <span>{data.filtered} / {data.total}</span>}</h2>
      <button type="button" className="dashboard-button" disabled={loading || busy} onClick={() => void controller.load(query, offset)}>{es ? 'Actualizar' : 'Refresh'}</button></div>
    <label className="admin-account-search"><span>{es ? 'Nombre o email' : 'Name or email'}</span><input type="search" maxLength={100} value={query} disabled={busy}
      placeholder={es ? 'Buscar usuario' : 'Find a user'} onChange={event => { setQuery(event.target.value); setOffset(0); setSelected(null) }} /></label>
    {saved && <p className="admin-account-success" role="status">{es ? 'Cortesía Plus guardada.' : 'Plus gift saved.'}</p>}
    {error && <p className="dashboard-error" role="alert">{messages[error]}</p>}
    {loading && <p className="admin-account-note" role="status">{es ? 'Cargando usuarios…' : 'Loading users…'}</p>}
    {data && <>
      <div className="admin-account-list">{data.accounts.map(account => <article className="admin-account" key={account.id}>
        <div className="admin-account-heading"><div><h3>{account.name || (es ? 'Sin nombre' : 'No name')}</h3><p>{account.email}</p></div>
          <span className={`admin-account-plus ${account.plus.active ? 'is-active' : ''}`}>{account.plus.active ? 'Plus' : es ? 'Gratis' : 'Free'}</span>
        </div>
        <div className="admin-account-meta"><span>{es ? 'Alta' : 'Joined'}: {date(account.createdAt)}</span>
          {account.plus.active && <span>{account.plus.source === 'gift' ? (es ? 'Cortesía' : 'Gift') : (es ? 'Compra' : 'Purchase')}{' · '}{account.plus.expiresAt === null ? (es ? 'Permanente' : 'Permanent') : `${es ? 'Hasta' : 'Until'} ${date(account.plus.expiresAt)}`}</span>}
        </div>
        <div className="admin-account-bottom"><dl className="admin-account-stats">{(['continental', 'pocha'] as const).map(game => <div key={game}>
          <dt>{game === 'continental' ? 'Conti' : 'Pocha'}</dt><dd><strong>{account.stats[game].played}</strong> {es ? 'partidas' : 'games'}<span>{account.stats[game].wins} {es ? 'victorias' : 'wins'} · {account.stats[game].winRate}%</span></dd>
        </div>)}</dl>
          {account.plus.active ? <button type="button" className="dashboard-button" onClick={onManagePlus}>{es ? 'Gestionar Plus' : 'Manage Plus'}</button>
            : <button type="button" className="dashboard-button" disabled={busy} aria-expanded={selected === account.id} onClick={() => { setSelected(selected === account.id ? null : account.id); setDuration('30d') }}>{es ? 'Dar Plus' : 'Give Plus'}</button>}
        </div>
        {selected === account.id && !account.plus.active && <form className="admin-account-gift" onSubmit={event => void grant(event, account.id)}>
          <label><span>{es ? 'Duración de la cortesía' : 'Gift duration'}</span><select value={duration} disabled={busy} onChange={event => setDuration(event.target.value as GiftDuration)}>
            <option value="30d">{es ? '30 días' : '30 days'}</option><option value="year">{es ? '1 año' : '1 year'}</option><option value="permanent">{es ? 'Permanente' : 'Permanent'}</option>
          </select></label>
          <button type="submit" className="dashboard-primary" disabled={busy}>{savingId === account.id ? (es ? 'Guardando…' : 'Saving…') : (es ? 'Guardar cortesía' : 'Save gift')}</button>
          <button type="button" className="dashboard-button" disabled={busy} onClick={() => setSelected(null)}>{es ? 'Cancelar' : 'Cancel'}</button>
        </form>}
      </article>)}</div>
      {!data.accounts.length && <p className="admin-account-note">{es ? 'No hay usuarios que coincidan.' : 'No matching users.'}</p>}
      <nav className="admin-account-pagination" aria-label={es ? 'Páginas de usuarios' : 'User pages'}>
        <span>{data.accounts.length ? `${data.offset + 1}–${Math.min(data.offset + data.accounts.length, data.filtered)} / ${data.filtered}` : `0 / ${data.filtered}`}</span>
        <button type="button" className="dashboard-button" disabled={loading || busy || data.offset === 0} onClick={() => { setOffset(Math.max(0, data.offset - data.limit)); setSelected(null) }}>{es ? 'Anterior' : 'Previous'}</button>
        <button type="button" className="dashboard-button" disabled={loading || busy || data.offset + data.limit >= data.filtered} onClick={() => { setOffset(data.offset + data.limit); setSelected(null) }}>{es ? 'Siguiente' : 'Next'}</button>
      </nav>
    </>}
  </section>
}
