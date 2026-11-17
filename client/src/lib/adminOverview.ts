import type { AdminGameSummary, AdminOverview, FootballAdminReport } from '@shared/platformAdmin'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const text = (value: unknown): value is string => typeof value === 'string' && value.length <= 500
const date = (value: unknown): value is number => count(value) && value <= 8_640_000_000_000_000

/** Keep only aggregate report fields; malformed responses cannot break the private panel. */
export function readAdminOverview(raw: unknown): AdminOverview | null {
  if (!object(raw) || !date(raw.generatedAt) || !object(raw.accounts) || !count(raw.accounts.total) ||
    !count(raw.accounts.plusActive) || raw.accounts.plusActive > raw.accounts.total || !Array.isArray(raw.games) || raw.games.length !== 2 ||
    !object(raw.football) || typeof raw.football.available !== 'boolean' || typeof raw.football.stale !== 'boolean') return null
  const games: AdminGameSummary[] = []
  for (const value of raw.games) {
    if (!object(value) || !['continental', 'pocha'].includes(String(value.gameType)) || !count(value.recordedGames) ||
      !count(value.registeredPlayers) || !count(value.leagues) || !Array.isArray(value.recentGames) || value.recentGames.length > 100) return null
    const recentGames: AdminGameSummary['recentGames'] = []
    for (const game of value.recentGames) {
      if (!object(game) || !text(game.id) || !date(game.finishedAt) || !count(game.playerCount) ||
        !Array.isArray(game.winners) || game.winners.length > game.playerCount || !game.winners.every(text)) return null
      recentGames.push({ id: game.id, finishedAt: game.finishedAt, playerCount: game.playerCount, winners: game.winners as string[] })
    }
    games.push({ gameType: value.gameType as AdminGameSummary['gameType'], recordedGames: value.recordedGames,
      registeredPlayers: value.registeredPlayers, leagues: value.leagues, recentGames })
  }
  if (new Set(games.map(game => game.gameType)).size !== 2) return null
  let report: FootballAdminReport | null = null
  if (raw.football.report !== null) {
    const value = raw.football.report
    if (!object(value) || !date(value.generatedAt) || !date(value.since) || !date(value.until) || value.since > value.until ||
      !object(value.totals) || !Object.values(value.totals).every(count) || !Array.isArray(value.daily) || !Array.isArray(value.screens) ||
      !Array.isArray(value.devices) || !Array.isArray(value.errors) || [value.daily, value.screens, value.devices, value.errors].some(rows => rows.length > 1000)) return null
    const daily: FootballAdminReport['daily'] = [], screens: FootballAdminReport['screens'] = [], devices: FootballAdminReport['devices'] = [], errors: FootballAdminReport['errors'] = []
    for (const row of value.daily) {
      if (!object(row) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !count(row.events) || !count(row.careersCreated) || !count(row.firstMatchesCompleted)) return null
      daily.push({ date: row.date, events: row.events, careersCreated: row.careersCreated, firstMatchesCompleted: row.firstMatchesCompleted })
    }
    for (const row of value.screens) { if (!object(row) || !text(row.screen) || !count(row.count)) return null; screens.push({ screen: row.screen, count: row.count }) }
    for (const row of value.devices) { if (!object(row) || !text(row.device) || !count(row.count)) return null; devices.push({ device: row.device, count: row.count }) }
    for (const row of value.errors) { if (!object(row) || !text(row.name) || !text(row.source) || !count(row.count)) return null; errors.push({ name: row.name, source: row.source, count: row.count }) }
    report = { generatedAt: value.generatedAt, since: value.since, until: value.until, totals: { ...value.totals } as Record<string, number>, daily, screens, devices, errors }
  }
  return { generatedAt: raw.generatedAt, accounts: { total: raw.accounts.total, plusActive: raw.accounts.plusActive }, games,
    football: { available: raw.football.available, stale: raw.football.stale, report } }
}
