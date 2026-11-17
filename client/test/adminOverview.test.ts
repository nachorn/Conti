import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readAdminOverview } from '../src/lib/adminOverview.ts'
import { adminAccess, adminDestination } from '../src/lib/adminRoute.ts'

const game = (gameType: string) => ({ gameType, recordedGames: 3, registeredPlayers: 5, leagues: 1, recentGames: [{ id: 'synthetic-match', finishedAt: 1_800_000_000_000, playerCount: 5, winners: ['Ejemplo'] }] })
const overview = () => ({ generatedAt: 1_800_000_000_000, accounts: { total: 5, plusActive: 2 }, games: [game('continental'), game('pocha')], football: { available: false, stale: false, report: null } })

test('overview accepts unavailable Football and selects public aggregates only', () => {
  const value = { ...overview(), secret: 'synthetic-private', accounts: { ...overview().accounts, passwordHash: 'synthetic-private' } }
  assert.deepEqual(readAdminOverview(value), overview())
  assert.equal(readAdminOverview({ ...overview(), games: [game('pocha'), game('pocha')] }), null)
  assert.equal(readAdminOverview({ ...overview(), games: [{ ...game('pocha'), recentGames: [{ finishedAt: Infinity }] }] }), null)
})

test('Football report keeps activity aggregates and rejects malformed rows or private additional fields', () => {
  const report = { generatedAt: 1_800_000_000_000, since: 1_799_000_000_000, until: 1_800_000_000_000,
    totals: { landing_view: 15, career_created: 4, first_match_completed: 3 }, daily: [{ date: '2026-11-16', events: 22, careersCreated: 4, firstMatchesCompleted: 3 }],
    screens: [{ screen: 'home', count: 10 }], devices: [{ device: 'mobile', count: 10 }], errors: [{ name: 'ExampleError', source: 'example', count: 1 }] }
  const raw = { ...overview(), football: { available: true, stale: true, report: { ...report, careers: [{ private: 'not uploaded' }] } } }
  const value = readAdminOverview(raw)
  assert.deepEqual(value?.football.report, report)
  assert.equal(JSON.stringify(value).includes('not uploaded'), false)
  assert.equal(readAdminOverview({ ...raw, football: { ...raw.football, report: { ...report, daily: [{ date: 'bad', events: 1 }] } } }), null)
})

test('admin route stays central, legacy local routes resolve to /admin, and unrelated hosts never receive admin UI', () => {
  for (const host of ['nrnplay.com', 'localhost', '127.0.0.1', '[::1]']) assert.equal(adminDestination(host), '/admin')
  for (const host of ['conti.nrnplay.com', 'pocha.nrnplay.com', 'football.nrnplay.com', 'www.nrnplay.com', 'nrnplay.com.example.test']) {
    assert.equal(adminDestination(host), 'https://nrnplay.com/admin')
  }
})

test('only a completed server check with an explicit admin role and valid session can render administration', () => {
  const value = { loaded: true, authReady: true, token: 'A'.repeat(43), account: { isAdmin: true } }
  assert.equal(adminAccess(value), 'allowed')
  assert.equal(adminAccess({ ...value, loaded: false }), 'pending')
  assert.equal(adminAccess({ ...value, authReady: false }), 'pending')
  assert.equal(adminAccess({ ...value, account: null }), 'denied')
  assert.equal(adminAccess({ ...value, account: {} }), 'denied')
  assert.equal(adminAccess({ ...value, account: { isAdmin: false } }), 'denied')
  assert.equal(adminAccess({ ...value, token: null }), 'denied')
  assert.equal(adminAccess({ ...value, token: 'not-a-session' }), 'denied')
})
