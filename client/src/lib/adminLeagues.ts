import type { AdminLeagueDetail, AdminLeagueSummary, AdminLeaguesResponse } from '@shared/platformAdmin'
import { adminFetch } from './adminApi.ts'

export type LeagueFilters = { q: string; gameType: '' | 'continental' | 'pocha'; status: 'all' | 'active' | 'closed'; offset: number }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0
const time = (value: unknown): value is number => count(value) && Number(value) <= 8_640_000_000_000_000
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
function readSummary(raw: unknown): AdminLeagueSummary | null {
  if (!object(raw) || !id(raw.id) || !text(raw.name, 60) || !text(raw.ownerName, 24) || !['continental', 'pocha'].includes(String(raw.gameType)) ||
    !time(raw.createdAt) || !(raw.closedAt === null || time(raw.closedAt) && raw.closedAt >= raw.createdAt) ||
    !count(raw.minGames) || raw.minGames < 1 || raw.minGames > 50 || !count(raw.memberCount) || raw.memberCount < 1 || raw.memberCount > 200 || !count(raw.gameCount)) return null
  return { id: raw.id, name: raw.name, gameType: raw.gameType as AdminLeagueSummary['gameType'], ownerName: raw.ownerName,
    createdAt: raw.createdAt, closedAt: raw.closedAt as number | null, minGames: raw.minGames, memberCount: raw.memberCount, gameCount: raw.gameCount }
}
/** Rebuild the admin contract: invitation codes, account IDs and unknown fields are discarded. */
export function readAdminLeagues(raw: unknown): AdminLeaguesResponse | null {
  if (!object(raw) || !time(raw.generatedAt) || !count(raw.total) || !count(raw.filtered) || raw.filtered > raw.total || !count(raw.offset) ||
    !count(raw.limit) || raw.limit < 1 || raw.limit > 50 || !Array.isArray(raw.leagues) || raw.leagues.length > raw.limit) return null
  const leagues: AdminLeagueSummary[] = []
  for (const rawLeague of raw.leagues) { const league = readSummary(rawLeague); if (!league) return null; leagues.push(league) }
  if (new Set(leagues.map(league => league.id)).size !== leagues.length) return null
  return { generatedAt: raw.generatedAt, total: raw.total, filtered: raw.filtered, offset: raw.offset, limit: raw.limit, leagues }
}
export function readAdminLeagueDetail(raw: unknown): AdminLeagueDetail | null {
  if (!object(raw) || !time(raw.generatedAt) || !object(raw.league)) return null
  const value = raw.league, summary = readSummary(value)
  if (!summary || value.ratingSystem !== 'trueskill' || !Array.isArray(value.standings) || value.standings.length !== summary.memberCount ||
    !Array.isArray(value.recentGames) || value.recentGames.length > 50 || value.recentGames.length > summary.gameCount) return null
  const standings: AdminLeagueDetail['standings'] = [], recentGames: AdminLeagueDetail['recentGames'] = []
  for (const row of value.standings) {
    if (!object(row) || !id(row.memberId) || !text(row.name, 24) || !(row.rank === null || count(row.rank) && row.rank > 0 && row.rank <= summary.memberCount) ||
      typeof row.rating !== 'number' || !Number.isFinite(row.rating) || ![row.played, row.wins, row.draws, row.losses].every(count) ||
      row.played !== Number(row.wins) + Number(row.draws) + Number(row.losses) || Number(row.played) > summary.gameCount ||
      typeof row.winRate !== 'number' || !Number.isFinite(row.winRate) || row.winRate < 0 || row.winRate > 100 ||
      typeof row.provisional !== 'boolean' || typeof row.isOwner !== 'boolean' || !time(row.joinedAt) || row.joinedAt < summary.createdAt) return null
    standings.push({ memberId: row.memberId, name: row.name, rank: row.rank as number | null, rating: row.rating,
      played: Number(row.played), wins: Number(row.wins), draws: Number(row.draws), losses: Number(row.losses), winRate: row.winRate,
      provisional: row.provisional, joinedAt: row.joinedAt, isOwner: row.isOwner })
  }
  const members = new Set(standings.map(row => row.memberId))
  if (members.size !== standings.length || standings.filter(row => row.isOwner).length !== 1) return null
  for (const game of value.recentGames) {
    if (!object(game) || !id(game.id) || !time(game.finishedAt) || !count(game.playerCount) || game.playerCount < 2 || game.playerCount > summary.memberCount ||
      !Array.isArray(game.players) || game.players.length !== game.playerCount) return null
    const players: AdminLeagueDetail['recentGames'][number]['players'] = []
    for (const player of game.players) {
      if (!object(player) || !id(player.memberId) || !members.has(player.memberId) || !text(player.name, 24) || !count(player.position) ||
        player.position < 1 || player.position > game.playerCount || typeof player.score !== 'number' || !Number.isFinite(player.score)) return null
      players.push({ memberId: player.memberId, name: player.name, position: player.position, score: player.score })
    }
    if (new Set(players.map(player => player.memberId)).size !== players.length) return null
    recentGames.push({ id: game.id, finishedAt: game.finishedAt, playerCount: game.playerCount, players })
  }
  if (new Set(recentGames.map(game => game.id)).size !== recentGames.length) return null
  return { ...summary, ratingSystem: 'trueskill', standings, recentGames }
}

interface LeaguesState { list: AdminLeaguesResponse | null; detail: AdminLeagueDetail | null; selected: string | null; loading: boolean; loadingDetail: boolean; error: 'list' | 'detail' | 'missing' | null }
/** Independent read cancellation prevents older searches and details from replacing the current selection. */
export class AdminLeaguesController {
  private state: LeaguesState = { list: null, detail: null, selected: null, loading: false, loadingDetail: false, error: null }
  private listeners = new Set<() => void>()
  private listSequence = 0
  private detailSequence = 0
  private listRequest: AbortController | null = null
  private detailRequest: AbortController | null = null
  private options: { onSessionExpired: () => void; request?: typeof fetch }
  constructor(options: { onSessionExpired: () => void; request?: typeof fetch }) { this.options = options }
  getState = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(value: Partial<LeaguesState>) { this.state = { ...this.state, ...value }; for (const listener of this.listeners) listener() }
  private async request(path: string, controller: AbortController) {
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try { const response = await adminFetch(path, { signal: controller.signal }, this.options.request); return { response, body: await response.json().catch(() => null) as unknown } }
    finally { clearTimeout(timeout) }
  }
  private expired() { this.cancel(); this.publish({ list: null, selected: null, detail: null, error: null }); this.options.onSessionExpired() }
  load = async (filters: LeagueFilters) => {
    const sequence = ++this.listSequence
    this.listRequest?.abort(); this.clearSelection()
    const controller = new AbortController(); this.listRequest = controller
    this.publish({ list: null, loading: true, error: null })
    const query = new URLSearchParams({ q: filters.q.trim().slice(0, 100), status: filters.status, offset: String(filters.offset), limit: '25' })
    if (filters.gameType) query.set('gameType', filters.gameType)
    try {
      const { response, body } = await this.request(`/api/admin/leagues?${query}`, controller)
      if (sequence !== this.listSequence) return
      if (response.status === 401 || response.status === 403) { this.expired(); return }
      const value = response.ok ? readAdminLeagues(body) : null
      if (controller.signal.aborted || !value) throw new Error('Unavailable')
      this.publish({ list: value })
    } catch { if (sequence === this.listSequence) this.publish({ error: 'list' }) }
    finally { if (sequence === this.listSequence) { this.listRequest = null; this.publish({ loading: false }) } }
  }
  select = async (leagueId: string) => {
    if (!id(leagueId)) return
    this.clearSelection()
    const sequence = ++this.detailSequence, controller = new AbortController(); this.detailRequest = controller
    this.publish({ selected: leagueId, detail: null, loadingDetail: true, error: null })
    try {
      const { response, body } = await this.request(`/api/admin/leagues/${encodeURIComponent(leagueId)}`, controller)
      if (sequence !== this.detailSequence) return
      if (response.status === 401 || response.status === 403) { this.expired(); return }
      if (response.status === 404) { this.publish({ error: 'missing' }); return }
      const value = response.ok ? readAdminLeagueDetail(body) : null
      if (controller.signal.aborted || !value || value.id !== leagueId) throw new Error('Unavailable')
      this.publish({ detail: value })
    } catch { if (sequence === this.detailSequence) this.publish({ error: 'detail' }) }
    finally { if (sequence === this.detailSequence) { this.detailRequest = null; this.publish({ loadingDetail: false }) } }
  }
  clearSelection = () => { this.detailSequence++; this.detailRequest?.abort(); this.detailRequest = null; this.publish({ selected: null, detail: null, loadingDetail: false, error: null }) }
  cancel = () => { this.listSequence++; this.listRequest?.abort(); this.listRequest = null; this.clearSelection(); this.publish({ loading: false }) }
}
