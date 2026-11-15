import { Rating, TrueSkill } from 'ts-trueskill'

// Dependency implementation: MIT/BSD. Its LICENSE separately cautions about
// Microsoft's TrueSkill trademark/commercial use; review before public activation.
export interface LeagueRating { mu: number; sigma: number }
export interface LeagueRatingEntry extends LeagueRating { id: string; position: number }

// Classic TrueSkill with one team per player. Freeze these parameters for a
// league's lifetime; changing them requires replaying its completed results.
export const LEAGUE_RATING_PARAMETERS = Object.freeze({
  mu: 25, sigma: 25 / 3, beta: 25 / 6, tau: 25 / 300, drawProbability: 0.1,
})
const model = new TrueSkill(25, 25 / 3, 25 / 6, 25 / 300, 0.1)
const validRating = (rating: LeagueRating) => Number.isFinite(rating.mu) && Number.isFinite(rating.sigma) && rating.sigma > 0

export function initialLeagueRating(): LeagueRating {
  return { mu: LEAGUE_RATING_PARAMETERS.mu, sigma: LEAGUE_RATING_PARAMETERS.sigma }
}

/** Microsoft Research's conservative leaderboard estimate, μ − 3σ. */
export function leagueRatingPoints(rating: LeagueRating): number {
  if (!validRating(rating)) throw new Error('Invalid league rating')
  const points = Math.round((rating.mu - 3 * rating.sigma) * 100) / 100
  if (!Number.isFinite(points)) throw new Error('Invalid league rating')
  return Object.is(points, -0) ? 0 : points
}

/**
 * Update the whole free-for-all factor graph once, including every final place.
 * Equal positions are draws. Raw card-game points never enter this calculation.
 */
export function updateLeagueRatings(entries: readonly LeagueRatingEntry[]): Map<string, LeagueRating> {
  if (entries.length < 2 || entries.length > 10 || entries.some(entry =>
    typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(entry.id) || !validRating(entry) ||
    !Number.isSafeInteger(entry.position) || entry.position < 1 || entry.position > entries.length) ||
    new Set(entries.map(entry => entry.id)).size !== entries.length || !entries.some(entry => entry.position === 1)) {
    throw new Error('Invalid league rating entries')
  }
  // The factor graph iterates adjacent ranks (small EP approximation differences
  // can occur inside a multi-player draw), so make tied-player ordering
  // deterministic rather than inheriting whichever seat happened to be first.
  const ordered = [...entries].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const groups = ordered.map(entry => [new Rating(entry.mu, entry.sigma)])
  const rated = model.rate(groups, ordered.map(entry => entry.position)) as Rating[][]
  if (rated.length !== ordered.length) throw new Error('League rating calculation unavailable')
  return new Map(ordered.map((entry, index) => {
    const rating = rated[index]?.[0]
    if (!rating || !validRating(rating)) throw new Error('League rating calculation unavailable')
    return [entry.id, { mu: rating.mu, sigma: rating.sigma }]
  }))
}
