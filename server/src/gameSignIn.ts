import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { MembershipSession } from '../../shared/membership.js'
import { RateLimiter } from './security.js'

export const DEFAULT_GAME_ORIGINS = [
  'https://football.nrnplay.com',
  'https://conti.nrnplay.com',
  'https://pocha.nrnplay.com',
  'https://footballchampion.net',
  'https://nrnplay.com',
] as const
const DEVELOPMENT_GAME_ORIGINS = [
  'http://localhost:5173', 'http://localhost:5174',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
] as const
const CODE_LIFETIME = 60_000
const MAX_CODES = 1_000
const challengePattern = /^[A-Za-z0-9_-]{43}$/
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export class GameSignInError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code) }
}

/** Origin strings are exact: no paths, credentials, trailing slash or wildcard. */
export function validateGameOrigins(values: readonly string[], allowLocal = false): string[] {
  return [...new Set(values.map(value => {
    try {
      const url = new URL(value)
      const local = allowLocal && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
      if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:' && !local)) throw new Error()
      return value
    } catch { throw new Error('MEMBERSHIP_GAME_ORIGINS must contain exact HTTPS origins; local HTTP origins are development-only') }
  }))]
}

export function gameOriginsFromEnvironment(env: NodeJS.ProcessEnv): string[] {
  const development = env.NODE_ENV !== 'production' && env.RENDER !== 'true' && !env.RAILWAY_ENVIRONMENT_ID
  const values = env.MEMBERSHIP_GAME_ORIGINS === undefined
    ? [...DEFAULT_GAME_ORIGINS, ...(development ? DEVELOPMENT_GAME_ORIGINS : [])]
    : env.MEMBERSHIP_GAME_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)
  return validateGameOrigins(values, development)
}

type PendingCode = { origin: string; challenge: string; sourceTokenHash: string; expiresAt: number }

/** Short-lived transport proof only; this is never a second account database. */
export class GameSignInBroker {
  private readonly codes = new Map<string, PendingCode>()
  private readonly origins: ReadonlySet<string>
  private readonly authorizeIPs: RateLimiter
  private readonly authorizeSessions: RateLimiter
  private readonly exchangeIPs: RateLimiter
  constructor(
    origins: readonly string[],
    private readonly issueLinkedSession: (sourceTokenHash: string, previousToken: string | undefined, origin: string) => Promise<MembershipSession>,
    private readonly now: () => number = Date.now,
  ) {
    this.origins = new Set(origins)
    this.authorizeIPs = new RateLimiter(60, 60_000, now)
    this.authorizeSessions = new RateLimiter(30, 60_000, now)
    this.exchangeIPs = new RateLimiter(120, 60_000, now)
  }

  /** Mount before the app's general CORS so narrowly allowed preflights survive. */
  cors(issuerOrigins: readonly string[] = []) {
    const allowed = new Set([...this.origins, ...issuerOrigins])
    return (req: Request, res: Response, next: NextFunction) => {
      res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow')
      const origin = req.get('origin')
      if (!origin) { next(); return }
      res.vary('Origin')
      if (!allowed.has(origin)) { res.status(403).json({ error: 'invalid_origin' }); return }
      res.set('Access-Control-Allow-Origin', origin)
      if (req.method === 'OPTIONS') {
        if (req.get('access-control-request-method') !== 'POST') { res.status(403).json({ error: 'invalid_request' }); return }
        res.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
          .set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
          .set('Access-Control-Max-Age', '600').status(204).end()
        return
      }
      next()
    }
  }

  /** The caller must first authenticate the source session. Only its hash stays here. */
  authorize(sourceToken: string, origin: unknown, challenge: unknown, remoteAddress: string) {
    if (typeof origin !== 'string' || !this.origins.has(origin)) throw new GameSignInError('invalid_origin', 403)
    if (typeof challenge !== 'string' || !challengePattern.test(challenge)) throw new GameSignInError('invalid_request')
    const sourceTokenHash = digest(sourceToken)
    if (this.authorizeIPs.take(digest(remoteAddress)) || this.authorizeSessions.take(sourceTokenHash)) throw new GameSignInError('rate_limited', 429)
    const now = this.now()
    for (const [key, pending] of this.codes) if (pending.expiresAt <= now) this.codes.delete(key)
    if (this.codes.size >= MAX_CODES) throw new GameSignInError('rate_limited', 429)
    const code = randomBytes(32).toString('base64url'), expiresAt = now + CODE_LIFETIME
    this.codes.set(digest(code), { origin, challenge, sourceTokenHash, expiresAt })
    return { code, expiresAt }
  }

  async exchange(code: unknown, verifier: unknown, origin: string | undefined, remoteAddress: string, previousToken?: unknown): Promise<MembershipSession> {
    if (this.exchangeIPs.take(digest(remoteAddress))) throw new GameSignInError('rate_limited', 429)
    if (!origin || !this.origins.has(origin)) throw new GameSignInError('invalid_origin', 403)
    if (typeof code !== 'string' || !challengePattern.test(code) || typeof verifier !== 'string' || !verifierPattern.test(verifier)) throw new GameSignInError('invalid_code')
    if (previousToken !== undefined && (typeof previousToken !== 'string' || !challengePattern.test(previousToken))) throw new GameSignInError('invalid_request')
    const key = digest(code), pending = this.codes.get(key)
    if (!pending || pending.expiresAt <= this.now()) {
      this.codes.delete(key)
      throw new GameSignInError('invalid_code')
    }
    if (pending.origin !== origin) throw new GameSignInError('invalid_origin', 403)
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    if (!timingSafeEqual(Buffer.from(challenge), Buffer.from(pending.challenge))) throw new GameSignInError('invalid_code')
    // Claim before the async durable write: concurrent replays cannot issue tokens.
    this.codes.delete(key)
    return this.issueLinkedSession(pending.sourceTokenHash, previousToken, origin)
  }
}
