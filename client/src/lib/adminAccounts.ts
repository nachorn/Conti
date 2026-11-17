import type { AdminAccount, AdminAccountsResponse } from '@shared/platformAdmin'
import { adminFetch } from './adminApi.ts'

export type GiftDuration = '30d' | 'year' | 'permanent'
export type AccountsError = 'load' | 'save' | 'active' | 'invalid' | null
interface AccountsState { data: AdminAccountsResponse | null; loading: boolean; savingId: string | null; error: AccountsError; saved: boolean }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const time = (value: unknown): value is number | null => value === null || count(value)
function stats(value: unknown): boolean {
  return object(value) && [value.played, value.wins, value.draws, value.losses].every(count) &&
    value.played === Number(value.wins) + Number(value.draws) + Number(value.losses) && typeof value.winRate === 'number' && Number.isFinite(value.winRate) && value.winRate >= 0 && value.winRate <= 100
}
/** Select the public admin contract; private or unexpected account fields never reach UI state. */
export function readAdminAccounts(raw: unknown): AdminAccountsResponse | null {
  if (!object(raw) || !count(raw.generatedAt) || !count(raw.total) || !count(raw.filtered) || raw.filtered > raw.total || !count(raw.offset) ||
    !count(raw.limit) || raw.limit < 1 || raw.limit > 100 || !Array.isArray(raw.accounts) || raw.accounts.length > raw.limit) return null
  const accounts: AdminAccount[] = []
  for (const value of raw.accounts) {
    if (!object(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.id) ||
      !(value.name === null || typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 24) ||
      typeof value.email !== 'string' || value.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) || !count(value.createdAt) ||
      !object(value.plus) || typeof value.plus.active !== 'boolean' || ![null, 'gift', 'purchase'].includes(value.plus.source as null) || !time(value.plus.expiresAt) ||
      !object(value.stats) || !stats(value.stats.continental) || !stats(value.stats.pocha)) return null
    const totals = (value: unknown) => {
      const item = value as AdminAccount['stats']['continental']
      return { played: item.played, wins: item.wins, draws: item.draws, losses: item.losses, winRate: item.winRate }
    }
    accounts.push({ id: value.id, name: value.name as string | null, email: value.email, createdAt: value.createdAt,
      plus: { active: value.plus.active, source: value.plus.source as AdminAccount['plus']['source'], expiresAt: value.plus.expiresAt as number | null },
      stats: { continental: totals(value.stats.continental), pocha: totals(value.stats.pocha) } })
  }
  if (new Set(accounts.map(account => account.id)).size !== accounts.length) return null
  return { generatedAt: raw.generatedAt, total: raw.total, filtered: raw.filtered, offset: raw.offset, limit: raw.limit, accounts }
}
export function quickGiftCommand(account: AdminAccount, duration: GiftDuration, now = Date.now()) {
  if (account.plus.active) throw new Error('active')
  if (!['30d', 'year', 'permanent'].includes(duration) || !Number.isSafeInteger(now) || now <= 0) throw new Error('invalid')
  return { email: account.email, expiresAt: duration === 'permanent' ? null : now + (duration === '30d' ? 30 : 365) * 86_400_000 }
}

/** Query cancellation never retries a mutation, and stale responses cannot restore an expired panel. */
export class AdminAccountsController {
  private state: AccountsState = { data: null, loading: false, savingId: null, error: null, saved: false }
  private readonly listeners = new Set<() => void>()
  private sequence = 0
  private mutationSequence = 0
  private read: AbortController | null = null
  private write: AbortController | null = null
  private query = ''
  private offset = 0
  private readonly options: { onSessionExpired: () => void; onSaved?: () => void; request?: typeof fetch; now?: () => number }
  constructor(options: { onSessionExpired: () => void; onSaved?: () => void; request?: typeof fetch; now?: () => number }) { this.options = options }
  getState = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(update: Partial<AccountsState>) {
    this.state = { ...this.state, ...update }
    for (const listener of this.listeners) listener()
  }
  private async request(path: string, controller: AbortController, init: RequestInit = {}) {
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await adminFetch(path, { ...init, signal: controller.signal }, this.options.request)
      const body: unknown = await response.json().catch(() => null)
      return { response, body }
    } finally { clearTimeout(timer) }
  }
  private expired() {
    this.sequence++; this.mutationSequence++; this.read?.abort(); this.write?.abort()
    this.read = null; this.write = null
    this.publish({ data: null, loading: false, savingId: null, error: null, saved: false })
    this.options.onSessionExpired()
  }
  load = async (query = this.query, offset = this.offset) => {
    this.query = query.trim().slice(0, 100); this.offset = Math.max(0, Math.floor(offset))
    const sequence = ++this.sequence
    this.read?.abort()
    const controller = new AbortController(); this.read = controller
    this.publish({ data: null, loading: true, error: null })
    const search = new URLSearchParams({ q: this.query, offset: String(this.offset), limit: '50' })
    try {
      const { response, body } = await this.request(`/api/admin/accounts?${search}`, controller)
      if (sequence !== this.sequence) return
      if (controller.signal.aborted) throw new Error('Unavailable')
      if (response.status === 401) { this.expired(); return }
      const data = response.ok ? readAdminAccounts(body) : null
      if (!data) throw new Error('Unavailable')
      this.publish({ data, error: null })
    } catch { if (sequence === this.sequence) this.publish({ error: 'load' }) }
    finally { if (sequence === this.sequence) { this.publish({ loading: false }); this.read = null } }
  }
  grant = async (accountId: string, duration: GiftDuration): Promise<boolean> => {
    if (this.write) return false
    const account = this.state.data?.accounts.find(item => item.id === accountId)
    if (!account) { this.publish({ error: 'invalid' }); return false }
    let command: ReturnType<typeof quickGiftCommand>
    try { command = quickGiftCommand(account, duration, this.options.now?.() ?? Date.now()) }
    catch { this.publish({ error: account.plus.active ? 'active' : 'invalid' }); return false }
    const controller = new AbortController(), sequence = ++this.mutationSequence
    this.write = controller; this.publish({ savingId: accountId, error: null, saved: false })
    try {
      const { response, body } = await this.request('/api/admin/memberships/grant', controller, { method: 'POST', body: JSON.stringify(command) })
      if (sequence !== this.mutationSequence) return false
      if (controller.signal.aborted) throw new Error('Unconfirmed')
      if (response.status === 401) { this.expired(); return false }
      if (!response.ok || !object(body) || body.ok !== true) throw new Error('Unconfirmed')
      this.publish({ data: null, saved: true })
      this.options.onSaved?.()
      await this.load() // Exactly one GET after confirmation; never repeat the POST.
      return true
    } catch { if (sequence === this.mutationSequence) this.publish({ data: null, error: 'save' }); return false }
    finally { if (sequence === this.mutationSequence) { this.write = null; this.publish({ savingId: null }) } }
  }
  cancel = () => {
    this.sequence++; this.mutationSequence++; this.read?.abort(); this.write?.abort()
    this.read = null; this.write = null
    this.publish({ loading: false, savingId: null })
  }
}
