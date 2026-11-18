import type { LeagueGameType } from '@shared/leagues'

export type LeagueAccountTarget =
  | { kind: 'invite'; gameType: LeagueGameType; code: string }
  | { kind: 'league'; gameType: LeagueGameType; id: string; seasonId?: string }

type LeagueInviteTarget = Extract<LeagueAccountTarget, { kind: 'invite' }>
type InviteStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const pendingInviteKey = 'nrnplay-pending-league-invite'
const pendingInviteTtl = 30 * 60 * 1000

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

export function rememberLeagueInvite(storage: InviteStorage | null, invite: LeagueInviteTarget, now = Date.now()): boolean {
  if (!storage) return false
  try {
    storage.setItem(pendingInviteKey, JSON.stringify({ hash: leagueAccountHash(invite), expiresAt: now + pendingInviteTtl }))
    return true
  } catch { return false }
}

export function readLeagueInvite(storage: InviteStorage | null, now = Date.now()): LeagueInviteTarget | null {
  try {
    const raw = storage?.getItem(pendingInviteKey)
    if (!raw || raw.length > 600) return null
    const saved = JSON.parse(raw)
    if (typeof saved?.hash !== 'string' || !Number.isSafeInteger(saved?.expiresAt) || saved.expiresAt <= now ||
        saved.expiresAt > now + pendingInviteTtl) return null
    const invite = parseLeagueAccountTarget(saved.hash)
    return invite?.kind === 'invite' ? invite : null
  } catch { return null }
}

export function forgetLeagueInvite(storage: InviteStorage | null): void {
  try { storage?.removeItem(pendingInviteKey) } catch { /* Storage is optional. */ }
}
