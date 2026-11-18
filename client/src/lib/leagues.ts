import type { LeagueDetail, LeagueInvitation, LeagueResultReceipt, LeagueSeason, LeagueSummary } from '@shared/leagues'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
const timestamp = (value: unknown): value is number => integer(value, 0, 8_640_000_000_000_000)
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const id = (value: unknown): value is string => text(value, 200)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const gameType = (value: unknown) => value === 'pocha' || value === 'continental'
const seasonRef = (value: unknown): value is Pick<LeagueSeason, 'id' | 'name'> =>
  object(value) && id(value.id) && (value.name === null || text(value.name, 60))

function isLeagueSeason(value: unknown): value is LeagueSeason {
  if (!object(value)) return false
  const { startedAt, endedAt, gameCount } = value
  return seasonRef(value) && timestamp(startedAt) &&
    (endedAt === null || timestamp(endedAt) && endedAt >= startedAt) && integer(gameCount)
}

export function isLeagueSummary(value: unknown): value is LeagueSummary {
  return object(value) && id(value.id) && text(value.name, 60) && gameType(value.gameType) &&
    timestamp(value.createdAt) && (value.closedAt === null || timestamp(value.closedAt) && value.closedAt >= value.createdAt) &&
    integer(value.minGames, 1, 50) && integer(value.memberCount, 1, 200) && integer(value.gameCount) && typeof value.isOwner === 'boolean' &&
    (value.activeSeasonId === undefined || id(value.activeSeasonId))
}

export function isLeagueList(value: unknown): value is { leagues: LeagueSummary[] } {
  return object(value) && Array.isArray(value.leagues) && value.leagues.length <= 100 && value.leagues.every(isLeagueSummary) &&
    new Set(value.leagues.map(league => league.id)).size === value.leagues.length
}

/** Validate the complete response before treating it as a private league. */
export function isLeagueDetail(value: unknown): value is LeagueDetail {
  if (!isLeagueSummary(value) || !object(value) || typeof value.inviteCode !== 'string' || !/^[A-F0-9]{10}$/.test(value.inviteCode) ||
      value.ratingSystem !== 'trueskill' || value.ratingVersion !== 1 || !Array.isArray(value.standings) ||
      value.standings.length !== value.memberCount || !Array.isArray(value.recentGames) || value.recentGames.length > 50 || value.recentGames.length > value.gameCount) return false
  const archived = value.seasonId !== undefined && value.seasonId !== value.activeSeasonId
  if (value.seasons !== undefined || value.seasonId !== undefined || value.activeSeasonId !== undefined) {
    if (!id(value.seasonId) || !id(value.activeSeasonId) || !Array.isArray(value.seasons) ||
        value.seasons.length < 1 || value.seasons.length > 100 || !value.seasons.every(isLeagueSeason) ||
        new Set(value.seasons.map(season => season.id)).size !== value.seasons.length) return false
    const active = value.seasons.find(season => season.id === value.activeSeasonId)
    const selected = value.seasons.find(season => season.id === value.seasonId)
    if (!active || active.name === null || !selected || selected.gameCount !== value.gameCount ||
        value.seasons.some(season => season.id !== active.id && season.endedAt === null) ||
        (value.closedAt === null && active.endedAt !== null)) return false
  }
  const members = new Set<string>()
  for (const row of value.standings) {
    if (!object(row) || !id(row.memberId) || members.has(row.memberId) || !text(row.name, 24) || !finite(row.rating) ||
        !integer(row.played, 0, value.gameCount) || !integer(row.wins) || !integer(row.draws) || !integer(row.losses) ||
        row.wins + row.draws + row.losses !== row.played || !finite(row.winRate) || row.winRate < 0 || row.winRate > 100 ||
        typeof row.provisional !== 'boolean' || row.provisional !== (row.played < value.minGames) || typeof row.isMe !== 'boolean' ||
        (row.provisional ? row.rank !== null : !integer(row.rank, 1, value.memberCount))) return false
    members.add(row.memberId)
  }
  const matchingViewers = value.standings.filter(row => object(row) && row.isMe === true).length
  if (matchingViewers > 1 || (!archived && matchingViewers !== 1)) return false
  const games = new Set<string>()
  return value.recentGames.every(game => {
    if (!object(game) || !id(game.id) || games.has(game.id) || !timestamp(game.finishedAt) || !integer(game.playerCount, 2, 10) ||
        !Array.isArray(game.players) || game.players.length !== game.playerCount) return false
    games.add(game.id)
    const seen = new Set<string>()
    return game.players.every(player => {
      if (!object(player) || !id(player.memberId) || !members.has(player.memberId) || seen.has(player.memberId) ||
          !text(player.name, 24) || !integer(player.position, 1, game.playerCount as number) || !Number.isSafeInteger(player.score)) return false
      seen.add(player.memberId)
      return true
    })
  })
}

export function isLeagueInvitation(value: unknown): value is LeagueInvitation {
  return object(value) && id(value.id) && text(value.name, 60) && gameType(value.gameType) &&
    (value.closedAt === null || timestamp(value.closedAt)) && typeof value.isMember === 'boolean'
}

export function isLeagueResultReceipt(value: unknown): value is LeagueResultReceipt {
  if (!object(value) || !id(value.matchId) || !object(value.league) || !id(value.league.id) ||
      !text(value.league.name, 60) || !gameType(value.league.gameType) ||
      !(value.season === undefined || seasonRef(value.season))) return false
  if (value.status === 'not_counted') return value.reason === 'participants_changed' || value.reason === 'result_unavailable'
  if (value.status !== 'counted' || !object(value.rating)) return false
  const { before, after, change } = value.rating
  return finite(before) && finite(after) && finite(change) && Math.abs(Math.round((after - before) * 100) / 100 - change) < 1e-9
}
