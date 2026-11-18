import type { Express, Request, Response, NextFunction } from 'express'
import { AdminAuth } from './adminAuth.js'
import { createFootballAdminClient, type FootballAdminClient } from './footballAdmin.js'
import type { MembershipService } from './membership.js'
import type { GameRepository } from './recovery.js'
import { RateLimiter, requestLimit } from './security.js'
import type { AdminAccountsResponse, AdminOverview } from '../../shared/platformAdmin.js'

export function registerPlatformAdmin(app: Express, options: {
  key?: string; origins?: string[]; membership?: MembershipService; repository: GameRepository
  isHealthy: () => boolean; football?: FootballAdminClient
}) {
  const auth = new AdminAuth(options.key, options.origins, Date.now, options.membership?.adminAccountVerifier())
  const football = options.football ?? createFootballAdminClient({ dashboardKey: options.key })
  const limit = requestLimit(new RateLimiter(60, 60_000))
  const guard = (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store').set('X-Robots-Tag', 'noindex, nofollow')
    if (!auth.configured) { res.status(503).json({ error: 'dashboard_not_configured' }); return }
    if (!options.isHealthy() || !options.membership?.isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
    const access = auth.access(req)
    if (!access.method) { res.status(access.status).json({ error: access.error }); return }
    limit(req, res, next)
  }
  app.get('/api/admin/overview', guard, async (_req, res) => {
    try {
      const accounts = options.membership!.getAdminAccountSummary(), games = options.repository.getAdminGameSummaries()
      const result: AdminOverview = { generatedAt: Date.now(), accounts, games, football: await football.read() }
      if (!options.isHealthy() || !options.membership?.isHealthy()) { res.status(503).json({ error: 'server_unavailable' }); return }
      res.json(result)
    } catch { res.status(503).json({ error: 'server_unavailable' }) }
  })
  app.get('/api/admin/accounts', guard, (req, res) => {
    const query = req.query.q ?? '', offset = req.query.offset ?? '0', limit = req.query.limit ?? '50'
    if (typeof query !== 'string' || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query) ||
      typeof offset !== 'string' || !/^\d{1,9}$/.test(offset) || typeof limit !== 'string' || !/^\d{1,3}$/.test(limit) || Number(limit) === 0) {
      res.status(400).json({ error: 'invalid_request' }); return
    }
    try {
      const listed = options.membership!.listAdminAccounts(query, Number(offset), Math.min(100, Number(limit)))
      const result: AdminAccountsResponse = { generatedAt: Date.now(), total: listed.total, filtered: listed.filtered,
        offset: listed.offset, limit: listed.limit, accounts: listed.accounts.map(account => {
          const stats = options.repository.getPersonalStats(account.id, 0)
          return { id: account.id, name: account.name, email: account.email, createdAt: account.createdAt,
            plus: { active: account.plus.active, source: account.plus.source, expiresAt: account.plus.expiresAt },
            stats: { continental: stats.byGame.continental, pocha: stats.byGame.pocha } }
        }) }
      res.json(result)
    } catch { res.status(503).json({ error: 'server_unavailable' }) }
  })
  app.get('/api/admin/leagues', guard, (req, res) => {
    const q = req.query.q ?? '', gameType = req.query.gameType, status = req.query.status ?? 'all'
    const offset = req.query.offset ?? '0', size = req.query.limit ?? '25'
    if (typeof q !== 'string' || q.length > 100 || /[\u0000-\u001f\u007f]/.test(q) ||
      gameType !== undefined && gameType !== 'continental' && gameType !== 'pocha' ||
      status !== 'all' && status !== 'active' && status !== 'closed' ||
      typeof offset !== 'string' || !/^\d{1,9}$/.test(offset) || typeof size !== 'string' || !/^\d{1,3}$/.test(size) || Number(size) === 0) {
      res.status(400).json({ error: 'invalid_request' }); return
    }
    try {
      res.json({ generatedAt: Date.now(), ...options.repository.listAdminLeagues({ q, gameType, status, offset: Number(offset), limit: Math.min(50, Number(size)) }) })
    } catch { res.status(503).json({ error: 'server_unavailable' }) }
  })
  app.get('/api/admin/leagues/:id', guard, (req, res) => {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(req.params.id) || ['__proto__', 'prototype', 'constructor'].includes(req.params.id)) {
      res.status(400).json({ error: 'invalid_request' }); return
    }
    try {
      const league = options.repository.getAdminLeagueDetail(req.params.id)
      if (!league) { res.status(404).json({ error: 'league_not_found' }); return }
      res.json({ generatedAt: Date.now(), league })
    } catch { res.status(503).json({ error: 'server_unavailable' }) }
  })
}
