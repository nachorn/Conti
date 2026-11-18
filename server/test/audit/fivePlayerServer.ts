/** Test-only isolated clock: network clients retain the real wall clock. */
import { mock } from 'node:test'
import { createGameServer } from '../../src/app.js'
import { FileSnapshotStore } from '../../src/storage.js'
import { MembershipService } from '../../src/membership.js'
import { mockLeagueDeals } from './leagueDeals.js'

let server: Awaited<ReturnType<typeof createGameServer>>
let membership: MembershipService
let deals: ReturnType<typeof mockLeagueDeals>
const inbox = new Map<string, string>()
let now = Date.now()
process.on('message', async (message: any) => {
  const { id, command, payload } = message
  try {
    let value: any
    if (command === 'start') {
      now = payload.now ?? now
      mock.timers.enable({ apis: ['Date'], now })
      deals = mockLeagueDeals(mock, payload.dealState)
      membership = await new MembershipService({
        store: await FileSnapshotStore.open(payload.accounts),
        authSecret: 'synthetic-five-human-audit-secret-2026-only',
        sendCode: async (email, code) => { inbox.set(email, code) },
      }).load()
      server = await createGameServer(await FileSnapshotStore.open(payload.games), { membership })
      value = { port: await server.listen(0, '127.0.0.1') }
    } else if (command === 'code') value = inbox.get(payload.email)
    else if (command === 'sync') {
      if (payload.advanceMs) { mock.timers.tick(payload.advanceMs); now += payload.advanceMs }
      await server.idle()
      const record = server.repository.get(payload.roomId)
      if (!record) throw new Error('Audit room missing')
      value = { now, views: Object.fromEntries(payload.playerIds.map((playerId: string) => [playerId, record.room.getState(playerId)])),
        audit: { bots: record.sessions.filter(s => s.bot).length, eligible: record.match?.eligible,
          distinctAccounts: new Set(record.match?.participants.map(p => p.accountId)).size,
          connected: record.room.players.filter(p => p.connected).length } }
    } else if (command === 'stop') {
      await server.close(); await membership.close(); value = { now, dealState: deals.state }
    } else throw new Error('Unknown audit command')
    process.send?.({ id, value }, () => { if (command === 'stop') process.exit(0) })
  } catch (error) {
    process.send?.({ id, error: error instanceof Error ? error.message : 'Audit command failed' })
  }
})
