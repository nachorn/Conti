import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Lang } from '../i18n'
import type { MembershipController, MembershipError } from '../useMembership'
import { isMembershipCurrency, type MembershipCurrency } from '../../lib/currency.js'
import { PersonalStats } from './PersonalStats'
import { Leagues } from './Leagues'
import { readAccountForm } from '../lib/accountForm'
import './Membership.css'

const copy = {
  es: {
    account: 'Mi cuenta', adFree: 'Sin anuncios', close: 'Cerrar', title: 'Una cuenta, todas tus mesas',
    description: 'Guarda tus resultados de Pocha y Conti y consulta tu historial desde cualquier dispositivo.',
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
    description: 'Save your Pocha and Conti results and see your history on any device.',
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
  es: { unavailable: 'El servicio no está disponible ahora. Inténtalo más tarde.', expired: 'Tu sesión ha caducado. Vuelve a entrar con tu email.', invalidEmail: 'Comprueba que el email esté escrito correctamente.', invalidCode: 'El código no es válido o ha caducado. Compruébalo o solicita otro.', invalidCredentials: 'El email o la contraseña no son correctos.', invalidName: 'Escribe un nombre de hasta 24 caracteres.', invalidPassword: 'Elige una contraseña de entre 15 y 128 caracteres. Puedes usar una frase.', rateLimited: 'Espera unos minutos antes de volver a intentarlo.', network: 'No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.' },
  en: { unavailable: 'The service is unavailable right now. Please try again later.', expired: 'Your session has expired. Sign in with your email again.', invalidEmail: 'Please check that your email address is correct.', invalidCode: 'The code is invalid or has expired. Check it or request another.', invalidCredentials: 'The email or password is incorrect.', invalidName: 'Enter a name of up to 24 characters.', invalidPassword: 'Choose a password of 15–128 characters. You can use a phrase.', rateLimited: 'Please wait a few minutes before trying again.', network: 'We could not connect. Check your connection and try again.' },
}

/** This modal owns focus and returns it to the initiating control on close. */
export function Membership({ membership, lang, open, onOpen, onClose, hideTrigger = false }: {
  membership: MembershipController; lang: Lang; open: boolean; onOpen: () => void; onClose: () => void; hideTrigger?: boolean
}) {
  const t = copy[lang]
  const es = lang === 'es'
  const location = useLocation()
  const navigate = useNavigate()
  const [paymentReturn] = useState(() => new URLSearchParams(location.search).get('payment'))
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [mode, setMode] = useState<'password' | 'register' | 'code' | 'reset'>('password')
  const [section, setSection] = useState<'stats' | 'leagues' | 'profile'>('stats')
  const [securityOpen, setSecurityOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const [canResend, setCanResend] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const { account, config, busy, error } = membership
  const visible = config.enabled || !!account || !!membership.token
  const passwordEnabled = config.passwordLoginEnabled === true
  const activeMode = mode === 'password' && !passwordEnabled ? 'code' : mode

  function changeMode(next: typeof mode) {
    setMode(next); setSent(false); setCode(''); setPassword(''); setConfirmation(''); setShowPassword(false); setFormError(null)
    membership.clearError()
  }
  function finishSignIn() {
    setPassword(''); setConfirmation(''); setCode(''); setSent(false); setSecurityOpen(false); setMode('password'); setShowPassword(false); setSection(paymentReturn ? 'profile' : 'stats'); setFormError(null)
  }

  useEffect(() => {
    if (open) return
    setPassword(''); setConfirmation(''); setCode(''); setSent(false); setSecurityOpen(false); setFormError(null); setMode('password')
  }, [open])

  useEffect(() => {
    if (!paymentReturn) return
    setSection('profile')
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

  const send = async (event?: FormEvent, fields = { name, email, password, confirmation }) => {
    event?.preventDefault()
    setFormError(null)
    if (activeMode === 'register' && fields.password !== fields.confirmation) { setFormError(es ? 'Las contraseñas no coinciden.' : 'The passwords do not match.'); return }
    const ok = activeMode === 'register' ? await membership.register(fields.name, fields.email, fields.password, lang)
      : activeMode === 'reset' ? await membership.requestPasswordReset(fields.email, lang)
      : await membership.login(fields.email, lang)
    if (ok) { setSent(true); setCode(''); setResendAt(Date.now() + 60_000) }
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = readAccountForm(new FormData(event.currentTarget), { name, email, password, confirmation, code })
    setName(fields.name); setEmail(fields.email); setPassword(fields.password); setConfirmation(fields.confirmation); setCode(fields.code)
    setFormError(null)
    if (activeMode === 'password') {
      if (await membership.loginPassword(fields.email, fields.password)) finishSignIn()
    } else if (!sent) await send(undefined, fields)
    else {
      if (activeMode === 'reset' && fields.password !== fields.confirmation) { setFormError(es ? 'Las contraseñas no coinciden.' : 'The passwords do not match.'); return }
      const ok = activeMode === 'reset' ? await membership.confirmPasswordReset(fields.email, fields.code, fields.password)
        : activeMode === 'register' ? await membership.verifyRegistration(fields.email, fields.code)
        : await membership.verify(fields.email, fields.code)
      if (ok) finishSignIn()
    }
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

  if (!visible && !open) return null

  return <>
    {!hideTrigger && <div className="membership-toolbar">
      <button type="button" className="membership-account-button" onClick={onOpen} aria-haspopup="dialog">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
        {t.account}{account?.adFree && <span className="membership-badge">{t.adFree}</span>}
      </button>
    </div>}
    <dialog ref={dialog} className="membership-dialog" aria-labelledby="membership-title" onCancel={onClose} onClose={onClose}>
      <div className="membership-header">
        <span className="membership-eyebrow">NRN Play</span>
        <button type="button" className="membership-close" onClick={onClose} aria-label={t.close}>×</button>
      </div>
      <h2 id="membership-title">{t.title}</h2>
      <p className="membership-description">{t.description}</p>
      {!membership.loaded ? <p role="status">{t.waiting}</p> : !config.loginEnabled && !passwordEnabled && !account ? <div className="membership-notice"><strong>{t.soon}</strong><p>{t.unavailable}</p></div> : account && !securityOpen ? <>
        <div className="membership-tabs membership-tabs-account" role="group" aria-label={es ? 'Mi cuenta' : 'My account'}>
          <button type="button" aria-pressed={section === 'stats'} onClick={() => setSection('stats')}>{es ? 'Mis estadísticas' : 'My statistics'}</button>
          <button type="button" aria-pressed={section === 'leagues'} onClick={() => setSection('leagues')}>{es ? 'Ligas' : 'Leagues'}</button>
          <button type="button" aria-pressed={section === 'profile'} onClick={() => setSection('profile')}>{es ? 'Mi perfil' : 'My profile'}</button>
        </div>
        {section === 'stats' ? <PersonalStats token={membership.token} lang={lang} active={open} onSignIn={() => void membership.refresh()} /> : section === 'leagues' ? <Leagues token={membership.token} lang={lang} active={open} onSignIn={() => void membership.refresh()} /> : <>
        <h3 className="membership-profile-name">{account.name || (es ? 'Mi perfil' : 'My profile')}</h3>
        <p className="membership-email">{account.email}</p>
        <p className="membership-notice">{es ? 'Tu sesión se recuerda en este navegador. En otro dispositivo, entra con el mismo email para ver tus resultados.' : 'This browser remembers your session. Sign in with the same email on another device to see your results.'}</p>
        {config.loginEnabled && <button type="button" className="membership-secondary" onClick={() => { changeMode('reset'); setEmail(account.email); setSecurityOpen(true) }}>{account.hasPassword ? (es ? 'Cambiar contraseña' : 'Change password') : (es ? 'Crear contraseña' : 'Set a password')}</button>}
        <details className="membership-ad-access" open={!!paymentReturn}><summary>{t.adFree}</summary>
        <div className="membership-benefit">{t.benefit}</div>
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
        </details>
        <div className="membership-actions">
          <button className="membership-secondary" disabled={busy || refreshing} onClick={async () => { setRefreshing(true); await membership.refresh(); setRefreshing(false) }}>{refreshing ? t.checking : t.refresh}</button>
          <button className="membership-text" disabled={busy} onClick={() => void membership.logout()}>{t.logout}</button>
        </div>
        </>}
      </> : <>
        {!securityOpen && passwordEnabled && <div className="membership-tabs" role="group" aria-label={es ? 'Acceso a tu cuenta' : 'Account access'}>
          <button type="button" disabled={busy} aria-pressed={activeMode === 'password' || activeMode === 'code'} onClick={() => changeMode('password')}>{es ? 'Entrar' : 'Sign in'}</button>
          {config.loginEnabled && <button type="button" disabled={busy} aria-pressed={activeMode === 'register'} onClick={() => changeMode('register')}>{es ? 'Crear cuenta' : 'Create account'}</button>}
        </div>}
        {activeMode === 'reset' && <h3>{es ? 'Recuperar contraseña' : 'Reset your password'}</h3>}
        <form className="membership-form" onSubmit={submit}>
        {sent ? <>
          <p className="membership-notice" role="status">{activeMode === 'register' ? (es ? 'Si puedes crear esta cuenta, recibirás un código por email. Si ya tienes cuenta, entra o recupera tu contraseña.' : 'If you can create this account, you will receive an email code. If you already have an account, sign in or reset your password.') : activeMode === 'reset' ? (es ? 'Si hay una cuenta con ese email, recibirás un código para cambiar la contraseña.' : 'If an account uses that email, you will receive a password-reset code.') : t.sent}<br /><span className="membership-email">{email}</span></p>
          <label htmlFor="membership-code">{t.code}</label>
          <input autoFocus id="membership-code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} required />
          {activeMode === 'reset' && <>
            <label htmlFor="membership-new-password">{es ? 'Nueva contraseña' : 'New password'}</label>
            <input id="membership-new-password" name="newPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={15} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} aria-describedby="membership-password-help" />
            <label htmlFor="membership-confirm-password">{es ? 'Repite la contraseña' : 'Repeat password'}</label>
            <input id="membership-confirm-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={15} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} />
            <p id="membership-password-help" className="membership-password-help">{es ? 'Entre 15 y 128 caracteres. Una frase larga es fácil de recordar.' : '15–128 characters. A long phrase is easy to remember.'}</p>
          </>}
          <button className="membership-primary" disabled={busy} type="submit">{busy ? t.waiting : activeMode === 'reset' ? (es ? 'Guardar contraseña y entrar' : 'Save password and sign in') : t.verify}</button>
          <div className="membership-actions">
            <button className="membership-text" type="button" disabled={busy} onClick={() => { setSent(false); setCode(''); membership.clearError() }}>{es ? 'Volver al formulario' : 'Back to the form'}</button>
            <button className="membership-text" type="button" disabled={busy || !canResend} onClick={() => void send()}>{t.resend}</button>
          </div>
        </> : <>
          {activeMode === 'register' && <><label htmlFor="membership-name">{es ? 'Tu nombre' : 'Your name'}</label><input id="membership-name" name="nickname" autoComplete="nickname" maxLength={24} required value={name} onChange={event => setName(event.target.value)} /></>}
          <label htmlFor="membership-email">{t.email}</label>
          <input autoFocus id="membership-email" type="email" name="username" autoComplete="username" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" required />
          {(activeMode === 'password' || activeMode === 'register') && <>
            <label htmlFor="membership-password">{es ? 'Contraseña' : 'Password'}</label>
            <input id="membership-password" name="password" type={showPassword ? 'text' : 'password'} autoComplete={activeMode === 'register' ? 'new-password' : 'current-password'} minLength={activeMode === 'register' ? 15 : undefined} maxLength={128} required value={password} onChange={event => setPassword(event.target.value)} aria-describedby={activeMode === 'register' ? 'membership-password-help' : undefined} />
            {activeMode === 'register' && <><label htmlFor="membership-confirm-password">{es ? 'Repite la contraseña' : 'Repeat password'}</label><input id="membership-confirm-password" name="confirmPassword" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={15} maxLength={128} required value={confirmation} onChange={event => setConfirmation(event.target.value)} /><p id="membership-password-help" className="membership-password-help">{es ? 'Entre 15 y 128 caracteres. Puedes usar una frase larga.' : '15–128 characters. You can use a long phrase.'}</p></>}
            <button className="membership-text membership-reveal" type="button" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? (es ? 'Ocultar contraseña' : 'Hide password') : (es ? 'Mostrar contraseña' : 'Show password')}</button>
          </>}
          <button className="membership-primary" disabled={busy} type="submit">{busy ? t.waiting : activeMode === 'password' ? (es ? 'Entrar' : 'Sign in') : activeMode === 'register' ? (es ? 'Crear cuenta y verificar email' : 'Create account and verify email') : t.send}</button>
          {activeMode === 'password' && config.loginEnabled && <div className="membership-actions"><button className="membership-text" type="button" disabled={busy} onClick={() => changeMode('reset')}>{es ? 'He olvidado mi contraseña' : 'Forgot password'}</button><button className="membership-text" type="button" disabled={busy} onClick={() => changeMode('code')}>{es ? 'Entrar con un código' : 'Sign in with a code'}</button></div>}
        </>}
      </form>
      {securityOpen && <button type="button" className="membership-text" disabled={busy} onClick={() => { setSecurityOpen(false); changeMode('password') }}>{es ? 'Volver a mi perfil' : 'Back to my profile'}</button>}
      {!securityOpen && (activeMode === 'reset' || activeMode === 'code') && passwordEnabled && !account && <button type="button" className="membership-text" disabled={busy} onClick={() => changeMode('password')}>{es ? 'Entrar con contraseña' : 'Sign in with a password'}</button>}
      </>}
      {formError && <p className="membership-error" role="alert">{formError}</p>}
      {error && <p className="membership-error" role="alert">{errors[lang][error]}</p>}
      {!membership.storageAvailable && <p className="membership-notice">{t.storage}</p>}
      <p className="membership-footnote">{t.guest}</p>
    </dialog>
  </>
}
