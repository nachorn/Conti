import { useEffect, useState, type FormEvent } from 'react'
import type { MembershipGrant } from '@shared/membership'
import type { Lang } from '../i18n'
import './MemberAccess.css'

const SERVER = (import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')).replace(/\/+$/, '')
export function MemberAccess({ accessKey, lang }: { accessKey: string; lang: Lang }) {
  const L = (es: string, en: string) => lang === 'es' ? es : en
  const [grants, setGrants] = useState<MembershipGrant[]>([])
  const [email, setEmail] = useState('')
  const [until, setUntil] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState('')
  const [configured, setConfigured] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`${SERVER}/api/admin/memberships`, { headers: { Authorization: `Bearer ${accessKey}` }, cache: 'no-store', signal: controller.signal }).then(async response => {
      if (response.status === 404) { setConfigured(false); setStatus('unconfigured'); return }
      const data = await response.json() as { grants?: MembershipGrant[]; error?: string }
      if (controller.signal.aborted) return
      if (!response.ok) { setStatus(data.error === 'membership_not_configured' ? 'unconfigured' : response.status === 401 ? 'unauthorized' : 'error'); return }
      setGrants(data.grants ?? []); setConfigured(true); setStatus(current => current === 'success' ? current : '')
    }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [accessKey, revision])
  async function update(action: 'grant' | 'revoke', target: string, expiresAt: number | null = null) {
    if (busy) return
    setBusy(true); setStatus('')
    try {
      const response = await fetch(`${SERVER}/api/admin/memberships/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${accessKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'grant' ? { email: target, expiresAt } : { email: target }) })
      if (!response.ok) { setStatus(response.status === 401 ? 'unauthorized' : response.status === 400 ? 'invalid' : 'error'); return }
      setStatus('success'); setRevision(value => value + 1)
      if (action === 'grant') { setEmail(''); setUntil('') }
    } catch { setStatus('error') } finally { setBusy(false) }
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    const expiry = until ? new Date(`${until}T23:59:59`).getTime() : null
    if (expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now())) { setStatus('invalid'); return }
    void update('grant', email.trim(), expiry)
  }
  const messages: Record<string, string> = {
    unconfigured: L('Los accesos estarán disponibles aquí cuando se activen las cuentas.', 'Access management will be available here once accounts are enabled.'),
    unauthorized: L('Vuelve a abrir el panel privado para gestionar los accesos.', 'Unlock the owner dashboard again to manage access.'),
    error: L('No se pudo actualizar el acceso. Inténtalo de nuevo.', 'Could not update access. Please try again.'),
    invalid: L('Introduce un email válido y una fecha futura, o deja la fecha vacía.', 'Enter a valid email and a future date, or leave the date empty.'),
    success: L('Acceso actualizado.', 'Access updated.'),
  }
  return <section className="member-access" aria-labelledby="member-access-title">
    <div className="member-access-heading"><div><h2 id="member-access-title">{L('Accesos de cortesía', 'Complimentary access')}</h2><p>{L('Concede partidas sin anuncios por email. Cuando esa persona inicie sesión, toda su mesa se beneficiará.', 'Give someone ad-free games by email. When they sign in, everyone at their table benefits.')}</p></div><button className="dashboard-button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{L('Actualizar', 'Refresh')}</button></div>
    {status && <p className="member-access-notice" role={status === 'success' ? 'status' : 'alert'}>{messages[status]}</p>}
    <form className="member-access-form" onSubmit={submit}>
      <label><span>{L('Correo electrónico', 'Email address')}</span><input type="email" autoComplete="email" maxLength={254} required value={email} onChange={event => setEmail(event.target.value)} disabled={!configured || busy} /></label>
      <label><span>{L('Acceso hasta', 'Access until')}</span><input type="date" value={until} onChange={event => setUntil(event.target.value)} aria-describedby="member-access-expiry" disabled={!configured || busy} /></label>
      <button className="dashboard-primary" disabled={!configured || busy || !email.trim()}>{busy ? L('Guardando…', 'Saving…') : L('Conceder acceso', 'Give access')}</button>
    </form>
    <p id="member-access-expiry" className="member-access-hint">{L('Deja la fecha vacía para conceder acceso permanente.', 'Leave the date empty for permanent access.')}</p>
    {grants.length > 0 && <label className="member-access-search"><span>{L('Buscar email', 'Find an email')}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>}
    <ul className="member-access-list">{grants.filter(g => g.email.includes(search.trim().toLowerCase())).map(grant => {
      const active = grant.active && (grant.expiresAt === null || grant.expiresAt > Date.now())
      const label = !grant.active ? L('Retirado', 'Revoked') : !active ? L('Caducado', 'Expired') : grant.expiresAt === null ? L('Permanente', 'Permanent') : new Date(grant.expiresAt).toLocaleDateString(lang)
      return <li key={grant.email}><div><strong>{grant.email}</strong><span>{label}</span></div>{active && <button className="dashboard-button" disabled={busy} onClick={() => void update('revoke', grant.email)} aria-label={`${L('Retirar cortesía', 'Revoke gift')}: ${grant.email}`}>{L('Retirar cortesía', 'Revoke gift')}</button>}</li>
    })}</ul>
    <p className="member-access-hint">{L('La persona debe verificar este email para usar el acceso. No se envía ningún correo al concederlo. Retirar una cortesía no elimina una compra pagada.', 'Recipients must verify this email to use the gift. No email is sent when you grant access. Revoking a gift does not remove a paid purchase.')}</p>
  </section>
}
