import type { LeagueGameType } from '@shared/leagues'

export type LeagueAccountTarget =
  | { kind: 'invite'; gameType: LeagueGameType; code: string }
  | { kind: 'league'; gameType: LeagueGameType; id: string; seasonId?: string }

const leagueId = /^[A-Za-z0-9_-]{1,200}$/
const inviteCode = /^[A-F0-9]{10}$/

export function parseLeagueAccountTarget(hash: string): LeagueAccountTarget | null {
  if (hash.length > 500) return null
  const fields = new URLSearchParams(hash.replace(/^#/, ''))
  const gameType = fields.get('game')
  if ((gameType !== 'continental' && gameType !== 'pocha') || fields.getAll('game').length !== 1) return null
  const code = fields.get('invite')
  const id = fields.get('league')
  const seasonId = fields.get('season')
  if (code !== null && id === null && seasonId === null && fields.getAll('invite').length === 1 && inviteCode.test(code)) {
    return { kind: 'invite', gameType, code }
  }
  if (id === null || code !== null || fields.getAll('league').length !== 1 || fields.getAll('season').length > 1 ||
      !leagueId.test(id) || (seasonId !== null && !leagueId.test(seasonId))) return null
  return { kind: 'league', gameType, id, ...(seasonId ? { seasonId } : {}) }
}

export function leagueAccountHash(target: LeagueAccountTarget): string {
  const fields = new URLSearchParams({ game: target.gameType })
  if (target.kind === 'invite') fields.set('invite', target.code)
  else {
    fields.set('league', target.id)
    if (target.seasonId) fields.set('season', target.seasonId)
  }
  return '#' + fields.toString()
}
