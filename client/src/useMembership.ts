import { useCallback, useEffect, useRef, useState } from 'react'
import type { MembershipAccount, MembershipConfig, MembershipSession } from '@shared/membership'
import type { Lang } from './i18n'
import { isMembershipSession, isStripeCheckoutUrl, MEMBERSHIP_STORAGE_KEY, readMembershipSession, saveMembershipSession, type SavedMembershipSession } from './lib/membershipSession'
import { CURRENCY_PREFERENCE_KEY, isMembershipCurrency, preferredCurrency, readCurrencyPreference, saveCurrencyPreference, type MembershipCurrency } from '../lib/currency.js'

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')
const disabledConfig: MembershipConfig = { enabled: false, loginEnabled: false, checkoutEnabled: false, price: null, ads: { provider: 'disabled', publisherId: null } }
export type MembershipError = 'unavailable' | 'expired' | 'invalidEmail' | 'invalidCode' | 'invalidCredentials' | 'invalidName' | 'invalidPassword' | 'rateLimited' | 'network' | null

function localStorageOrNull() { try { return window.localStorage } catch { return null } }
class RequestError extends Error {
  constructor(readonly status: number, readonly code?: string) { super('Membership request failed') }
}
async function request<T>(path: string, token?: string | null, body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(`${API_URL}/api/membership/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', signal: controller.signal,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new RequestError(response.status, payload?.error)
    }
    return await response.json() as T
  } finally { window.clearTimeout(timer) }
}
function errorKind(error: unknown, context: 'general' | 'code' | 'credentials' = 'general'): MembershipError {
  if (!(error instanceof RequestError)) return 'network'
  if (error.code === 'invalid_email') return 'invalidEmail'
  if (error.code === 'invalid_name') return 'invalidName'
  if (error.code === 'invalid_password') return 'invalidPassword'
  if (error.code === 'invalid_credentials' || (context === 'credentials' && error.status === 401)) return 'invalidCredentials'
  if (error.status === 429) return 'rateLimited'
  if (error.code === 'invalid_code' || (context === 'code' && [400, 401, 403].includes(error.status))) return 'invalidCode'
  if (error.status === 401) return 'expired'
  return 'unavailable'
}

export function useMembership() {
  const [session, setSession] = useState<SavedMembershipSession | null>(() => readMembershipSession(localStorageOrNull()))
  const sessionRef = useRef(session)
  const [account, setAccount] = useState<MembershipAccount | null>(null)
  const [config, setConfig] = useState(disabledConfig)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MembershipError>(null)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const refreshSequence = useRef(0)
  const authSequence = useRef(0)
  const pendingAuth = useRef<number | null>(null)
  const registration = useRef<{ email: string; token: string } | null>(null)
  const [initialCurrency] = useState(() => readCurrencyPreference(localStorageOrNull()))
  const manualCurrency = useRef<MembershipCurrency | null>(initialCurrency)
  const [currency, setCurrency] = useState<MembershipCurrency>(() => preferredCurrency(initialCurrency, null, window.navigator.language))
  const [currencyPending, setCurrencyPending] = useState(!initialCurrency)

  const selectCurrency = (value: MembershipCurrency) => {
    if (!isMembershipCurrency(value)) return
    manualCurrency.current = value
    saveCurrencyPreference(localStorageOrNull(), value)
    setCurrency(value)
    setCurrencyPending(false)
  }

  useEffect(() => {
    if (!config.checkoutEnabled || manualCurrency.current) return
    const controller = new AbortController()
    let active = true
    setCurrencyPending(true)
    const timer = window.setTimeout(() => controller.abort(), 5_000)
    // This route belongs to the Vercel frontend, not the game API host.
    void fetch('/api/currency', { cache: 'no-store', signal: controller.signal })
      .then(async response => response.ok ? await response.json() as { currency?: unknown } : null)
      .then(result => {
        if (active) setCurrency(preferredCurrency(manualCurrency.current, result?.currency, window.navigator.language))
      })
      .catch(() => { /* The locale fallback and the manual selector stay available. */ })
      .finally(() => { window.clearTimeout(timer); if (active) setCurrencyPending(false) })
    return () => { active = false; controller.abort(); window.clearTimeout(timer) }
  }, [config.checkoutEnabled])

  const remember = useCallback((next: SavedMembershipSession | null) => {
    sessionRef.current = next
    setSession(next)
    setStorageAvailable(saveMembershipSession(localStorageOrNull(), next))
  }, [])

  const adoptSession = useCallback((value: unknown): boolean => {
    if (!isMembershipSession(value)) return false
    ++authSequence.current
    ++refreshSequence.current
    pendingAuth.current = null
    registration.current = null
    remember({ token: value.token, expiresAt: value.expiresAt })
    setAccount(value.account)
    setBusy(false)
    setError(null)
    return true
  }, [remember])

  const refresh = useCallback(async () => {
    const current = sessionRef.current
    const sequence = ++refreshSequence.current
    if (!current) { setAccount(null); return }
    if (current.expiresAt <= Date.now()) { remember(null); setAccount(null); setError('expired'); return }
    try {
      const result = await request<{ account: MembershipAccount; expiresAt: number }>('me', current.token)
      if (sequence !== refreshSequence.current || sessionRef.current?.token !== current.token) return
      setAccount(result.account)
      if (result.expiresAt !== current.expiresAt) remember({ token: current.token, expiresAt: result.expiresAt })
      setError(null)
    } catch (failure) {
      if (sequence !== refreshSequence.current || sessionRef.current?.token !== current.token) return
      setAccount(null)
      if (failure instanceof RequestError && failure.status === 401) remember(null)
      setError(errorKind(failure))
    }
  }, [remember])

  useEffect(() => {
    let active = true
    void request<MembershipConfig>('config').then(value => { if (active) setConfig(value) })
      .catch(() => { if (active) setConfig(disabledConfig) })
      .finally(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => { void refresh() }
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === CURRENCY_PREFERENCE_KEY) {
        const next = readCurrencyPreference(localStorageOrNull())
        manualCurrency.current = next
        if (next) { setCurrency(next); setCurrencyPending(false) }
        if (event.key) return
      }
      if (event.key && event.key !== MEMBERSHIP_STORAGE_KEY) return
      const next = readMembershipSession(localStorageOrNull())
      ++authSequence.current
      pendingAuth.current = null
      registration.current = null
      setBusy(false)
      sessionRef.current = next
      setSession(next)
      setAccount(null)
      void refresh()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('storage', onStorage)
    const timer = window.setInterval(onFocus, 60_000)
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onStorage); window.clearInterval(timer); ++refreshSequence.current; ++authSequence.current; registration.current = null }
  }, [refresh])

  const login = (email: string, lang: Lang) => requestCode('login', { email: email.trim(), lang })
  async function authenticate(path: string, body: unknown, context: 'code' | 'credentials') {
    if (pendingAuth.current !== null) return false
    const sequence = ++authSequence.current
    pendingAuth.current = sequence
    setBusy(true); setError(null)
    try {
      const value = await request<MembershipSession>(path, null, body)
      if (sequence !== authSequence.current) return false
      if (!isMembershipSession(value)) throw new RequestError(503)
      ++refreshSequence.current
      remember({ token: value.token, expiresAt: value.expiresAt })
      registration.current = null
      setAccount(value.account)
      return true
    } catch (failure) { if (sequence === authSequence.current) setError(errorKind(failure, context)); return false }
    finally { if (pendingAuth.current === sequence) pendingAuth.current = null; if (sequence === authSequence.current) setBusy(false) }
  }
  const verify = (email: string, code: string) => authenticate('verify', { email: email.trim(), code: code.trim() }, 'code')
  const verifyRegistration = (email: string, code: string) => {
    const pending = registration.current
    if (!pending || pending.email !== email.trim().toLowerCase()) { setError('invalidCode'); return Promise.resolve(false) }
    return authenticate('verify', { email: email.trim(), code: code.trim(), purpose: 'register', registrationToken: pending.token }, 'code')
  }
  const loginPassword = (email: string, password: string) => authenticate('password-login', { email: email.trim(), password }, 'credentials')
  const confirmPasswordReset = (email: string, code: string, password: string) => authenticate('password-reset/confirm', { email: email.trim(), code: code.trim(), password }, 'code')
  async function requestCode(path: string, body: unknown, received?: (value: unknown) => void) {
    if (pendingAuth.current !== null) return false
    const sequence = ++authSequence.current
    pendingAuth.current = sequence
    setBusy(true); setError(null)
    try {
      const value = await request(path, null, body)
      if (sequence !== authSequence.current) return false
      received?.(value)
      return true
    }
    catch (failure) { if (sequence === authSequence.current) setError(errorKind(failure)); return false }
    finally { if (pendingAuth.current === sequence) pendingAuth.current = null; if (sequence === authSequence.current) setBusy(false) }
  }
  const register = (name: string, email: string, password: string, lang: Lang) => {
    registration.current = null
    return requestCode('register', { name: name.trim(), email: email.trim(), password, lang }, value => {
      const response = value as { ok?: unknown; registrationToken?: unknown } | null
      if (response?.ok !== true || typeof response.registrationToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(response.registrationToken)) throw new RequestError(503)
      // Bind this email-code confirmation to this registration attempt. Never persist the proof.
      registration.current = { email: email.trim().toLowerCase(), token: response.registrationToken }
    })
  }
  const requestPasswordReset = (email: string, lang: Lang) => requestCode('password-reset', { email: email.trim(), lang })
  const logout = async () => {
    const sequence = ++authSequence.current
    pendingAuth.current = null
    registration.current = null
    const token = sessionRef.current?.token
    setBusy(true); setError(null)
    try {
      if (token) await request('logout', token, {})
      if (sequence !== authSequence.current) return
      ++refreshSequence.current
      remember(null); setAccount(null)
    } catch (failure) {
      if (sequence !== authSequence.current) return
      // A rejected/expired session can always be forgotten; network failures
      // stay visible so the user knows server-side sign-out is unconfirmed.
      if (failure instanceof RequestError && failure.status === 401) { remember(null); setAccount(null) }
      else setError(errorKind(failure))
    } finally { if (sequence === authSequence.current) setBusy(false) }
  }
  const checkout = async (selectedCurrency: MembershipCurrency) => {
    const token = sessionRef.current?.token
    if (!token || !config.checkoutEnabled || account?.adFree || !isMembershipCurrency(selectedCurrency)) return
    setBusy(true); setError(null)
    try {
      const result = await request<{ url: string }>('checkout', token, { currency: selectedCurrency })
      if (sessionRef.current?.token !== token) return
      if (!isStripeCheckoutUrl(result.url)) throw new RequestError(503)
      window.location.assign(result.url)
    } catch (failure) {
      if (failure instanceof RequestError && failure.status === 401) { remember(null); setAccount(null) }
      setError(errorKind(failure))
    } finally { setBusy(false) }
  }

  return { token: session?.token ?? null, account, config, loaded, busy, error, storageAvailable, currency, currencyPending, selectCurrency, login, verify, verifyRegistration, loginPassword, register, requestPasswordReset, confirmPasswordReset, logout, checkout, refresh, adoptSession, clearError: () => setError(null) }
}
export type MembershipController = ReturnType<typeof useMembership>
