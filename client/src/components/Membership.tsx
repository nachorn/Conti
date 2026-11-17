import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Lang } from '../i18n'
import type { MembershipController, MembershipError } from '../useMembership'
import { PersonalStats } from './PersonalStats'
import { Leagues } from './Leagues'
import { readAccountForm } from '../lib/accountForm'
import { PlusPanel } from './PlusPanel'
import { accountView } from '../lib/accountReadiness'
import './Membership.css'

const copy = {
  es: {
    account: 'Mi cuenta', adFree: 'Sin anuncios', close: 'Cerrar', title: 'Tu cuenta de NRN Play',
    description: 'Usa la misma cuenta en FootballChampion, Conti y La Pocha.',
    benefit: 'Cuando alguien de la mesa tiene acceso sin anuncios, toda la mesa juega sin publicidad.',
    soon: 'Próximamente', unavailable: 'El acceso con email todavía no está disponible. Puedes seguir creando salas y jugando como siempre.',
    email: 'Tu email', send: 'Enviarme un código', sent: 'Te hemos enviado un código. Revisa también la carpeta de spam.',
    code: 'Código de 6 cifras', verify: 'Entrar', different: 'Usar otro email', resend: 'Enviar otro código',
    active: 'Tu acceso sin anuncios está activo', gift: 'Acceso de regalo', purchased: 'Compra vinculada a tu cuenta',
    inactive: 'Tu cuenta aún no tiene acceso sin anuncios.', expires: 'Disponible hasta',
    purchase: 'Quitar anuncios', once: 'Pago único', devices: 'Tu compra se guarda en tu cuenta. En otro dispositivo, entra con el mismo email.',
    currency: 'Moneda del pago', currencyHelp: 'Puedes elegir euros o dólares estadounidenses antes de pagar.', currencyPending: 'Preparando la moneda…',
    purchaseSoon: 'La compra de acceso sin anuncios estará disponible próximamente.', refresh: 'Actualizar perfil',
    logout: 'Cerrar sesión', waiting: 'Un momento…', checking: 'Actualizando perfil…',
    pending: 'Si acabas de pagar, la confirmación puede tardar unos instantes. Tu acceso aparecerá cuando recibamos la confirmación del pago.',
    returned: 'Has vuelto del pago. Puedes actualizar tu acceso para consultar su estado.',
    storage: 'Este navegador no permite guardar tu sesión. Puede que tengas que volver a entrar al cerrar la página.',
    guest: 'También puedes jugar sin cuenta.',
  },
  en: {
    account: 'My account', adFree: 'Ad-free', close: 'Close', title: 'Your NRN Play account',
    description: 'Use the same account in FootballChampion, Conti and La Pocha.',
    benefit: 'When someone at the table has ad-free access, the whole table plays without ads.',
    soon: 'Coming soon', unavailable: 'Email sign-in is not available yet. You can keep creating rooms and playing as usual.',
    email: 'Your email', send: 'Email me a code', sent: 'We sent you a code. Please check your spam folder too.',
    code: '6-digit code', verify: 'Sign in', different: 'Use a different email', resend: 'Send another code',
    active: 'Your ad-free access is active', gift: 'Gifted access', purchased: 'Purchase linked to your account',
    inactive: 'Your account does not have ad-free access yet.', expires: 'Available until',
    purchase: 'Remove ads', once: 'One-time payment', devices: 'Your purchase is saved to your account. On another device, sign in with the same email.',
    currency: 'Payment currency', currencyHelp: 'You can choose euros or US dollars before paying.', currencyPending: 'Preparing your currency…',
    purchaseSoon: 'Ad-free purchases will be available soon.', refresh: 'Refresh profile',
    logout: 'Sign out', waiting: 'One moment…', checking: 'Refreshing profile…',
    pending: 'If you have just paid, confirmation may take a moment. Your access will appear once we receive payment confirmation.',
    returned: 'You returned from checkout. Refresh your access to check its status.',
    storage: 'This browser cannot save your session. You may need to sign in again after closing the page.',
    guest: 'You can also play without an account.',
  },
}
const errors: Record<Lang, Record<NonNullable<MembershipError>, string>> = {
  es: { unavailable: 'El servicio no está disponible ahora. Inténtalo más tarde.', expired: 'Tu sesión ha caducado. Vuelve a entrar con tu email.', invalidEmail: 'Comprueba que el email esté escrito correctamente.', invalidCode: 'El código no es válido o ha caducado. Compruébalo o solicita otro.', invalidCredentials: 'El email o la contraseña no son correctos.', invalidName: 'Escribe un nombre de hasta 24 caracteres.', invalidPassword: 'Elige una contraseña de entre 15 y 128 caracteres. Puedes usar una frase.', rateLimited: 'Espera unos minutos antes de volver a intentarlo.', network: 'No hemos podido conectar. Comprueba tu conexión e inténtalo de nuevo.' },
  en: { unavailable: 'The service is unavailable right now. Please try again later.', expired: 'Your session has expired. Sign in with your email again.', invalidEmail: 'Please check that your email address is correct.', invalidCode: 'The code is invalid or has expired. Check it or request another.', invalidCredentials: 'The email or password is incorrect.', invalidName: 'Enter a name of up to 24 characters.', invalidPassword: 'Choose a password of 15–128 characters. You can use a phrase.', rateLimited: 'Please wait a few minutes before trying again.', network: 'We could not connect. Check your connection and try again.' },
}

/** This modal owns focus and returns it to the initiating control on close. */
export function Membership({ membership, lang, open, onOpen, onClose, hideTrigger = false, gameType = null, initialSection = 'account', connectionNotice }: {
  membership: MembershipController; lang: Lang; open: boolean; onOpen: () => void; onClose: () => void; hideTrigger?: boolean; gameType?: 'continental' | 'pocha' | null; initialSection?: 'account' | 'plus'; connectionNotice?: ReactNode
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
  const [section, setSection] = useState<'stats' | 'leagues' | 'profile' | 'plus'>(initialSection === 'plus' || paymentReturn ? 'plus' : gameType ? 'stats' : 'profile')
  const [securityOpen, setSecurityOpen] = useState(false)
  const [plusSignInOpen, setPlusSignInOpen] = useState(false)
  const [passwordUpdated, setPasswordUpdated] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [resendAt, setResendAt] = useState(0)
  const [canResend, setCanResend] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const { account, config, busy, error } = membership
  const identity = accountView(membership)
  const visible = config.enabled || !!account || !!membership.token
  const passwordEnabled = config.passwordLoginEnabled === true
  const activeMode = mode === 'password' && !passwordEnabled ? 'code' : mode
  const activeSection = section === 'plus' ? 'plus' : gameType ? section : 'profile'
  const plusView = activeSection === 'plus' && !securityOpen
  const gameName = gameType === 'pocha' ? 'La Pocha' : 'Conti'

  useEffect(() => {
    if (open && membership.token) void membership.refresh()
  }, [open, membership.token, membership.refresh])

  function changeMode(next: typeof mode) {
    setMode(next); setSent(false); setCode(''); setPassword(''); setConfirmation(''); setShowPassword(false); setFormError(null); setPasswordUpdated(false)
    membership.clearError()
  }
  function finishSignIn() {
    setPasswordUpdated(activeMode === 'reset')
    setPassword(''); setConfirmation(''); setCode(''); setSent(false); setSecurityOpen(false); setPlusSignInOpen(false); setMode('password'); setShowPassword(false); setSection(initialSection === 'plus' || paymentReturn ? 'plus' : activeMode === 'reset' || !gameType ? 'profile' : 'stats'); setFormError(null)
  }

  useEffect(() => {
    setSection(initialSection === 'plus' || paymentReturn ? 'plus' : gameType ? 'stats' : 'profile')
    if (open) return
    setPassword(''); setConfirmation(''); setCode(''); setSent(false); setSecurityOpen(false); setPlusSignInOpen(false); setFormError(null); setMode('password'); setShowPassword(false); setPasswordUpdated(false)
  }, [open, gameType, paymentReturn, initialSection])

  useEffect(() => {
    if (open && plusSignInOpen) emailInput.current?.focus()
  }, [open, plusSignInOpen])

  useEffect(() => {
    if (!paymentReturn) return
    setSection('plus')
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
    if (open && !node.open) {
      node.showModal()
      if (initialSection === 'plus') { title.current?.focus(); node.scrollTop = 0 }
    }
    if (!open && node.open) node.close()
  }, [open, visible, initialSection])

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

  if (!visible && !open) return null

  return <>
    {!hideTrigger && <div className="membership-toolbar">
      <button type="button" className="membership-account-button" onClick={onOpen} aria-haspopup="dialog">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 21v-2a7 7 0 0 1 14 0v2" /></svg>
        {t.account}{account?.adFree && <span className="membership-badge">{t.adFree}</span>}
      </button>
    </div>}
    <dialog ref={dialog} className={`membership-dialog${plusView ? ' membership-dialog--plus' : ''}`} aria-labelledby="membership-title" onCancel={onClose} onClose={onClose}>
      <div className="membership-header">
        <div><span className="membership-eyebrow">NRN Play</span>
          <h2 ref={title} id="membership-title" tabIndex={-1}>{plusView ? 'NRN Plus' : account ? securityOpen ? (es ? 'Cambiar contraseña' : 'Change password') : gameType && activeSection !== 'profile' ? gameName : (es ? 'Mi perfil' : 'My profile') : t.account}</h2>
        </div>
        <button type="button" className="membership-close" onClick={onClose} aria-label={t.close}>×</button>
      </div>
      {connectionNotice && <div className="nrn-connection-corner">{connectionNotice}</div>}
      {identity !== 'pending' && !plusView && (!account || !gameType || activeSection === 'profile' || securityOpen) && <p className="membership-description">{t.description}</p>}
      {!account && plusView && identity === 'signed-out' && <PlusPanel membership={membership} lang={lang} onSignIn={config.loginEnabled || passwordEnabled ? () => { setPlusSignInOpen(true); emailInput.current?.focus() } : undefined} signInOpen={plusSignInOpen} />}
      {identity === 'pending' ? null : !config.loginEnabled && !passwordEnabled && !account ? <div className="membership-notice"><strong>{t.soon}</strong><p>{t.unavailable}</p></div> : account && !securityOpen ? <>
        <div className={`membership-tabs membership-tabs-account ${gameType ? 'membership-tabs-games' : ''}`} role="group" aria-label={es ? 'Mi cuenta' : 'My account'}>
          {gameType && <><button type="button" aria-pressed={activeSection === 'stats'} onClick={() => setSection('stats')}>{es ? 'Estadísticas' : 'Statistics'}</button>
          <button type="button" aria-pressed={activeSection === 'leagues'} onClick={() => setSection('leagues')}>{es ? 'Ligas' : 'Leagues'}</button></>}
          <button type="button" aria-pressed={activeSection === 'profile'} onClick={() => setSection('profile')}>{es ? 'Mi perfil' : 'My profile'}</button>
          <button type="button" aria-pressed={activeSection === 'plus'} onClick={() => setSection('plus')}>NRN Plus</button>
        </div>
        {activeSection === 'plus' ? <PlusPanel membership={membership} lang={lang} /> : gameType && activeSection === 'stats' ? <PersonalStats token={membership.token} gameType={gameType} lang={lang} active={open && membership.authReady} onSignIn={() => void membership.refresh()} /> : gameType && activeSection === 'leagues' ? <Leagues key={gameType} gameType={gameType} token={membership.token} lang={lang} active={open && membership.authReady} onSignIn={() => void membership.refresh()} /> : <>
        {passwordUpdated && <p className="membership-success" role="status">{es ? 'Contraseña actualizada. Las demás sesiones se han cerrado.' : 'Password updated. Your other sessions have been signed out.'}</p>}
        <dl className="membership-profile-details">
          <div><dt>{es ? 'Nombre' : 'Name'}</dt><dd>{account.name || '—'}</dd></div>
          <div><dt>Email</dt><dd>{account.email}</dd></div>
        </dl>
        <section className="membership-security" aria-labelledby="membership-security-title">
          <h3 id="membership-security-title">{es ? 'Contraseña' : 'Password'}</h3>
          <p>{es ? 'Confirma el cambio con un código enviado a tu email. La nueva contraseña se usará en todos los juegos.' : 'Confirm the change with a code sent to your email. The new password will apply to every game.'}</p>
          {config.loginEnabled ? <button type="button" className="membership-secondary" onClick={() => { changeMode('reset'); setEmail(account.email); setSecurityOpen(true) }}>{account.hasPassword ? (es ? 'Cambiar contraseña' : 'Change password') : (es ? 'Crear contraseña' : 'Set a password')}</button> : <p>{es ? 'El cambio de contraseña no está disponible ahora.' : 'Password changes are currently unavailable.'}</p>}
        </section>
        <button type="button" className="membership-secondary" onClick={() => setSection('plus')}>{es ? 'Ver NRN Plus y estilos de mesa' : 'View NRN Plus and table styles'}</button>
        <div className="membership-actions">
          <button className="membership-secondary" disabled={busy || refreshing} onClick={async () => { setRefreshing(true); await membership.refresh(); setRefreshing(false) }}>{refreshing ? t.checking : t.refresh}</button>
          <button className="membership-text" disabled={busy} onClick={() => void membership.logout()}>{t.logout}</button>
        </div>
        </>}
      </> : <div id="membership-plus-sign-in" className={plusView ? 'membership-plus-sign-in' : undefined} hidden={plusView && !plusSignInOpen}>
        {!securityOpen && passwordEnabled && <div className="membership-tabs" role="group" aria-label={es ? 'Acceso a tu cuenta' : 'Account access'}>
          <button type="button" disabled={busy} aria-pressed={activeMode === 'password' || activeMode === 'code'} onClick={() => changeMode('password')}>{es ? 'Entrar' : 'Sign in'}</button>
          {config.loginEnabled && <button type="button" disabled={busy} aria-pressed={activeMode === 'register'} onClick={() => changeMode('register')}>{es ? 'Crear cuenta' : 'Create account'}</button>}
        </div>}
        {activeMode === 'reset' && (securityOpen ? <p className="membership-notice">{es ? 'Al guardar la nueva contraseña se cerrarán las demás sesiones, también en los otros juegos.' : 'Saving a new password will sign out your other sessions, including those in other games.'}</p> : <h3>{es ? 'Recuperar contraseña' : 'Reset your password'}</h3>)}
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
          <button className="membership-primary" disabled={busy} type="submit">{busy ? t.waiting : activeMode === 'reset' ? securityOpen ? (es ? 'Guardar contraseña' : 'Save password') : (es ? 'Guardar contraseña y entrar' : 'Save password and sign in') : t.verify}</button>
          <div className="membership-actions">
            <button className="membership-text" type="button" disabled={busy} onClick={() => { setSent(false); setCode(''); membership.clearError() }}>{es ? 'Volver al formulario' : 'Back to the form'}</button>
            <button className="membership-text" type="button" disabled={busy || !canResend} onClick={() => void send()}>{t.resend}</button>
          </div>
        </> : <>
          {activeMode === 'register' && <><label htmlFor="membership-name">{es ? 'Tu nombre' : 'Your name'}</label><input id="membership-name" name="nickname" autoComplete="nickname" maxLength={24} required value={name} onChange={event => setName(event.target.value)} /></>}
          <label htmlFor="membership-email">{t.email}</label>
          <input ref={emailInput} autoFocus={initialSection !== 'plus'} id="membership-email" type="email" name="username" autoComplete="username" maxLength={254} readOnly={securityOpen} value={email} onChange={event => setEmail(event.target.value)} placeholder="name@example.com" required />
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
      </div>}
      {formError && <p className="membership-error" role="alert">{formError}</p>}
      {error && error !== 'network' && error !== 'unavailable' && <p className="membership-error" role="alert">{errors[lang][error]}</p>}
      {!membership.storageAvailable && <p className="membership-notice">{t.storage}</p>}
      {identity === 'signed-out' && (!plusView || plusSignInOpen) && <p className="membership-footnote">{t.guest}</p>}
    </dialog>
  </>
}
