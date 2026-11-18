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
  activeSeasonId?: string
}

export interface LeagueSeason {
  id: string
  /** Null names identify the archived results from before seasons began. */
  name: string | null
  startedAt: number
  endedAt: number | null
  gameCount: number
}

export interface LeagueInvitation extends RoomLeagueSummary {
  isMember: boolean
}

export interface LeagueRatingChange {
  before: number
  after: number
  change: number
}

export type LeagueResultReceipt = {
  matchId: string
  league: Pick<RoomLeagueSummary, 'id' | 'name' | 'gameType'>
  season?: Pick<LeagueSeason, 'id' | 'name'>
} & (
  | { status: 'counted'; rating: LeagueRatingChange }
  | { status: 'not_counted'; reason: 'participants_changed' | 'result_unavailable' }
)

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
  seasonId?: string
  seasons?: LeagueSeason[]
}
