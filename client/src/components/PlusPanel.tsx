import { useState } from 'react'
import type { Lang } from '../i18n'
import type { MembershipController } from '../useMembership'
import { readPlusOffer } from '../lib/plusOffer'
import { hasCosmeticAccess } from '../lib/cosmetics'
import { CosmeticPicker } from './Cosmetics'

export function PlusPanel({ membership, lang }: { membership: MembershipController; lang: Lang }) {
  const es = lang === 'es'
  const { account, config, busy } = membership
  const [refreshing, setRefreshing] = useState(false)
  const offer = readPlusOffer(config.plus)
  const active = hasCosmeticAccess(account)
  const price = offer?.prices.find(item => item.currency === membership.currency) ?? offer?.prices[0]
  const monthlyPrice = offer?.monthlyPrices.find(item => item.currency === price?.currency)
  const format = (amount: number, currency: string) => new Intl.NumberFormat(es ? 'es-ES' : 'en-US', { style: 'currency', currency }).format(amount / 100)
  const provider = offer?.provider === 'buymeacoffee' ? 'Buy Me a Coffee' : 'Stripe'
  const canManage = !!offer?.manageUrl && account?.plus?.provider === offer.provider
  const managementLogin = canManage && offer?.provider === 'buymeacoffee' && /^\/login\/?$/.test(new URL(offer.manageUrl!).pathname)
  return <section className="nrn-plus-panel" aria-labelledby="nrn-plus-title">
    <div className="nrn-plus-heading"><span className="nrn-plus-symbol" aria-hidden="true">✦</span><div><h3 id="nrn-plus-title">NRN Plus</h3><p>{es ? 'Tu estilo. Una mesa sin anuncios.' : 'Your style. An ad-free table.'}</p></div>
      {active && <span className="nrn-plus-badge">{es ? 'Activo' : 'Active'}</span>}</div>
    <p>{es ? 'Jugar sigue siendo gratis. Plus es opcional y los invitados de tu mesa no necesitan comprarlo.' : 'Playing stays free. Plus is optional and guests at your table do not need to buy it.'}</p>
    <ul className="nrn-plus-benefits">
      <li>{es ? 'Un miembro con acceso activo cubre los anuncios de toda su mesa de Conti o La Pocha.' : 'One member with active access covers ads for their whole Conti or La Pocha table.'}</li>
      <li>{es ? 'Mesas Medianoche y Burdeos, y reversos Lino y Geometría para tu navegador.' : 'Midnight and Burgundy tables, plus Linen and Geometry card backs for your browser.'}</li>
      <li>{es ? 'Apoyo al mantenimiento y desarrollo de NRN Play.' : 'Support for maintaining and developing NRN Play.'}</li>
    </ul>
    {config.ads.provider === 'disabled' && <p className="nrn-plus-note">{es ? 'Actualmente no hay anuncios de partida activos. Los estilos de Conti y La Pocha ya están disponibles con acceso Plus.' : 'Game advertising is currently inactive. Conti and La Pocha styles are available with Plus access.'}</p>}
    {active ? <div className="nrn-plus-access" role="status">
      <strong>{es ? 'Tu acceso Plus está activo' : 'Your Plus access is active'}</strong>
      {account?.source === 'gift' && <p>{es ? 'Acceso de cortesía del propietario.' : 'Complimentary access from the owner.'}</p>}
      {account?.expiresAt && <p>{es ? 'Disponible hasta ' : 'Available until '}{new Date(account.expiresAt).toLocaleDateString(es ? 'es-ES' : 'en-US')}</p>}
      {account?.plus?.cancelAtPeriodEnd && <p>{es ? 'La renovación está cancelada. Conservas el acceso hasta el final del periodo actual de membresía.' : 'Renewal is cancelled. Your access remains available until the current membership period ends.'}</p>}
    </div> : <div className="nrn-plus-offer">
      <div className="nrn-plus-price"><strong>{price ? format(price.amount, price.currency) : es ? 'Plan anual' : 'Annual plan'}</strong>{price && <span>{es ? '/ año' : '/ year'}</span>}</div>
      {!price && <p className="nrn-plus-note">{es ? 'Estamos preparando el acceso anual. El precio y la moneda confirmados aparecerán aquí antes de contratar.' : 'Annual access is being prepared. The confirmed price and currency will appear here before purchase.'}</p>}
      {offer && offer.prices.length > 1 && <fieldset className="membership-currencies" disabled={busy}><legend>{es ? 'Moneda' : 'Currency'}</legend>{offer.prices.map(item => <label key={item.currency}>
        <input type="radio" name="plus-currency" checked={price?.currency === item.currency} value={item.currency} onChange={() => membership.selectCurrency(item.currency)} />
        <span>{item.currency === 'eur' ? '€ EUR' : '$ USD'}</span>
      </label>)}</fieldset>}
      {monthlyPrice && <p className="nrn-plus-note">{es ? `${provider} también ofrece ${format(monthlyPrice.amount, monthlyPrice.currency)} al mes. Para el plan anual, selecciona ${price ? format(price.amount, price.currency) : ''} al año antes de confirmar.` : `${provider} also offers ${format(monthlyPrice.amount, monthlyPrice.currency)} monthly. For the annual plan, select ${price ? format(price.amount, price.currency) : ''} yearly before confirming.`}</p>}
      {offer?.requiresMatchingEmail && account && <p className="nrn-plus-email">{es ? 'Usa este mismo email en la membresía de Buy Me a Coffee para vincular el acceso:' : 'Use this same email for your Buy Me a Coffee membership to link access:'} <strong>{account.email}</strong></p>}
      {!account ? <p className="nrn-plus-note">{es ? 'Entra o crea tu cuenta NRN Play para vincular Plus. Puedes seguir jugando como invitado.' : 'Sign in or create your NRN Play account to link Plus. You can keep playing as a guest.'}</p>
        : offer?.purchaseEnabled && price ? <><button type="button" className="membership-primary nrn-plus-purchase" disabled={busy} onClick={() => void membership.plusCheckout(price.currency)}>{busy ? (es ? 'Un momento…' : 'One moment…') : es ? `Continuar en ${provider}` : `Continue on ${provider}`}</button>
          <p className="nrn-plus-note">{es ? `La contratación y la renovación se gestionan en ${provider}. Revisa allí el importe y la frecuencia antes de confirmar. El acceso aparece tras verificar la membresía.` : `Purchase and renewal are managed on ${provider}. Review the amount and billing frequency there before confirming. Access appears after membership is verified.`}</p></>
          : null}
      {!offer?.purchaseEnabled && <p className="membership-notice" role="status">{es ? 'La contratación de Plus estará disponible próximamente.' : 'Plus purchases will be available soon.'}</p>}
    </div>}
    {canManage && <a className="nrn-plus-manage" href={offer!.manageUrl!} target="_blank" rel="noopener noreferrer">{es ? `Gestionar o cancelar en ${provider}` : `Manage or cancel on ${provider}`} ↗</a>}
    {managementLogin && <p className="nrn-plus-note">{es ? 'Entra en Buy Me a Coffee con el email de tu membresía. Después abre My Account → Payments → Memberships, elige NRN Plus y consulta sus detalles para gestionar o cancelar la renovación.' : 'Sign in to Buy Me a Coffee with your membership email. Then open My Account → Payments → Memberships, choose NRN Plus and view its details to manage or cancel renewal.'}</p>}
    {account && <button type="button" className="membership-text" disabled={busy || refreshing} onClick={async () => {
      setRefreshing(true)
      try { await membership.refresh() } finally { setRefreshing(false) }
    }}>{refreshing ? (es ? 'Actualizando acceso…' : 'Refreshing access…') : (es ? 'Actualizar mi acceso' : 'Refresh my access')}</button>}
    <CosmeticPicker />
    <p className="nrn-plus-note">{es ? 'Las aportaciones puntuales en Buy Me a Coffee son independientes y no activan Plus automáticamente.' : 'One-time Buy Me a Coffee contributions are separate and do not automatically activate Plus.'} <a href="https://buymeacoffee.com/nrnplay" target="_blank" rel="noopener noreferrer">{es ? 'Aportar voluntariamente' : 'Make a voluntary contribution'} ↗</a></p>
  </section>
}
