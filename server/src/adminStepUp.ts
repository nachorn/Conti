import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { EmailSender } from './membershipEmail.js'
import { RateLimiter } from './security.js'

export const ADMIN_PROOF_SESSION_MS = 30 * 60_000
const CODE_MS = 10 * 60_000
const RESEND_MS = 45_000
const MAX_ATTEMPTS = 5
const MAX_SESSIONS_PER_ACCOUNT = 4
const opaqueToken = /^[A-Za-z0-9_-]{43}$/
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

type Identity = { id: string; email: string; eligible: boolean }
type Challenge = { tokenHash: string; salt: string; codeHash: Buffer; expiresAt: number; attempts: number; sent: boolean }
type Proof = { accountId: string; tokenHash: string; expiresAt: number }
export type AdminProofDenial = {
  error: 'unauthorized' | 'forbidden' | 'verification_required'
  status: 401 | 403
}

export class AdminStepUpError extends Error {
  constructor(readonly code: string, readonly status: number, readonly retryAfter?: number) { super(code) }
}

/** Ephemeral proofs are never part of the account snapshot or shared with game sign-in. */
export class AdminStepUp {
  private readonly challenges = new Map<string, Challenge>()
  private readonly proofs = new Map<string, Proof>()
  private readonly sendCooldown: RateLimiter
  private readonly sendQuota: RateLimiter
  private delivering = 0

  constructor(
    private readonly lookup: (tokenHash: string) => Identity | null,
    private readonly secret: string,
    private readonly send: EmailSender | undefined,
    private readonly now: () => number,
  ) {
    this.sendCooldown = new RateLimiter(1, RESEND_MS, now, 100)
    this.sendQuota = new RateLimiter(3, 15 * 60_000, now, 100)
  }

  private identity(token: string) {
    const tokenHash = opaqueToken.test(token) ? digest(token) : ''
    const account = tokenHash ? this.lookup(tokenHash) : null
    return { tokenHash, account }
  }

  private requireIdentity(token: string) {
    const { tokenHash, account } = this.identity(token)
    if (!account) throw new AdminStepUpError('unauthorized', 401)
    if (!account.eligible) throw new AdminStepUpError('forbidden', 403)
    return { tokenHash, account }
  }

  private hashCode(accountId: string, tokenHash: string, salt: string, code: string) {
    return createHmac('sha256', this.secret).update(`nrn-admin-code:v1\0${accountId}\0${tokenHash}\0${salt}\0${code}`).digest()
  }

  async challenge(token: string, lang: 'en' | 'es') {
    const { tokenHash, account } = this.requireIdentity(token)
    if (!this.send) throw new AdminStepUpError('email_not_configured', 503)
    if (this.delivering >= 4) throw new AdminStepUpError('rate_limited', 429, 60)
    const retryAfter = this.sendCooldown.take(account.id) || this.sendQuota.take(account.id)
    if (retryAfter) throw new AdminStepUpError('rate_limited', 429, retryAfter)
    const code = String(randomInt(1_000_000)).padStart(6, '0')
    const salt = randomBytes(16).toString('hex')
    const challenge: Challenge = { tokenHash, salt, codeHash: this.hashCode(account.id, tokenHash, salt, code), expiresAt: this.now() + CODE_MS, attempts: 0, sent: false }
    this.challenges.set(account.id, challenge)
    this.delivering++
    try {
      await this.send(account.email, code, lang, 'admin')
      challenge.sent = true
    } catch {
      if (this.challenges.get(account.id) === challenge) this.challenges.delete(account.id)
      throw new AdminStepUpError('email_unavailable', 503)
    } finally { this.delivering-- }
  }

  confirm(token: string, code: unknown): string {
    const { tokenHash, account } = this.requireIdentity(token)
    const challenge = this.challenges.get(account.id), now = this.now()
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || !challenge?.sent ||
        challenge.tokenHash !== tokenHash || challenge.expiresAt <= now || challenge.attempts >= MAX_ATTEMPTS) {
      throw new AdminStepUpError('invalid_code', 400)
    }
    challenge.attempts++
    if (!timingSafeEqual(challenge.codeHash, this.hashCode(account.id, tokenHash, challenge.salt, code))) {
      throw new AdminStepUpError('invalid_code', 400)
    }
    this.challenges.delete(account.id)
    const active: string[] = []
    for (const [key, proof] of this.proofs) {
      if (proof.expiresAt <= now || proof.tokenHash === tokenHash) this.proofs.delete(key)
      else if (proof.accountId === account.id) active.push(key)
    }
    for (const key of active.slice(0, Math.max(0, active.length - MAX_SESSIONS_PER_ACCOUNT + 1))) this.proofs.delete(key)
    const value = randomBytes(32).toString('base64url')
    this.proofs.set(digest(value), { accountId: account.id, tokenHash, expiresAt: now + ADMIN_PROOF_SESSION_MS })
    return value
  }

  verify(token: string, cookie: string): AdminProofDenial | null {
    const { tokenHash, account } = this.identity(token)
    if (!account) return { error: 'unauthorized', status: 401 }
    if (!account.eligible) return { error: 'forbidden', status: 403 }
    const proof = opaqueToken.test(cookie) ? this.proofs.get(digest(cookie)) : undefined
    if (!proof || proof.accountId !== account.id || proof.tokenHash !== tokenHash || proof.expiresAt <= this.now()) {
      return { error: 'verification_required', status: 401 }
    }
    return null
  }

  revoke(cookie: string) {
    if (opaqueToken.test(cookie)) this.proofs.delete(digest(cookie))
  }
}
