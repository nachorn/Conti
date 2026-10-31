import type { NextFunction, Request, Response } from 'express'

/** Bounded, process-local counters. Never trust a client-supplied forwarded IP. */
export class RateLimiter {
  private readonly entries = new Map<string, { count: number; expires: number }>()
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {}

  /** Returns zero when admitted, or the number of seconds until a retry. */
  take(key: string): number {
    const now = this.now()
    let entry = this.entries.get(key)
    if (entry && entry.expires <= now) { this.entries.delete(key); entry = undefined }
    if (!entry) {
      // Reclaim expired entries before enforcing the memory ceiling. Rejected
      // requests never extend a window or evict another client's counter.
      if (this.entries.size >= this.maxKeys) {
        for (const [id, value] of this.entries) if (value.expires <= now) this.entries.delete(id)
        if (this.entries.size >= this.maxKeys) return Math.ceil(this.windowMs / 1000)
      }
      entry = { count: 0, expires: now + this.windowMs }
      this.entries.set(key, entry)
    }
    if (entry.count >= this.limit) return Math.max(1, Math.ceil((entry.expires - now) / 1000))
    entry.count++
    return 0
  }
}

export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.set(SECURITY_HEADERS)
  next()
}

export function requestLimit(limiter: RateLimiter) {
  return (req: Request, res: Response, next: NextFunction) => {
    // req.ip honors only Express's explicitly configured trust-proxy policy.
    // Without one, a reverse proxy shares its peer budget conservatively.
    const retryAfter = limiter.take(req.ip ?? req.socket.remoteAddress ?? 'unknown')
    if (retryAfter) {
      res.set('Cache-Control', 'no-store').set('Retry-After', String(retryAfter))
        .status(429).json({ error: 'rate_limited' })
      return
    }
    next()
  }
}

export function allowedSocketOrigin(origin: string | undefined, origins: readonly string[]): boolean {
  // Non-browser clients can omit Origin. This check supplements seat tokens;
  // it is not authentication and does not stop a native client forging Origin.
  return origins.length === 0 || origin === undefined || origins.includes(origin)
}
