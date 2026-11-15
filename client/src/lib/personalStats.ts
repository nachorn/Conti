import type { PersonalStats, PersonalStatsTotals } from '@shared/personalStats'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const integer = (value: unknown, min = 0) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min
const timestamp = (value: unknown) => integer(value) && Number(value) <= 8_640_000_000_000_000
function totals(value: unknown): value is PersonalStatsTotals {
  if (!object(value) || ![value.played, value.wins, value.draws, value.losses].every(n => integer(n))) return false
  return Number(value.wins) + Number(value.draws) + Number(value.losses) === value.played &&
    typeof value.winRate === 'number' && Number.isFinite(value.winRate) && value.winRate >= 0 && value.winRate <= 100
}

/** Never render an incomplete response as an empty or successful statistics page. */
export function isPersonalStats(value: unknown): value is PersonalStats {
  if (!object(value) || !timestamp(value.generatedAt) || !totals(value.overall) || !object(value.byGame) ||
    !totals(value.byGame.pocha) || !totals(value.byGame.continental) || !Array.isArray(value.recentGames) || value.recentGames.length > 50) return false
  return value.recentGames.every(game => object(game) && typeof game.id === 'string' && game.id.length > 0 &&
    ['pocha', 'continental'].includes(String(game.gameType)) && timestamp(game.startedAt) && timestamp(game.finishedAt) &&
    Number(game.finishedAt) >= Number(game.startedAt) && integer(game.playerCount, 2) && Number(game.playerCount) <= 10 &&
    integer(game.position, 1) && Number(game.position) <= Number(game.playerCount) && Number.isSafeInteger(game.score) &&
    ['win', 'draw', 'loss'].includes(String(game.outcome)) && Array.isArray(game.players) && game.players.length === game.playerCount &&
    game.players.every(player => object(player) && typeof player.name === 'string' && player.name.length > 0 && player.name.length <= 24 &&
      Number.isSafeInteger(player.score) && integer(player.position, 1) && Number(player.position) <= Number(game.playerCount)))
}
