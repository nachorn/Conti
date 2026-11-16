import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Lang } from '../i18n'
import { adminFetch } from '../lib/adminApi'
import { confirmedGiveawayImport, giveawayImportCommand, plusRevokeCommand, readAdminPlus, type AdminPlusSnapshot, type AdminPlusSubscription } from '../lib/adminPlus'
import './PlusAdmin.css'

export function PlusAdmin({ lang, onSessionExpired }: { lang: Lang; onSessionExpired: () => void }) {
  const es = lang === 'es'
  const [snapshot, setSnapshot] = useState<AdminPlusSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [status, setStatus] = useState<'error' | 'unconfigured' | 'success' | 'not-found' | ''>('')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<AdminPlusSubscription | null>(null)
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [providerRequest, setProviderRequest] = useState('')
  const [importStatus, setImportStatus] = useState<'invalid' | 'revoked' | 'error' | 'success' | 'already' | ''>('')
  const [importedId, setImportedId] = useState('')
  const mounted = useRef(false)
  const mutation = useRef<AbortController | null>(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; mutation.current?.abort() }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setTarget(null); setReason(''); setConfirmation('')
    adminFetch('/api/admin/plus/subscriptions', { signal: controller.signal }).then(async response => {
      if (controller.signal.aborted) return
      if (response.status === 401) { onSessionExpired(); return }
      if (response.status === 404) { setStatus('unconfigured'); return }
      const data: unknown = await response.json()
      if (controller.signal.aborted) return
      const parsed = readAdminPlus(data)
      if (!response.ok || !parsed) throw new Error('Unavailable subscriptions')
      setSnapshot(parsed)
      setStatus(current => current === 'success' ? current : '')
    }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [revision, onSessionExpired])
  function selectTarget(subscription: AdminPlusSubscription | null) {
    setTarget(subscription); setReason(''); setConfirmation(''); setStatus('')
  }
  async function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!target || mutation.current) return
    const command = plusRevokeCommand(target, confirmation, reason)
    if (!command) return
    const controller = new AbortController()
    mutation.current = controller
    setBusy(true); setStatus('')
    try {
      const response = await adminFetch('/api/admin/plus/revoke', { method: 'POST', signal: controller.signal, body: JSON.stringify(command) })
      if (!mounted.current || controller.signal.aborted) return
      if (response.status === 401) { onSessionExpired(); return }
      if (response.status === 404) { setStatus('not-found'); return }
      const data: unknown = await response.json()
      if (!response.ok || !data || typeof data !== 'object' || !('ok' in data) || data.ok !== true) throw new Error('Unconfirmed revocation')
      setSnapshot(current => current ? { ...current, subscriptions: current.subscriptions.map(item => item.id === command.subscriptionId ? { ...item, eligible: false, revokedAt: Date.now() } : item) } : current)
      setTarget(null); setConfirmation(''); setReason(''); setStatus('success'); setRevision(value => value + 1)
    } catch { if (mounted.current && !controller.signal.aborted) setStatus('error') }
    finally { mutation.current = null; if (mounted.current) setBusy(false) }
  }
  async function recoverInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mutation.current) return
    const raw = new FormData(event.currentTarget).get('bmcRequest')
    const command = typeof raw === 'string' ? giveawayImportCommand(raw) : null
    if (!command) { setImportStatus('invalid'); return }
    const controller = new AbortController()
    mutation.current = controller
    setBusy(true); setStatus(''); setImportStatus(''); setImportedId('')
    try {
      const response = await adminFetch('/api/admin/plus/giveaways/import', { method: 'POST', signal: controller.signal, body: JSON.stringify(command) })
      if (!mounted.current || controller.signal.aborted) return
      if (response.status === 401) { onSessionExpired(); return }
      if (response.status === 400 || response.status === 409) { setImportStatus(response.status === 409 ? 'revoked' : 'invalid'); return }
      const result = confirmedGiveawayImport(await response.json())
      if (!response.ok || !result) throw new Error('Unconfirmed invitation recovery')
      setProviderRequest(''); setImportedId(result.subscriptionId); setImportStatus(result.imported ? 'success' : 'already')
      setRevision(value => value + 1)
    } catch { if (mounted.current && !controller.signal.aborted) setImportStatus('error') }
    finally { mutation.current = null; if (mounted.current) setBusy(false) }
  }
  const commandReady = target && plusRevokeCommand(target, confirmation, reason)
  const needle = search.trim().toLowerCase()
  const matches = snapshot?.subscriptions.filter(item => !needle || item.email.toLowerCase().includes(needle) || item.id.includes(needle)) ?? []
  const date = (value: number) => new Date(value).toLocaleString(es ? 'es-ES' : 'en-US')
  const reasonLabel = (value: string | null) => value === 'refund' ? (es ? 'Reembolso' : 'Refund') : value === 'dispute' ? (es ? 'Disputa de pago' : 'Payment dispute') : value === 'provider_correction' ? (es ? 'Corrección del proveedor' : 'Provider correction') : value === 'provider_delivery_recovery' ? (es ? 'Recuperación de invitación ya enviada' : 'Recovery of an existing invitation') : ''
  const statusLabel = (item: AdminPlusSubscription) => item.revokedAt !== null ? (es ? 'Retirada' : 'Revoked')
    : !item.eligible ? (es ? 'No habilitada' : 'Ineligible') : item.expiresAt <= Date.now() ? (es ? 'Caducada' : 'Expired')
      : item.cancelAtPeriodEnd ? (es ? 'Renovación cancelada' : 'Renewal cancelled') : (es ? 'Activa' : 'Active')
  return <section className="plus-admin" aria-labelledby="plus-admin-title">
    <div className="plus-admin-heading"><div><h2 id="plus-admin-title">NRN Plus · Buy Me a Coffee</h2><p>{es ? 'Membresías y cortesías, con historial de recuperación y retirada de acceso.' : 'Memberships and complimentary access, with recovery and revocation history.'}</p></div><button className="dashboard-button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}>{es ? 'Actualizar' : 'Refresh'}</button></div>
    <p className="plus-admin-note">{es ? 'Cancelar o reembolsar el pago se hace por separado en Buy Me a Coffee. Este panel solo retira el acceso NRN Plus de la suscripción elegida y conserva el historial.' : 'Cancel or refund the payment separately in Buy Me a Coffee. This panel only revokes NRN Plus access for the selected subscription and keeps its history.'}</p>
    {loading && <p role="status">{es ? 'Cargando membresías…' : 'Loading memberships…'}</p>}
    {status && <p className="dashboard-error" role={status === 'success' ? 'status' : 'alert'}>{status === 'success' ? (es ? 'Acceso de la suscripción retirado.' : 'Subscription access revoked.') : status === 'unconfigured' ? (es ? 'La gestión de Plus aún no está disponible en este servidor.' : 'Plus management is not yet available on this server.') : status === 'not-found' ? (es ? 'La suscripción ya no está disponible. Actualiza la lista antes de continuar.' : 'The subscription is no longer available. Refresh the list before continuing.') : (es ? 'No se pudo confirmar la operación. Actualiza antes de reintentarlo; los datos mostrados pueden estar desactualizados.' : 'The operation could not be confirmed. Refresh before retrying; the displayed data may be out of date.')}</p>}
    <details className="plus-admin-import" onToggle={event => { if (!event.currentTarget.open && !busy) { setProviderRequest(''); setImportStatus(''); setImportedId('') } }}>
      <summary>{es ? 'Recuperar invitación de Buy Me a Coffee' : 'Recover a Buy Me a Coffee invitation'}</summary>
      <p>{es ? 'Comprueba en Buy Me a Coffee que la invitación ya enviada sigue activa. Pega abajo el JSON de «Request» de su entrega real. Recuperaremos esa misma invitación con su ID y fecha originales, sin enviar otro email ni crear una compra. No pegues contraseñas, tarjetas ni claves de acceso.' : 'Check in Buy Me a Coffee that the existing invitation is still active. Paste the JSON “Request” from its real delivery below. We will recover that same invitation with its original ID and expiry, without sending another email or creating a purchase. Do not paste passwords, card details or access keys.'}</p>
      <form onSubmit={recoverInvitation} method="post" action="/api/admin/plus/giveaways/import">
        <label><span>{es ? 'Request JSON de la invitación existente' : 'Existing invitation Request JSON'}</span><textarea name="bmcRequest" rows={8} maxLength={262_144} required autoComplete="off" spellCheck={false} value={providerRequest} disabled={busy} onChange={event => { setProviderRequest(event.target.value); setImportStatus('') }} /></label>
        <button className="dashboard-button" disabled={busy}>{busy ? (es ? 'Comprobando…' : 'Checking…') : (es ? 'Recuperar invitación' : 'Recover invitation')}</button>
      </form>
      {importStatus && <p className="dashboard-error" role={importStatus === 'success' || importStatus === 'already' ? 'status' : 'alert'}>{importStatus === 'success' ? (es ? 'Invitación recuperada.' : 'Invitation recovered.') : importStatus === 'already' ? (es ? 'Esta invitación ya estaba sincronizada.' : 'This invitation was already synced.') : importStatus === 'revoked' ? (es ? 'Esta invitación fue retirada y no puede recuperarse con este ID.' : 'This invitation was revoked and cannot be recovered with this ID.') : importStatus === 'invalid' ? (es ? 'No se ha recuperado la invitación. Pega un Request JSON válido de una invitación activa del nivel NRN Plus.' : 'The invitation was not recovered. Paste a valid Request JSON for an active NRN Plus invitation.') : (es ? 'No se pudo confirmar la recuperación. Actualiza la lista antes de reintentarlo.' : 'Recovery could not be confirmed. Refresh the list before retrying.')}{importedId && ` · ${importedId}`}</p>}
    </details>
    {snapshot && <>
      <label className="plus-admin-search"><span>{es ? 'Buscar email o ID de suscripción' : 'Find email or subscription ID'}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <p className="plus-admin-note">{matches.length} {es ? 'suscripciones' : 'subscriptions'}{matches.length > 100 ? (es ? ' · Se muestran las primeras 100. Filtra para encontrar una concreta.' : ' · Showing the first 100. Search to find a specific one.') : ''}</p>
      <ul className="plus-admin-list">{matches.slice(0, 100).map(item => <li key={item.id}><div><strong>{item.email}</strong><span>#{item.id} · {item.interval === 'giveaway' ? (es ? 'Cortesía de Buy Me a Coffee' : 'Buy Me a Coffee courtesy') : item.interval === 'year' ? (es ? 'Anual' : 'Annual') : (es ? 'Mensual' : 'Monthly')} · {statusLabel(item)}</span><span>{es ? 'Acceso hasta' : 'Access until'}: {date(item.expiresAt)}{!item.accountId && ` · ${es ? 'Pendiente de vincular cuenta' : 'Account linking pending'}`}</span></div>{item.revokedAt === null && <button type="button" className="dashboard-button" disabled={busy || loading} onClick={() => selectTarget(item)} aria-label={`${es ? 'Revisar retirada' : 'Review revocation'}: ${item.id}`}>{es ? 'Revisar retirada' : 'Review revocation'}</button>}</li>)}</ul>
      {!matches.length && <p>{es ? 'No hay suscripciones que mostrar.' : 'No subscriptions to show.'}</p>}
      {target && <form className="plus-admin-confirm" onSubmit={revoke} aria-labelledby="plus-admin-confirm-title">
        <h3 id="plus-admin-confirm-title">{es ? 'Retirar acceso de forma permanente' : 'Permanently revoke access'} · #{target.id}</h3>
        <p><strong>{target.email}</strong></p>
        <p id="plus-admin-warning">{es ? 'Esta retirada no se puede deshacer para este ID. Afecta solo a esta suscripción; no cancela ni reembolsa el pago en Buy Me a Coffee y no borra compras ni cortesías independientes.' : 'This revocation cannot be undone for this ID. It affects only this subscription; it does not cancel or refund the Buy Me a Coffee payment and does not remove separate purchases or gifts.'}</p>
        <label><span>{es ? 'Motivo' : 'Reason'}</span><select required value={reason} disabled={busy} onChange={event => setReason(event.target.value)}><option value="">{es ? 'Selecciona un motivo' : 'Select a reason'}</option><option value="refund">{reasonLabel('refund')}</option><option value="dispute">{reasonLabel('dispute')}</option><option value="provider_correction">{reasonLabel('provider_correction')}</option></select></label>
        <label><span>{es ? `Escribe ${target.id} para confirmar` : `Type ${target.id} to confirm`}</span><input type="text" inputMode={target.interval === 'giveaway' ? 'text' : 'numeric'} autoComplete="off" value={confirmation} maxLength={25} required disabled={busy} aria-describedby="plus-admin-warning" onChange={event => setConfirmation(event.target.value)} /></label>
        <div className="plus-admin-actions"><button type="submit" className="dashboard-button plus-admin-revoke" disabled={busy || !commandReady}>{busy ? (es ? 'Confirmando…' : 'Confirming…') : (es ? `Retirar acceso de #${target.id}` : `Revoke #${target.id} access`)}</button><button type="button" className="dashboard-button" disabled={busy} onClick={() => selectTarget(null)}>{es ? 'Cancelar' : 'Cancel'}</button></div>
      </form>}
      {!!snapshot.audit.length && <details className="plus-admin-audit"><summary>{es ? 'Actividad reciente de Plus' : 'Recent Plus activity'}</summary><ul>{[...snapshot.audit].reverse().slice(0, 20).map(item => <li key={item.id}><time dateTime={new Date(item.at).toISOString()}>{date(item.at)}</time> · {item.kind === 'owner_import' ? (es ? 'Invitación recuperada por propietario' : 'Invitation recovered by owner') : item.kind === 'owner_revoke' ? (es ? 'Retirada del propietario' : 'Owner revocation') : item.kind === 'webhook_test' ? (es ? 'Prueba firmada del proveedor' : 'Signed provider test') : (es ? 'Actualización del proveedor' : 'Provider update')}{item.subscriptionId && ` · #${item.subscriptionId}`}{item.reason && ` · ${reasonLabel(item.reason)}`}</li>)}</ul></details>}
    </>}
  </section>
}
