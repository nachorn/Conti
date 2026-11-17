import { useState } from 'react'
import type { Lang } from '../i18n'
import type { MembershipController } from '../useMembership'
import { readPlusOffer } from '../lib/plusOffer'
import { hasCosmeticAccess } from '../lib/cosmetics'
import { CosmeticPicker } from './Cosmetics'

export function PlusPanel({ membership, lang, onSignIn, signInOpen = false }: { membership: MembershipController; lang: Lang; onSignIn?: () => void; signInOpen?: boolean }) {
  const es = lang === 'es'
  const { account, config, busy } = membership
  const [refreshing, setRefreshing] = useState(false)
  const offer = readPlusOffer(config.plus)
  const active = hasCosmeticAccess(account)
  const price = offer?.prices.find(item => item.currency === membership.currency) ?? offer?.prices[0]
  const monthlyPrice = offer?.monthlyPrices.find(item => item.currency === price?.currency)
  const format = (amount: number, currency: string) => new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { style: 'currency', currency }).format(amount / 100)
  const provider = offer?.provider === 'buymeacoffee' ? 'Buy Me a Coffee' : offer?.provider === 'stripe' ? 'Stripe' : null
  const complimentary = account?.plus?.complimentary === true
  const canManage = !!offer?.manageUrl && account?.plus?.provider === offer.provider && !complimentary
  const managementLogin = canManage && offer?.provider === 'buymeacoffee' && /^\/login\/?$/.test(new URL(offer.manageUrl!).pathname)

  return <section className="nrn-plus-panel" aria-label="NRN Plus">
    <div className={`nrn-plus-summary ${active ? 'is-active' : ''}`}>
      {active ? <div className="nrn-plus-access" role="status">
        <div className="nrn-plus-access-heading"><strong>{es ? 'Plus activo' : 'Plus active'}</strong><span className="nrn-plus-badge" aria-hidden="true">✦</span></div>
        {account?.expiresAt && <p>{es ? 'Hasta el ' : 'Until '}{new Date(account.expiresAt).toLocaleDateString(es ? 'es-ES' : 'en-US')}</p>}
        {account?.source === 'gift' && <p>{complimentary ? (es ? 'Regalo de Buy Me a Coffee. Sin cobros ni renovación automática.' : 'Gift from Buy Me a Coffee. No charges or automatic renewal.') : (es ? 'Acceso regalado por NRN Play.' : 'Access gifted by NRN Play.')}</p>}
        {!complimentary && account?.plus?.cancelAtPeriodEnd && <p>{es ? 'Renovación cancelada. Conservas el acceso hasta que termine el periodo actual.' : 'Renewal cancelled. Access lasts until the current period ends.'}</p>}
      </div> : <>
        <div className="nrn-plus-prices-heading"><h3>{es ? 'Elige tu plan' : 'Choose your plan'}</h3><span>{es ? 'Opcional' : 'Optional'}</span></div>
        <dl className={`nrn-plus-prices ${monthlyPrice ? 'has-monthly' : ''}`}>
          <div className="nrn-plus-annual"><dt>{es ? 'Anual' : 'Annual'}</dt><dd><strong>{price ? format(price.amount, price.currency) : '—'}</strong>{price && <span>{es ? '/ año' : '/ year'}</span>}</dd></div>
          {monthlyPrice && <div><dt>{es ? 'Mensual' : 'Monthly'}</dt><dd><strong>{format(monthlyPrice.amount, monthlyPrice.currency)}</strong><span>{es ? '/ mes' : '/ month'}</span></dd></div>}
        </dl>
        {offer && offer.prices.length > 1 && <fieldset className="membership-currencies" disabled={busy}><legend>{es ? 'Moneda' : 'Currency'}</legend>{offer.prices.map(item => <label key={item.currency}>
          <input type="radio" name="plus-currency" checked={price?.currency === item.currency} value={item.currency} onChange={() => membership.selectCurrency(item.currency)} />
          <span>{item.currency === 'eur' ? '€ EUR' : '$ USD'}</span>
        </label>)}</fieldset>}
      </>}

      <ul className="nrn-plus-benefits">
        <li>{es ? 'Mesas y reversos para Conti y Pocha.' : 'Table styles and card backs for Conti and Pocha.'}</li>
        <li>{es ? 'Una cuenta Plus quita los anuncios de toda la mesa.' : 'One Plus account removes ads for the whole table.'}</li>
      </ul>
      {config.ads.provider === 'disabled' && <p className="nrn-plus-note nrn-plus-ads-status">{es ? 'Los anuncios de partida están desactivados actualmente.' : 'Game ads are currently disabled.'}</p>}

      {!active && <>
        {offer?.requiresMatchingEmail && account && <p className="nrn-plus-email">{es ? 'Compra con el mismo email:' : 'Use the same email to purchase:'} <strong>{account.email}</strong></p>}
        {!account ? <>
          {onSignIn ? <button type="button" className="membership-primary nrn-plus-purchase" disabled={busy} onClick={onSignIn} aria-controls="membership-plus-sign-in" aria-expanded={signInOpen}>{es ? 'Entrar o crear cuenta' : 'Sign in or create account'}</button>
            : <p className="nrn-plus-note">{es ? 'Entra en NRN Play para vincular Plus.' : 'Sign in to NRN Play to link Plus.'}</p>}
        </> : offer?.purchaseEnabled && price ? <button type="button" className="membership-primary nrn-plus-purchase" disabled={busy} onClick={() => void membership.plusCheckout(price.currency)}>{busy ? (es ? 'Un momento…' : 'One moment…') : es ? `Continuar en ${provider}` : `Continue on ${provider}`}</button> : null}
        {offer?.purchaseEnabled && price && <p className="nrn-plus-note nrn-plus-billing-note">{monthlyPrice ? (es ? `Elige anual o mensual y confirma el cobro en ${provider}.` : `Choose annual or monthly and confirm billing on ${provider}.`) : (es ? `Confirma el importe y la renovación anual en ${provider}.` : `Confirm the amount and annual renewal on ${provider}.`)}</p>}
        {price?.currency === 'usd' && offer?.provider === 'buymeacoffee' && <p className="nrn-plus-note nrn-plus-billing-note">{es ? 'Precio base en USD. Revisa el importe final en tu moneda antes de pagar.' : 'Base price in USD. Check the final amount in your currency before paying.'}</p>}
        {!offer?.purchaseEnabled && <p className="membership-notice nrn-plus-billing-note" role="status">{es ? 'La compra de Plus aún no está disponible.' : 'Plus purchases are not available yet.'}</p>}
        {!price && <p className="nrn-plus-note">{es ? 'El precio aparecerá aquí cuando esté confirmado.' : 'The price will appear here once confirmed.'}</p>}
      </>}
    </div>

    <details className="nrn-plus-details nrn-plus-styles">
      <summary>{es ? 'Elegir mesa y cartas' : 'Choose table and cards'}</summary>
      <CosmeticPicker />
    </details>

    <details className="nrn-plus-details">
      <summary>{es ? 'Pago y acceso' : 'Payment and access'}</summary>
      <div className="nrn-plus-detail-content">
        <p>{complimentary ? (es ? 'Este regalo no tiene cobros ni renovación automática.' : 'This gift has no charges or automatic renewal.') : provider ? (es ? `El pago y la renovación se gestionan en ${provider}. El acceso se activa al verificar la membresía.` : `Payment and renewal are managed on ${provider}. Access starts when the membership is verified.`) : (es ? 'El acceso se activa al verificar la membresía.' : 'Access starts when the membership is verified.')}</p>
        {offer?.requiresMatchingEmail && <p>{es ? 'Usa el email de tu cuenta NRN Play en Buy Me a Coffee para vincular el acceso.' : 'Use your NRN Play account email on Buy Me a Coffee to link access.'}</p>}
        {canManage && <a className="nrn-plus-manage" href={offer!.manageUrl!} target="_blank" rel="noopener noreferrer">{es ? `Gestionar o cancelar en ${provider}` : `Manage or cancel on ${provider}`} ↗</a>}
        {managementLogin && <p>{es ? 'Entra con el email de tu membresía y abre My Account → Payments → Memberships → NRN Plus.' : 'Sign in with your membership email and open My Account → Payments → Memberships → NRN Plus.'}</p>}
        <p>{es ? 'Jugar sigue siendo gratis. Plus también ayuda a mantener NRN Play.' : 'Playing stays free. Plus also helps maintain NRN Play.'}</p>
      </div>
    </details>

    {account && <button type="button" className="membership-text nrn-plus-refresh" disabled={busy || refreshing} onClick={async () => {
      setRefreshing(true)
      try { await membership.refresh() } finally { setRefreshing(false) }
    }}>{refreshing ? (es ? 'Actualizando acceso…' : 'Refreshing access…') : (es ? 'Actualizar acceso' : 'Refresh access')}</button>}

    <details className="nrn-plus-details nrn-plus-donation">
      <summary>{es ? 'Aportación puntual' : 'One-time contribution'}</summary>
      <div className="nrn-plus-detail-content"><p>{es ? 'Las aportaciones puntuales no activan Plus.' : 'One-time contributions do not activate Plus.'} <a href="https://buymeacoffee.com/nrnplay" target="_blank" rel="noopener noreferrer">{es ? 'Aportar en Buy Me a Coffee' : 'Contribute on Buy Me a Coffee'} ↗</a></p></div>
    </details>
  </section>
}
