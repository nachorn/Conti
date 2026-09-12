import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Lang } from '../i18n'
import type { MembershipController, MembershipError } from '../useMembership'
import { isMembershipCurrency, type MembershipCurrency } from '../../lib/currency.js'
import './Membership.css'

const copy = {
  es: {
    account: 'Mi cuenta', adFree: 'Sin anuncios', close: 'Cerrar', title: 'Una cuenta, todas tus mesas',
    description: 'Accede con tu email para usar tu compra o tu acceso de regalo en cualquier dispositivo.',
    benefit: 'Cuando alguien de la mesa tiene acceso sin anuncios, toda la mesa juega sin publicidad.',
    soon: 'Próximamente', unavailable: 'El acceso con email todavía no está disponible. Puedes seguir creando salas y jugando como siempre.',
    email: 'Tu email', send: 'Enviarme un código', sent: 'Te hemos enviado un código. Revisa también la carpeta de spam.',
    code: 'Código de 6 cifras', verify: 'Entrar', different: 'Usar otro email', resend: 'Enviar otro código',
    active: 'Tu acceso sin anuncios está activo', gift: 'Acceso de regalo', purchased: 'Compra vinculada a tu cuenta',
    inactive: 'Tu cuenta aún no tiene acceso sin anuncios.', expires: 'Disponible hasta',
    purchase: 'Quitar anuncios', once: 'Pago único', devices: 'Tu compra se guarda en tu cuenta. En otro dispositivo, entra con el mismo email.',
    currency: 'Moneda del pago', currencyHelp: 'Puedes elegir euros o dólares estadounidenses antes de pagar.', currencyPending: 'Preparando la moneda…',
    purchaseSoon: 'La compra de acceso sin anuncios estará disponible próximamente.', refresh: 'Actualizar mi acceso',
    logout: 'Cerrar sesión', waiting: 'Un momento…', checking: 'Estamos consultando tu acceso.',
    pending: 'Si acabas de pagar, la confirmación puede tardar unos instantes. Tu acceso aparecerá cuando recibamos la confirmación del pago.',
    returned: 'Has vuelto del pago. Puedes actualizar tu acceso para consultar su estado.',
    storage: 'Este navegador no permite guardar tu sesión. Puede que tengas que volver a entrar al cerrar la página.',
    guest: 'Puedes cerrar esta ventana y seguir jugando sin una cuenta.',
  },
  en: {
    account: 'My account', adFree: 'Ad-free', close: 'Close', title: 'One account, all your tables',
    description: 'Sign in with your email to use your purchase or gifted access on any device.',
    benefit: 'When someone at the table has ad-free access, the whole table plays without ads.',
    soon: 'Coming soon', unavailable: 'Email sign-in is not available yet. You can keep creating rooms and playing as usual.',
    email: 'Your email', send: 'Email me a code', sent: 'We sent you a code. Please check your spam folder too.',
    code: '6-digit code', verify: 'Sign in', different: 'Use a different email', resend: 'Send another code',
    active: 'Your ad-free access is active', gift: 'Gifted access', purchased: 'Purchase linked to your account',
    inactive: 'Your account does not have ad-free access yet.', expires: 'Available until',
    purchase: 'Remove ads', once: 'One-time payment', devices: 'Your purchase is saved to your account. On another device, sign in with the same email.',
    currency: 'Payment currency', currencyHelp: 'You can choose euros or US dollars before paying.', currencyPending: 'Preparing your currency…',
    purchaseSoon: 'Ad-free purchases will be available soon.', refresh: 'Refresh my access',
    logout: 'Sign out', waiting: 'One moment…', checking: 'Checking your access.',
    pending: 'If you have just paid, confirmation may take a moment. Your access will appear once we receive payment confirmation.',
    returned: 'You returned from checkout. Refresh your access to check its status.',
    storage: 'This browser cannot save your session. You may need to sign in again after closing the page.',
    guest: 'You can close this window and keep playing without an account.',
  },
}
const errors: Record<Lang, Record<NonNullable<MembershipError>, string>> = {
  es: { unavailable: 'El servicio no está disponible ahora. Inténtalo más tarde.', expired: 'Tu sesión ha caducado. Vuelve a entrar con tu email.', invalidEmail: 'Comprueba que el email esté escrito correctamente.', invalidCode: 'El código no es válido o ha caducado. Compruébalo o solicita otro.', rateLimited: 'Espera unos minutos antes de volver a intentarlo.', network: 'No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.' },
  en: { unavailable: 'The service is unavailable right now. Please try again later.', expired: 'Your session has expired. Sign in with your email again.', invalidEmail: 'Please check that your email address is correct.', invalidCode: 'The code is invalid or has expired. Check it or request another.', rateLimited: 'Please wait a few minutes before trying again.', network: 'We could not connect. Check your connection and try again.' },
}

/** This modal owns focus and returns it to the initiating control on close. */
export function Membership({ membership, lang, open, onOpen, onClose }: {
  membership: MembershipController; lang: Lang; open: boolean; onOpen: () => void; onClose: () => void
}) {
  const t = copy[lang]
  const location = useLocation()
  const navigate = useNavigate()
  const [paymentReturn] = useState(() => new URLSearchParams(location.search).get('payment'))
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const [canResend, setCanResend] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const { account, config, busy, error } = membership
  const visible = config.enabled || !!account || !!membership.token

  useEffect(() => {
    if (!paymentReturn) return
    onOpen()
    const query = new URLSearchParams(location.search)
    query.delete('payment')
    navigate({ pathname: location.pathname, search: query.toString() }, { replace: true })
    // Only consume the return parameter once; it is never proof of payment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentReturn])

  useEffect(() => {
    const node = dialog.current
    if (!node) return
    if (open && !node.open) node.showModal()
    if (!open && node.open) node.close()
  }, [open, visible])

  useEffect(() => {
    if (paymentReturn !== 'success' || !membership.token || account?.adFree) return
    let attempts = 0
    const timer = window.setInterval(() => {
      void membership.refresh()
      if (++attempts >= 10) window.clearInterval(timer)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [paymentReturn, membership.token, account?.adFree, membership.refresh])

  useEffect(() => {
    if (!resendAt) return
    setCanResend(false)
    const timer = window.setTimeout(() => setCanResend(true), Math.max(0, resendAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [resendAt])

  const send = async (event?: FormEvent) => {
    event?.preventDefault()
    if (await membership.login(email, lang)) { setSent(true); setCode(''); setResendAt(Date.now() + 60_000) }
  }
  const verify = async (event: FormEvent) => {
    event.preventDefault()
    if (await membership.verify(email, code)) { setEmail(''); setCode(''); setSent(false) }
  }
  let price: string | null = null
  const prices = (config.prices ?? (config.price ? [config.price] : []))
    .filter((value): value is { amount: number; currency: MembershipCurrency } =>
      isMembershipCurrency(value.currency) && Number.isSafeInteger(value.amount) && value.amount > 0)
  const selectedPrice = prices.find(value => value.currency === membership.currency) ?? prices[0]
  if (selectedPrice) {
    try {
      const format = new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US', { style: 'currency', currency: selectedPrice.currency })
      price = format.format(selectedPrice.amount / 100)
    } catch { /* A missing price must never turn into an invented offer. */ }
  }

  if (!visible) return null

  return <>
    <div className="membership-toolbar">
      <button type="button" className="membership-account-button" onClick={onOpen} aria-haspopup="dialog">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
        {t.account}{account?.adFree && <span className="membership-badge">{t.adFree}</span>}
      </button>
    </div>
    <dialog ref={dialog} className="membership-dialog" aria-labelledby="membership-title" onCancel={onClose} onClose={onClose}>
      <div className="membership-header">
        <span className="membership-eyebrow">Continental &amp; Pocha</span>
        <button type="button" className="membership-close" onClick={onClose} aria-label={t.close}>×</button>
      </div>
      <h2 id="membership-title">{t.title}</h2>
      <p className="membership-description">{t.description}</p>
      <div className="membership-benefit">{t.benefit}</div>
      {!membership.loaded ? <p role="status">{t.waiting}</p> : !config.loginEnabled && !account ? <div className="membership-notice"><strong>{t.soon}</strong><p>{t.unavailable}</p></div> : account ? <>
        <p className="membership-email">{account.email}</p>
        <div className={account.adFree ? 'membership-access active' : 'membership-access'}>
          <strong>{account.adFree ? t.active : t.inactive}</strong>
          {account.adFree && <p>{account.source === 'gift' ? t.gift : t.purchased}</p>}
          {account.adFree && account.expiresAt && <p>{t.expires} {new Date(account.expiresAt).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US')}</p>}
        </div>
        {!account.adFree && <>
          {paymentReturn === 'success' && <p className="membership-notice" role="status">{t.pending}</p>}
          {(paymentReturn === 'canceled' || paymentReturn === 'cancelled') && <p className="membership-notice">{t.returned}</p>}
          {config.checkoutEnabled && price && selectedPrice ? <div className="membership-offer">
            <fieldset className="membership-currencies" disabled={busy} aria-describedby="membership-currency-help">
              <legend>{t.currency}</legend>
              {(['eur', 'usd'] as const).map(value => <label key={value}>
                <input type="radio" name="membership-currency" value={value} checked={selectedPrice.currency === value}
                  disabled={!prices.some(option => option.currency === value)} onChange={() => membership.selectCurrency(value)} />
                <span>{value === 'eur' ? '€ EUR' : '$ USD'}</span>
              </label>)}
            </fieldset>
            <p id="membership-currency-help">{t.currencyHelp}</p>
            <div aria-live="polite"><strong>{price}</strong><span>{t.once}</span></div>
            <button className="membership-primary" disabled={busy || membership.currencyPending} onClick={() => void membership.checkout(selectedPrice.currency)}>{busy ? t.waiting : membership.currencyPending ? t.currencyPending : t.purchase}</button>
            <p>{t.devices}</p>
          </div> : <p className="membership-notice">{t.purchaseSoon}</p>}
        </>}
        <div className="membership-actions">
          <button className="membership-secondary" disabled={busy || refreshing} onClick={async () => { setRefreshing(true); await membership.refresh(); setRefreshing(false) }}>{refreshing ? t.checking : t.refresh}</button>
          <button className="membership-text" disabled={busy} onClick={() => void membership.logout()}>{t.logout}</button>
        </div>
      </> : <form className="membership-form" onSubmit={sent ? verify : send}>
        {sent ? <>
          <p className="membership-notice" role="status">{t.sent}<br /><span className="membership-email">{email}</span></p>
          <label htmlFor="membership-code">{t.code}</label>
          <input autoFocus id="membership-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required />
          <button className="membership-primary" disabled={busy || code.length !== 6} type="submit">{busy ? t.waiting : t.verify}</button>
          <div className="membership-actions">
            <button className="membership-text" type="button" disabled={busy} onClick={() => { setSent(false); setCode(''); membership.clearError() }}>{t.different}</button>
            <button className="membership-text" type="button" disabled={busy || !canResend} onClick={() => void send()}>{t.resend}</button>
          </div>
        </> : <>
          <label htmlFor="membership-email">{t.email}</label>
          <input autoFocus id="membership-email" type="email" name="email" autoComplete="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" required />
          <button className="membership-primary" disabled={busy} type="submit">{busy ? t.waiting : t.send}</button>
        </>}
      </form>}
      {error && <p className="membership-error" role="alert">{errors[lang][error]}</p>}
      {!membership.storageAvailable && <p className="membership-notice">{t.storage}</p>}
      <p className="membership-footnote">{t.guest}</p>
    </dialog>
  </>
}
