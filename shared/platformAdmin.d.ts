import type { PersonalStatsTotals } from './personalStats.js'
import type { LeagueGame, LeagueGameType, LeagueStanding } from './leagues.js'

export interface AdminLeagueSummary {
  id: string
  name: string
  gameType: LeagueGameType
  ownerName: string
  createdAt: number
  closedAt: number | null
  minGames: number
  memberCount: number
  gameCount: number
}
export interface AdminLeaguesResponse {
  generatedAt: number
  total: number
  filtered: number
  offset: number
  limit: number
  leagues: AdminLeagueSummary[]
}
export interface AdminLeagueDetail extends AdminLeagueSummary {
  ratingSystem: 'trueskill'
  standings: (Omit<LeagueStanding, 'isMe'> & { joinedAt: number; isOwner: boolean })[]
  recentGames: LeagueGame[]
}

export interface AdminAccount {
  id: string
  name: string | null
  email: string
  createdAt: number
  plus: { active: boolean; source: 'gift' | 'purchase' | null; expiresAt: number | null }
  stats: { continental: PersonalStatsTotals; pocha: PersonalStatsTotals }
}
export interface AdminAccountsResponse {
  generatedAt: number
  total: number
  filtered: number
  offset: number
  limit: number
  accounts: AdminAccount[]
}
export interface AdminGameSummary {
  gameType: 'continental' | 'pocha'
  recordedGames: number
  registeredPlayers: number
  leagues: number
  recentGames: { id: string; finishedAt: number; playerCount: number; winners: string[] }[]
}
export interface FootballAdminReport {
  generatedAt: number
  since: number
  until: number
  totals: Record<string, number>
  daily: { date: string; events: number; careersCreated: number; firstMatchesCompleted: number }[]
  screens: { screen: string; count: number }[]
  devices: { device: string; count: number }[]
  errors: { name: string; source: string; count: number }[]
}
export interface AdminOverview {
  generatedAt: number
  accounts: { total: number; plusActive: number }
  games: AdminGameSummary[]
  football: { available: boolean; stale: boolean; report: FootballAdminReport | null }
}
