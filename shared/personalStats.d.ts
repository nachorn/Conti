export interface PersonalStatsTotals {
  played: number
  wins: number
  draws: number
  losses: number
  /** Individual victories divided by completed games, as a percentage 0–100. */
  winRate: number
}

export interface PersonalGameResult {
  id: string
  gameType: 'pocha' | 'continental'
  startedAt: number
  finishedAt: number
  playerCount: number
  score: number
  position: number
  outcome: 'win' | 'draw' | 'loss'
  players: { name: string; score: number; position: number }[]
}

/** Private to the signed-in account; never expose account IDs or email addresses. */
export interface PersonalStats {
  generatedAt: number
  overall: PersonalStatsTotals
  byGame: { pocha: PersonalStatsTotals; continental: PersonalStatsTotals }
  recentGames: PersonalGameResult[]
}
