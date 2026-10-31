import type { Express } from 'express'

export interface RoomEntryVerifier {
  readonly siteKey: string
  verify(token: unknown): Promise<boolean>
}

/** Verifies outside the shared game/save queue, with bounded outbound work. */
export class TurnstileVerifier implements RoomEntryVerifier {
  private pending = 0
  constructor(
    readonly siteKey: string,
    private readonly secret: string,
    private readonly hostnames: readonly string[],
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async verify(token: unknown): Promise<boolean> {
    if (typeof token !== 'string' || !token.trim() || token.length > 2048 || this.pending >= 20) return false
    this.pending++
    try {
      const response = await this.fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: this.secret, response: token }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) return false
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || Array.isArray(result)) return false
      const value = result as Record<string, unknown>
      if (value.success !== true || value.action !== 'room_entry' || typeof value.hostname !== 'string' ||
          !this.hostnames.includes(value.hostname) || typeof value.challenge_ts !== 'string') return false
      const issued = Date.parse(value.challenge_ts)
      const age = this.now() - issued
      // Cloudflare enforces single use. Check scope and age as well as success.
      return Number.isFinite(issued) && age >= -30_000 && age <= 300_000
    } catch {
      // Never log a token, secret, response body or provider error.
      return false
    } finally { this.pending-- }
  }
}

export function turnstileFromEnvironment(env: NodeJS.ProcessEnv, origins: readonly string[]): TurnstileVerifier | undefined {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim()
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  if (!siteKey && !secret) return undefined
  if (!siteKey || !secret || !/^[\w-]{10,100}$/.test(siteKey) || !/^[\w-]{10,100}$/.test(secret)) {
    throw new Error('Both valid TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are required')
  }
  if (env.NODE_ENV === 'production' && (/^[123]x0{10}/.test(siteKey) || /^[123]x0{10}/.test(secret))) {
    throw new Error('Turnstile test keys are not allowed in production')
  }
  const hostnames = [...new Set(origins.map(origin => new URL(origin).hostname))]
  if (!hostnames.length) throw new Error('Turnstile requires explicit CLIENT_ORIGINS')
  return new TurnstileVerifier(siteKey, secret, hostnames)
}

export function registerSecurityConfig(app: Express, verifier?: RoomEntryVerifier) {
  app.get('/api/security/config', (_req, res) => res.set('Cache-Control', 'no-store').json({
    turnstileSiteKey: verifier?.siteKey ?? null,
  }))
}
