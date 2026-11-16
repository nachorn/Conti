import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import express from 'express'
import { MembershipService, adConfigFromEnvironment } from '../src/membership.js'
import { registerPersonalStats } from '../src/personalStats.js'
import { cloneRecord, GameRepository, issueCredential, type RoomRecord } from '../src/recovery.js'
import { Room } from '../src/room.js'
import { MAX_SNAPSHOT_BYTES, SnapshotCapacityError, snapshotCapacity, type SnapshotStore } from '../src/storage.js'
import { shuffle as shuffleConti } from '../src/game/deck.js'
import { shuffle as shufflePocha } from '../src/game/pocha/spanishDeck.js'

class MemoryStore implements SnapshotStore {
  value: any = null
  saves = 0
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.saves++; this.value = structuredClone(value) }
  async close() {}
}
const emptyMembership = () => ({ version: 1, accounts: [] as any[], sessions: [], challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [] })
const options = (store: SnapshotStore) => ({ store, authSecret: 'local-backend-hardening-test-secret-no-production-use' })
const account = (index: number) => ({ id: `account-${index}`, email: `player-${index}@example.test`, createdAt: 1 })
function roomRecord(roomId: string): RoomRecord {
  const room = new Room({ roomId })
  const { credential, session } = issueCredential(roomId)
  room.addPlayer(credential.playerId, 'Audit player')
  return { room, sessions: [session], updatedAt: Date.now(), paused: null, chat: [] }
}

test('registration acknowledges both existing and new emails without waiting for delivery, and records delivery failure privately', async () => {
  const store = new MemoryStore()
  store.value = { ...emptyMembership(), accounts: [account(0)] }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const deliveries: { email: string; code: string }[] = []
  const service = await new MembershipService({ ...options(store), sendCode: async (email, code) => {
    deliveries.push({ email, code })
    await gate
    throw new Error('simulated private provider failure')
  } }).load()
  let timeout: NodeJS.Timeout | undefined
  try {
    const existing = await service.register('Audit', account(0).email, 'Una frase para probar el registro', 'es', 'known-peer')
    const fresh = await Promise.race([
      service.register('Audit', account(1).email, 'Una frase para probar el registro', 'es', 'new-peer'),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Registration waited for email delivery')), 2_000) }),
    ])
    assert.match(existing, /^[A-Za-z0-9_-]{43}$/)
    assert.match(fresh, /^[A-Za-z0-9_-]{43}$/)
    assert.equal(deliveries.length, 1)
    assert.equal(deliveries[0].email, account(1).email)
    assert.equal(store.value.challenges.length, 1, 'the new challenge is durable before acknowledgement')
    assert.deepEqual(service.emailDeliveryStatus(), { pending: 1, failures: 0 })
  } finally {
    if (timeout) clearTimeout(timeout)
    release()
    await service.close()
  }
  assert.deepEqual(service.emailDeliveryStatus(), { pending: 0, failures: 1 })
  assert.equal(service.hasFailedOperation(), false)
})

test('concurrent recovery reservations cannot acknowledge an omitted delivery when all sixteen slots are occupied', async () => {
  const store = new MemoryStore()
  store.value = { ...emptyMembership(), accounts: Array.from({ length: 17 }, (_, i) => account(i)) }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let deliveries = 0
  const service = await new MembershipService({ ...options(store), sendCode: async () => { deliveries++; await gate } }).load()
  try {
    await Promise.all(Array.from({ length: 16 }, (_, i) => service.requestPasswordReset(account(i).email, 'es', `peer-${i}`)))
    assert.equal(deliveries, 16)
    assert.equal(service.emailDeliveryStatus().pending, 16)
    const saves = store.saves
    for (const email of [account(16).email, 'unknown@example.test']) {
      await assert.rejects(service.requestPasswordReset(email, 'es', 'overflow-peer'), /rate_limited/)
    }
    assert.equal(store.saves, saves, 'capacity refusal happens before account lookup or a new persisted challenge')
  } finally { release(); await service.close() }
  assert.equal(deliveries, 16)
  assert.deepEqual(service.emailDeliveryStatus(), { pending: 0, failures: 0 })
})

test('membership JSON and raw webhook reject compressed bodies before parsing or saving', async t => {
  const store = new MemoryStore()
  const service = await new MembershipService(options(store)).load()
  const app = express(); service.registerRoutes(app)
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(async () => { await new Promise<void>(resolve => http.close(() => resolve())); await service.close() })
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
  for (const path of ['/api/membership/register', '/api/membership/login', '/api/membership/stripe-webhook']) {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, body: gzipSync('{}') })
    assert.equal(response.status, 415)
    assert.deepEqual(await response.json(), { error: 'invalid_request' })
    assert.equal(response.headers.get('cache-control'), 'no-store')
  }
  assert.equal(store.saves, 0)
})

test('statistics budgets are account-scoped and the peer budget cannot be bypassed using forwarded headers', async t => {
  const repo = new GameRepository(new MemoryStore())
  const app = express()
  registerPersonalStats(app, { repository: repo, isHealthy: () => true, authenticate: token => token.startsWith('valid-') ? token : null })
  const http = createServer(app)
  await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>(resolve => http.close(() => resolve())))
  const base = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/membership/stats`
  for (let i = 0; i < 30; i++) {
    const response = await fetch(base, { headers: { Authorization: 'Bearer valid-A' } })
    assert.equal(response.status, 200); await response.json()
  }
  const limited = await fetch(base, { headers: { Authorization: 'Bearer valid-A' } })
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('cache-control'), 'no-store')
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  assert.deepEqual(await limited.json(), { error: 'rate_limited' })
  const independent = await fetch(base, { headers: { Authorization: 'Bearer valid-B' } })
  assert.equal(independent.status, 200); await independent.json()
  for (let i = 32; i < 240; i++) {
    const response = await fetch(base, { headers: { 'X-Forwarded-For': `203.0.113.${i % 255}` } })
    assert.equal(response.status, 401); await response.json()
  }
  const peerLimited = await fetch(base, { headers: { Authorization: 'Bearer valid-C', 'X-Forwarded-For': '198.51.100.1' } })
  assert.equal(peerLimited.status, 429)
  await peerLimited.json()
})

test('room admission reserves capacity, refuses before IO, preserves existing saves and reopens after cleanup', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  assert.equal(repo.storageCapacity().availableRoomSlots, 125)
  const roomIds: string[] = []
  while (repo.storageCapacity().availableRoomSlots > 0) {
    const id = repo.newRoomCode()
    await repo.commit(id, roomRecord(id))
    roomIds.push(id)
  }
  assert.ok(roomIds.length > 1 && roomIds.length < 500)
  assert.equal(repo.storageCapacity().warning, true)
  assert.equal(roomIds.length, 125, 'the unchanged hard limit and control margin bound ordinary-room admissions')
  assert.equal(repo.canStartNewGame(), true, 'ordinary existing rooms can still start with the measured headroom')
  const saves = store.saves
  assert.throws(() => repo.newRoomCode(), SnapshotCapacityError)
  await assert.rejects(repo.commit('0999', roomRecord('0999')), SnapshotCapacityError)
  assert.equal(store.saves, saves)
  assert.equal(repo.failed, false)
  const existing = cloneRecord(repo.get(roomIds[0])!)
  existing.room.players[0].name = 'Updated'
  await repo.commit(roomIds[0], existing)
  assert.equal(repo.get(roomIds[0])!.room.players[0].name, 'Updated')
  await repo.commit(roomIds.at(-1)!, null)
  const id = repo.newRoomCode()
  await repo.commit(id, roomRecord(id))
  const restarted = new GameRepository(store)
  await restarted.load()
  assert.equal(restarted.records.size, repo.records.size)
  assert.equal(restarted.storageCapacity().availableRoomSlots, 0)
})

test('forty-eight small legacy offline rooms remain startable and allow a new room after loading', async () => {
  const store = new MemoryStore()
  const records = Array.from({ length: 48 }, (_, i) => roomRecord(String(1000 + i)))
  for (const record of records) for (const player of record.room.players) player.connected = false
  store.value = { version: 1, savedAt: Date.now(), rooms: records.map(record => ({ ...record, room: record.room.toSnapshot() })) }
  const repo = new GameRepository(store)
  await repo.load()
  assert.equal(repo.records.size, 48)
  assert.equal(repo.canStartNewGame(), true)
  assert.equal(repo.storageCapacity().limitBytes, 16 * 1024 * 1024)
  assert.ok(repo.storageCapacity().reservedBytes < 7 * 1024 * 1024)
  const newId = repo.newRoomCode()
  assert.equal(repo.records.has(newId), false)
  await repo.commit(newId, roomRecord(newId))
  assert.equal(repo.records.size, 49)
  assert.equal(repo.canStartNewGame(), true)
  assert.ok(repo.storageCapacity().availableRoomSlots > 70)
  assert.equal(store.value.rooms.length, 49, 'all previous saved rooms are retained')
  assert.equal(repo.failed, false)
})

test('oversized input fails before storage without stopping healthy existing games', async () => {
  const store = new MemoryStore(), repo = new GameRepository(store)
  await repo.commit('1234', roomRecord('1234'))
  const saves = store.saves, previous = structuredClone(store.value)
  const oversized = cloneRecord(repo.get('1234')!)
  oversized.chat = [{ id: 'test', clientId: 'test', playerId: oversized.room.players[0].id, name: 'Audit', text: 'x'.repeat(MAX_SNAPSHOT_BYTES), sentAt: Date.now() }]
  await assert.rejects(repo.commit('1234', oversized), SnapshotCapacityError)
  assert.equal(store.saves, saves)
  assert.deepEqual(store.value, previous)
  assert.equal(repo.failed, false)
  await repo.commit('1234', cloneRecord(repo.get('1234')!))
})

test('large permanent history blocks new admissions before the limit while retaining readable results and shutdown', async () => {
  const store = new MemoryStore()
  const result = {
    id: 'result', gameType: 'continental', startedAt: 1, finishedAt: 2,
    players: Array.from({ length: 10 }, (_, i) => ({ accountId: `account-${i}`.padEnd(200, 'x'), name: 'Long player display name', score: i * 10, position: i + 1 })),
  }
  const count = Math.floor((MAX_SNAPSHOT_BYTES - 160 * 1024) / Buffer.byteLength(JSON.stringify(result) + ','))
  store.value = { version: 2, savedAt: Date.now(), rooms: [], results: Array.from({ length: count }, (_, i) => ({ ...result, id: `result-${i}` })) }
  assert.ok(snapshotCapacity(store.value).bytes < MAX_SNAPSHOT_BYTES)
  const repo = new GameRepository(store)
  await repo.load()
  assert.equal(repo.storageCapacity().warning, true)
  assert.equal(repo.canStartNewGame(), false)
  assert.throws(() => repo.newRoomCode(), SnapshotCapacityError)
  await assert.rejects(repo.createLeague({ id: 'owner', name: 'Owner' }, { name: 'Test league', gameType: 'continental' }), SnapshotCapacityError)
  assert.equal(store.saves, 0)
  assert.equal(repo.failed, false)
  assert.equal(repo.getPersonalStats(result.players[0].accountId).overall.played, count)
  await repo.saveShutdown([])
  assert.equal(store.value.results.length, count)
  assert.equal(repo.failed, false)
})

test('membership capacity preserves the control reserve for revocation and refuses new email work without poisoning storage', async () => {
  const store = new MemoryStore()
  const makeAccount = (i: number) => ({ id: `account-${i}`.padEnd(200, 'x'), email: `player-${String(i).padStart(5, '0')}@example.test`, createdAt: 1 })
  const count = Math.floor((MAX_SNAPSHOT_BYTES - 128 * 1024) / Buffer.byteLength(JSON.stringify(makeAccount(0)) + ','))
  store.value = { ...emptyMembership(), accounts: Array.from({ length: count }, (_, i) => makeAccount(i)),
    grants: [{ email: makeAccount(0).email, active: true, expiresAt: null, grantedAt: 1 }] }
  let sends = 0
  const service = await new MembershipService({ ...options(store), sendCode: async () => { sends++ } }).load()
  try {
    assert.equal(service.storageCapacity().growthAllowed, false)
    await assert.rejects(service.requestCode('new@example.test', 'es', 'new-peer'), /storage_capacity/)
    assert.equal(sends, 0)
    assert.equal(store.saves, 0)
    assert.equal(service.hasFailedOperation(), false)
    await service.revokeGift(makeAccount(0).email)
    assert.equal(store.value.grants[0].active, false)
    assert.equal(store.saves, 1)
    assert.equal(service.hasFailedOperation(), false)
  } finally { await service.close() }
})

test('offline backup checker validates both supplied copies in memory without modifying or printing private data', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'conti-offline-backup-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const gamePath = join(directory, 'game.json'), membershipPath = join(directory, 'membership.json')
  const game = JSON.stringify({ version: 1, savedAt: Date.now(), rooms: [] })
  const membership = JSON.stringify({ ...emptyMembership(), accounts: [{ id: 'private-account', email: 'private@example.test', createdAt: 1 }] })
  await Promise.all([writeFile(gamePath, game), writeFile(membershipPath, membership)])
  const script = fileURLToPath(new URL('../scripts/snapshot-capacity.ts', import.meta.url))
  const run = promisify(execFile)
  const { stdout } = await run(process.execPath, ['--import', 'tsx', script, '--game', gamePath, '--membership', membershipPath])
  const diagnostic = JSON.parse(stdout)
  assert.equal(diagnostic.valid, true)
  assert.equal(diagnostic.restoredInMemory, true)
  assert.equal(diagnostic.mode, 'offline-read-only')
  assert.doesNotMatch(stdout, /private@example|private-account/)
  assert.equal(await readFile(gamePath, 'utf8'), game)
  assert.equal(await readFile(membershipPath, 'utf8'), membership)
})

test('advertising environment fails closed until consent readiness is explicit', () => {
  const env = { ADS_PROVIDER: 'google-h5', ADSENSE_PUBLISHER_ID: 'ca-pub-1234567890123456' }
  assert.deepEqual(adConfigFromEnvironment(env), { provider: 'disabled', publisherId: null })
  assert.deepEqual(adConfigFromEnvironment({ ...env, ADS_CONSENT_READY: 'false' }), { provider: 'disabled', publisherId: null })
  assert.deepEqual(adConfigFromEnvironment({ ...env, ADS_CONSENT_READY: 'true' }), { provider: 'google-h5', publisherId: env.ADSENSE_PUBLISHER_ID, consentReady: true })
})

test('both deck shuffles use independent secure randomness and preserve every input card', t => {
  t.mock.method(Math, 'random', () => { throw new Error('insecure randomness used') })
  for (const shuffle of [shuffleConti, shufflePocha]) {
    const input = Array.from({ length: 100 }, (_, i) => i)
    assert.deepEqual(shuffle(input).sort((a, b) => a - b), input)
  }
})
