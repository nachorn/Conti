import type { DashboardSnapshot } from '@shared/dashboard'

export type AdminError = 'unauthorized' | 'expired' | 'unconfigured' | 'unavailable'
export type AdminPhase = 'checking' | 'locked' | 'unavailable' | 'unlocked' | 'logging-out' | 'logout-error'
export type AdminState = {
  phase: AdminPhase
  snapshot: DashboardSnapshot | null
  error: AdminError | null
  busy: boolean
  receivedAt: number
}
type AdminResponse = { ok: boolean; status: number; body: unknown }
const sessionConfirmed = (body: unknown) => typeof body === 'object' && body !== null && !Array.isArray(body) && 'ok' in body && body.ok === true

/** Admin cookies are scoped to the same-origin proxy; credentials never enter JS storage. */
export function adminFetch(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch) {
  if (!path.startsWith('/api/admin/')) throw new Error('Invalid admin endpoint')
  const headers = new Headers(init.headers)
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    headers.set('Content-Type', 'application/json')
    headers.set('X-Admin-Request', '1')
  }
  return fetcher(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' })
}

export function adminLoginFields(data: FormData) {
  const password = data.get('password')
  return { password: typeof password === 'string' ? password : '', remember: data.get('remember') === 'on' }
}

/** Coordinates restore/login/logout so an older request cannot reopen a locked dashboard. */
export class AdminSession {
  private state: AdminState = { phase: 'checking', snapshot: null, error: null, busy: false, receivedAt: 0 }
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
    this.publish({ phase: 'locked', snapshot: null, error: 'expired' })
  }
  private async request(path: string, init: RequestInit = {}): Promise<AdminResponse> {
    const controller = new AbortController()
    this.requests.add(controller)
    const timeout = setTimeout(() => controller.abort(), 10_000)
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
    if (response.status === 401) return 'unauthorized'
    const body = response.body as { error?: string } | null
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
          this.publish({ phase: 'locked', snapshot: null, error: error === 'unauthorized' ? (wasUnlocked ? 'expired' : null) : error })
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
  login = async (fields: ReturnType<typeof adminLoginFields>) => {
    if (this.state.busy || !fields.password || this.state.phase !== 'locked') return false
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
      this.publish({ phase: 'checking', busy: false })
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
    this.publish({ phase: 'logging-out', busy: true, snapshot: null, error: null })
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
