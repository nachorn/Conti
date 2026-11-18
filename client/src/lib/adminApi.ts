import type { DashboardSnapshot } from '@shared/dashboard'
import { isCookieAccountKey } from './accountTransport.ts'

export type AdminError = 'unauthorized' | 'expired' | 'unconfigured' | 'unavailable' | 'rateLimited' | 'invalidCode'
export type AdminPhase = 'checking' | 'locked' | 'unavailable' | 'unlocked' | 'logging-out' | 'logout-error'
export type AdminState = {
  phase: AdminPhase
  snapshot: DashboardSnapshot | null
  error: AdminError | null
  busy: boolean
  receivedAt: number
  codeSent: boolean
}
type AdminResponse = { ok: boolean; status: number; body: unknown }
const sessionConfirmed = (body: unknown) => typeof body === 'object' && body !== null && !Array.isArray(body) && 'ok' in body && body.ok === true

interface AccountScope { token: () => string | null; onUnauthorized: () => void; onProofExpired: () => void; denied: boolean; requests: Set<AbortController> }
let accountScope: AccountScope | null = null
let accountMode = false

/** Account administration sends the current account token and the isolated browser proof. */
export function configureAdminToken(token: () => string | null, onUnauthorized: () => void = () => {}, onProofExpired: () => void = () => {}) {
  accountMode = true
  const scope: AccountScope = { token, onUnauthorized, onProofExpired, denied: false, requests: new Set() }
  for (const request of accountScope?.requests ?? []) request.abort()
  accountScope = scope
  return () => {
    for (const request of scope.requests) request.abort()
    scope.requests.clear()
    if (accountScope === scope) accountScope = null
  }
}

/** Both credentials stay on the portal's same-origin admin API. */
export function adminFetch(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  if (!path.startsWith('/api/admin/')) throw new Error('Invalid admin endpoint')
  const headers = new Headers(init.headers)
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('Content-Type', 'application/json')
    headers.set('X-Admin-Request', '1')
  }
  if (!accountMode) return fetcher(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' })
  const scope = accountScope, token = scope && !scope.denied ? scope.token() : null
  if (!scope || !token || (!isCookieAccountKey(token) && !/^[A-Za-z0-9_-]{43}$/.test(token))) return Promise.reject(new Error('Account authorization required'))
  headers.delete('Authorization')
  if (isCookieAccountKey(token)) headers.set('X-NRN-Portal', '1')
  else headers.set('Authorization', `Bearer ${token}`)
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (init.signal?.aborted) controller.abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  scope.requests.add(controller)
  return fetcher(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async response => {
    if (controller.signal.aborted || accountScope !== scope || scope.token() !== token) throw new Error('Account authorization changed')
    const readOnly = !init.method || ['GET', 'HEAD'].includes(init.method.toUpperCase())
    const body = response.status === 401 || response.status === 403 && !readOnly
      ? await response.clone().json().catch(() => null) as { error?: string } | null : null
    if (controller.signal.aborted || accountScope !== scope || scope.token() !== token) throw new Error('Account authorization changed')
    if (response.status === 401 && body?.error === 'verification_required') scope.onProofExpired()
    else if ((response.status === 401 || response.status === 403 && (readOnly || body?.error !== 'invalid_request')) && !scope.denied) {
      scope.denied = true
      for (const request of scope.requests) request.abort()
      scope.onUnauthorized()
    }
    return response
  }).finally(() => { scope.requests.delete(controller); init.signal?.removeEventListener('abort', abort) })
}

export function adminLoginFields(data: FormData) {
  const password = data.get('password')
  return { password: typeof password === 'string' ? password : '', remember: data.get('remember') === 'on' }
}

/** Coordinates restore/login/logout so an older request cannot reopen a locked dashboard. */
export class AdminSession {
  private state: AdminState = { phase: 'checking', snapshot: null, error: null, busy: false, receivedAt: 0, codeSent: false }
  private listeners = new Set<() => void>()
  private generation = 0
  private requests = new Set<AbortController>()
  private fetcher: typeof fetch

  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher }
  getState = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(update: Partial<AdminState>) {
    this.state = { ...this.state, ...update }
    for (const listener of this.listeners) listener()
  }
  cancel = () => {
    this.generation++
    for (const request of this.requests) request.abort()
    this.requests.clear()
    this.publish({ busy: false })
  }
  expire = () => {
    if (this.state.phase !== 'unlocked') return
    this.cancel()
    this.publish({ phase: 'locked', snapshot: null, error: 'expired', codeSent: false })
  }
  private async request(path: string, init: RequestInit = {}): Promise<AdminResponse> {
    const controller = new AbortController()
    this.requests.add(controller)
    const timeout = setTimeout(() => controller.abort(), path === '/api/admin/session/challenge' ? 35_000 : 10_000)
    try {
      const response = await adminFetch(path, { ...init, signal: controller.signal }, this.fetcher)
      const body: unknown = await response.json().catch(error => {
        if (controller.signal.aborted) throw error
        return null
      })
      return { ok: response.ok, status: response.status, body }
    }
    finally { clearTimeout(timeout); this.requests.delete(controller) }
  }
  private failure(response: AdminResponse): AdminError {
    if (response.status === 401 || response.status === 403) return 'unauthorized'
    if (response.status === 429) return 'rateLimited'
    const body = response.body as { error?: string } | null
    if (body?.error === 'invalid_code') return 'invalidCode'
    return body?.error === 'dashboard_not_configured' ? 'unconfigured' : 'unavailable'
  }
  refresh = async () => {
    if (this.state.busy || !['checking', 'unavailable', 'unlocked'].includes(this.state.phase)) return
    const generation = this.generation
    const wasUnlocked = this.state.phase === 'unlocked'
    this.publish({ busy: true })
    try {
      const response = await this.request('/api/admin/dashboard')
      if (generation !== this.generation) return
      if (!response.ok) {
        const error = this.failure(response)
        if (error === 'unauthorized' || error === 'unconfigured') {
          this.publish({ phase: 'locked', snapshot: null, codeSent: false, error: error === 'unauthorized' ? (wasUnlocked ? 'expired' : null) : error })
        } else throw new Error('Dashboard unavailable')
        return
      }
      const snapshot = response.body as DashboardSnapshot | null
      if (!snapshot || !Array.isArray(snapshot.rooms) || !snapshot.summary) throw new Error('Invalid dashboard response')
      if (generation === this.generation) this.publish({ phase: 'unlocked', snapshot, receivedAt: Date.now(), error: null })
    } catch {
      if (generation === this.generation) this.publish({ phase: wasUnlocked ? 'unlocked' : 'unavailable', error: 'unavailable' })
    } finally {
      if (generation === this.generation) this.publish({ busy: false })
    }
  }
  sendCode = async (lang: 'en' | 'es') => {
    if (this.state.busy || this.state.phase !== 'locked') return false
    const generation = this.generation
    this.publish({ busy: true, error: null })
    try {
      const response = await this.request('/api/admin/session/challenge', { method: 'POST', body: JSON.stringify({ lang }) })
      if (generation !== this.generation) return false
      if (!response.ok) { this.publish({ error: this.failure(response) }); return false }
      if (!sessionConfirmed(response.body)) throw new Error('Invalid challenge response')
      this.publish({ codeSent: true })
      return true
    } catch {
      if (generation === this.generation) this.publish({ error: 'unavailable' })
      return false
    } finally {
      if (generation === this.generation) this.publish({ busy: false })
    }
  }
  login = (fields: ReturnType<typeof adminLoginFields>) => fields.password ? this.establish(fields) : Promise.resolve(false)
  verifyCode = (code: string) => this.state.codeSent && /^\d{6}$/.test(code) ? this.establish({ code }) : Promise.resolve(false)
  private async establish(fields: ReturnType<typeof adminLoginFields> | { code: string }) {
    if (this.state.busy || this.state.phase !== 'locked') return false
    this.cancel()
    const generation = this.generation
    this.publish({ busy: true, error: null })
    let created = false
    try {
      const response = await this.request('/api/admin/session', { method: 'POST', body: JSON.stringify(fields) })
      if (generation !== this.generation) return false
      if (!response.ok) {
        const error = this.failure(response)
        this.publish({ error })
        return false
      }
      if (!sessionConfirmed(response.body)) throw new Error('Invalid login response')
      created = true
      this.publish({ phase: 'checking', busy: false, codeSent: false })
      await this.refresh()
    } catch {
      if (generation === this.generation) this.publish({ error: 'unavailable' })
    } finally {
      if (generation === this.generation) this.publish({ busy: false })
    }
    return created
  }
  logout = async () => {
    if (this.state.phase === 'logging-out') return
    this.cancel()
    const generation = this.generation
    this.publish({ phase: 'logging-out', busy: true, snapshot: null, error: null, codeSent: false })
    try {
      const response = await this.request('/api/admin/session', { method: 'DELETE' })
      if (generation !== this.generation) return
      if (!response.ok || !sessionConfirmed(response.body)) throw new Error('Logout unavailable')
      this.publish({ phase: 'locked', error: null })
    } catch {
      if (generation === this.generation) this.publish({ phase: 'logout-error' })
    } finally {
      if (generation === this.generation) this.publish({ busy: false })
    }
  }
}
