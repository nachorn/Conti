export type LeagueGameType = 'pocha' | 'continental'

export interface RoomLeagueSummary {
  id: string
  name: string
  gameType: LeagueGameType
  closedAt: number | null
}

export interface LeagueSummary extends RoomLeagueSummary {
  createdAt: number
  minGames: number
  memberCount: number
  gameCount: number
  isOwner: boolean
}

export interface LeagueStanding {
  memberId: string
  name: string
  rank: number | null
  /** Conservative TrueSkill estimate, mu - 3 sigma, rounded for display. */
  rating: number
  played: number
  wins: number
  draws: number
  losses: number
  winRate: number
  provisional: boolean
  isMe: boolean
}

export interface LeagueGame {
  id: string
  finishedAt: number
  playerCount: number
  players: { memberId: string; name: string; position: number; score: number }[]
}

export interface LeagueDetail extends LeagueSummary {
  inviteCode: string
  ratingSystem: 'trueskill'
  ratingVersion: 1
  standings: LeagueStanding[]
  recentGames: LeagueGame[]
}
