import { RateLimiter } from './security.js'

export type SecurityActivity = 'password_changed' | 'other_sessions_closed' | 'administration_opened'
type Language = 'en' | 'es'
export type SecurityNoticeSender = (email: string, activity: SecurityActivity, lang: Language) => Promise<void>

const MAX_IN_FLIGHT = 2
const MAX_PENDING = 24
const COOLDOWN_MS = 15 * 60_000
const HOUR_MS = 60 * 60_000
const ACCOUNT_PAGE = 'https://nrnplay.com/account'

export function securityNoticeEmail(activity: SecurityActivity, lang: Language) {
  const title = {
    password_changed: { es: 'Se cambió tu contraseña', en: 'Your password changed' },
    other_sessions_closed: { es: 'Se cerraron tus demás sesiones', en: 'Your other sessions were signed out' },
    administration_opened: { es: 'Se abrió Administración', en: 'Administration was opened' },
  }[activity][lang]
  const detail = lang === 'es'
    ? `Si no reconoces este cambio, abre ${ACCOUNT_PAGE} para revisar tu cuenta y cerrar las demás sesiones.`
    : `If you do not recognize this change, open ${ACCOUNT_PAGE} to review your account and sign out other sessions.`
  const site = lang === 'es' ? 'en NRN Play' : 'on NRN Play'
  return { subject: `${title} · NRN Play`, text: `${title} ${site}.\n\n${detail}` }
}

/** Independent, best-effort delivery so provider slowness cannot delay account operations. */
export class SecurityNotices {
  private readonly cooldown: RateLimiter
  private readonly hourly: RateLimiter
  private readonly waiting: { email: string; activity: SecurityActivity; lang: Language }[] = []
  private readonly active = new Set<Promise<void>>()
  private stopped = false
  private failures = 0

  constructor(private readonly send: SecurityNoticeSender | undefined, now: () => number) {
    this.cooldown = new RateLimiter(1, COOLDOWN_MS, now, 512)
    this.hourly = new RateLimiter(60, HOUR_MS, now, 1)
  }

  schedule(account: { id: string; email: string }, activity: SecurityActivity, lang: Language) {
    if (!this.send || this.stopped || this.waiting.length >= MAX_PENDING) return
    if (this.cooldown.take(`${activity}:${account.id}`) || this.hourly.take('security-notices')) return
    this.waiting.push({ email: account.email, activity, lang })
    this.deliver()
  }

  private deliver() {
    const send = this.send
    if (this.stopped || !send) return
    while (this.active.size < MAX_IN_FLIGHT) {
      const notice = this.waiting.shift()
      if (!notice) break
      const task = Promise.resolve().then(() => send(notice.email, notice.activity, notice.lang))
        .catch(() => { this.failures++ })
        .finally(() => { this.active.delete(task); this.deliver() })
      this.active.add(task)
    }
  }

  status() { return { pending: this.waiting.length + this.active.size, failures: this.failures } }

  stop(): Promise<void>[] {
    this.stopped = true
    this.waiting.length = 0
    return [...this.active]
  }
}
