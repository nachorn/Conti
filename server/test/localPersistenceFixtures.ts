import { createHash } from 'node:crypto'
import type { Client } from 'pg'
import { Room } from '../src/room.js'
import { issueCredential } from '../src/recovery.js'
import type { SnapshotPair } from '../src/operations/localPersistence.js'
export const fixtureSecret = 'public-test-account-secret-0123456789'
export const fixtureToken = 'T'.repeat(43)
export const fixtureNow = 1_900_000_000_000
export function snapshotFixture() {
  const room = new Room({ roomId: '1234', gameType: 'continental', maxPlayers: 10, deckCount: 2, discardOptionDelaySeconds: 10, secondsPerTurn: 0 })
  const { credential, session } = issueCredential('1234')
  room.addPlayer(credential.playerId, 'Fixture player')
  const pair: SnapshotPair = {
    game: { version: 1, savedAt: fixtureNow, rooms: [{ room: room.toSnapshot(), sessions: [session], updatedAt: fixtureNow, paused: null, chat: [] }] },
    membership: { version: 1,
      accounts: [{ id: 'fixture-account', email: 'fixture@example.test', name: 'Fixture', createdAt: 1_000,
        passwordHash: `scrypt-v1$131072$8$1$${'a'.repeat(32)}$${'b'.repeat(64)}` }],
      sessions: [{ accountId: 'fixture-account', tokenHash: createHash('sha256').update(fixtureToken).digest('hex'), expiresAt: fixtureNow }],
      challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [], bmcSubscriptions: [], plusAudit: [] },
  }
  return { pair, credential }
}
export class FakeLocalPg {
  pair: SnapshotPair
  locksAvailable = true
  queries: { text: string; values: unknown[] }[] = []
  failOn: string | null = null
  private pending: SnapshotPair | null = null
  constructor(pair: SnapshotPair) { this.pair = structuredClone(pair) }
  asClient(): Client { return this as unknown as Client }
  async query(text: string, values: unknown[] = []) {
    const tag = /local:([a-z-]+)/.exec(text)?.[1] ?? text
    this.queries.push({ text, values })
    if (this.failOn === tag) throw new Error('private-driver-details-never-log')
    if (text.startsWith('BEGIN')) { this.pending = structuredClone(this.pair); return { rows: [], rowCount: 0 } }
    if (tag === 'writer-locks') return { rows: [{ game: this.locksAvailable, membership: this.locksAvailable }], rowCount: 1 }
    if (tag === 'read-pair') return { rows: (['game', 'membership'] as const).map(namespace => ({ namespace,
      bytes: Buffer.byteLength(JSON.stringify(this.pair[namespace])), encoded: JSON.stringify(this.pair[namespace]) })), rowCount: 2 }
    if (tag === 'write-game' || tag === 'write-membership') {
      if (!this.pending) throw new Error('Missing test transaction')
      this.pending[tag === 'write-game' ? 'game' : 'membership'] = JSON.parse(values[0] as string)
      return { rows: [], rowCount: 1 }
    }
    if (tag === 'COMMIT') { this.pair = this.pending!; this.pending = null; return { rows: [], rowCount: 0 } }
    if (tag === 'ROLLBACK') { this.pending = null; return { rows: [], rowCount: 0 } }
    if (tag === 'SET LOCAL synchronous_commit = on') return { rows: [], rowCount: 0 }
    throw new Error('Unexpected test query')
  }
}
