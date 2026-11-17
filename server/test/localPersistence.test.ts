import assert from 'node:assert/strict'
import test from 'node:test'
import { link, lstat, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { createSnapshotStore, FileSnapshotStore, localSnapshotPaths, MAX_SNAPSHOT_BYTES, requireInstalledLocalSnapshots, snapshotStorageMode } from '../src/storage.js'
import { createMembershipService } from '../src/membership.js'
import { authenticate, GameRepository } from '../src/recovery.js'
import { describeSnapshotPair, installLocalSnapshotPair, LocalPersistenceError, operationPaths, operationPgConfig, readPostgresSnapshotPair,
  readStableLocalSnapshotPair, validateSnapshotPair, writePostgresCheckpoint } from '../src/operations/localPersistence.js'
import { FakeLocalPg, fixtureNow, fixtureSecret, fixtureToken, snapshotFixture } from './localPersistenceFixtures.js'
import { migrateToLocalMain } from '../src/cli/migrate-to-local.js'
import { checkpointLocalMain } from '../src/cli/checkpoint-local-to-postgres.js'

async function pathsFor(t: test.TestContext) {
  const parent = await mkdtemp(join(tmpdir(), 'nrn-local-test-'))
  t.after(async () => {
    const resolved = resolve(parent), permitted = resolve(tmpdir()) + sep
    assert.ok(resolved.startsWith(permitted) && resolved.includes('nrn-local-test-'))
    await rm(resolved, { recursive: true, force: true })
  })
  return { game: join(parent, 'game.json'), membership: join(parent, 'membership.json') }
}
const absent = async (path: string) => (await lstat(path).catch(() => null)) === null

test('explicit local mode overrides DATABASE_URL for both stores and retains account and seat credentials', async t => {
  const paths = await pathsFor(t), { pair, credential } = snapshotFixture()
  await installLocalSnapshotPair(paths, pair, fixtureSecret)
  const env = { NODE_ENV: 'production', NRN_STORAGE_MODE: 'file', MEMBERSHIP_ENABLED: 'true', MEMBERSHIP_AUTH_SECRET: fixtureSecret,
    GAME_STATE_PATH: paths.game, MEMBERSHIP_STATE_PATH: paths.membership, DATABASE_URL: 'invalid-database-url-must-be-ignored' }
  const game = await createSnapshotStore(env), membership = await createMembershipService(env)
  try {
    assert.ok(game instanceof FileSnapshotStore)
    const repository = new GameRepository(game)
    await repository.load(0)
    assert.equal(authenticate(repository.records.get(credential.roomId)!, credential), true)
    assert.equal(membership?.authenticate(fixtureToken)?.id, 'fixture-account')
    assert.equal(membership?.authenticate(fixtureToken)?.hasPassword, true)
    assert.deepEqual(JSON.parse(await readFile(paths.membership, 'utf8')), pair.membership)
  } finally { await game.close(); await membership?.close() }
});

test('default selection remains unchanged and file mode requires absolute distinct production paths', async () => {
  assert.equal(snapshotStorageMode({}), 'default')
  assert.equal(snapshotStorageMode({ NRN_STORAGE_MODE: 'file' }), 'file')
  assert.throws(() => snapshotStorageMode({ NRN_STORAGE_MODE: 'postgres-typo' }))
  assert.throws(() => localSnapshotPaths({ NODE_ENV: 'production', GAME_STATE_PATH: './game', MEMBERSHIP_STATE_PATH: './member' }))
  assert.throws(() => operationPaths({ GAME_STATE_PATH: './game', MEMBERSHIP_STATE_PATH: './member' }))
  const path = resolve('same-private-test-file')
  assert.throws(() => localSnapshotPaths({ NODE_ENV: 'production', GAME_STATE_PATH: path, MEMBERSHIP_STATE_PATH: path }))
});

test('an incomplete local migration cannot start production with an empty account database', async t => {
  const paths = await pathsFor(t), { pair } = snapshotFixture()
  await writeFile(paths.game, JSON.stringify(pair.game), { mode: 0o600 })
  const env = { NODE_ENV: 'production', NRN_STORAGE_MODE: 'file', GAME_STATE_PATH: paths.game, MEMBERSHIP_STATE_PATH: paths.membership }
  await assert.rejects(requireInstalledLocalSnapshots(env), /Both local snapshots/)
  await assert.rejects(createSnapshotStore(env), /Both local snapshots/)
  assert.equal(await absent(paths.membership), true)
});

test('migration installs private snapshots unchanged and never overwrites an existing target', async t => {
  const paths = await pathsFor(t), { pair } = snapshotFixture()
  await installLocalSnapshotPair(paths, pair, fixtureSecret)
  assert.deepEqual(JSON.parse(await readFile(paths.game, 'utf8')), pair.game)
  assert.deepEqual(JSON.parse(await readFile(paths.membership, 'utf8')), pair.membership)
  if (process.platform !== 'win32') {
    assert.equal((await lstat(paths.game)).mode & 0o777, 0o600)
    assert.equal((await lstat(paths.membership)).mode & 0o777, 0o600)
  }
  await assert.rejects(installLocalSnapshotPair(paths, pair, fixtureSecret), /already_exists/)
  assert.deepEqual(JSON.parse(await readFile(paths.membership, 'utf8')), pair.membership)
  assert.deepEqual(await readdir(join(paths.game, '..')), ['game.json', 'membership.json'])
});

test('a second-file installation failure removes only this invocation links and leaves no partial pair', async t => {
  const paths = await pathsFor(t), { pair } = snapshotFixture()
  let calls = 0
  await assert.rejects(installLocalSnapshotPair(paths, pair, fixtureSecret, { linkFile: async (source, destination) => {
    if (++calls === 2) throw new Error('simulated-filesystem-failure')
    await link(source, destination)
  } }), /local_pair_install_failed/)
  assert.equal(await absent(paths.game), true)
  assert.equal(await absent(paths.membership), true)
  assert.deepEqual(await readdir(join(paths.game, '..')), [])
});

test('malformed, oversized and null snapshots refuse migration before creating files', async t => {
  const paths = await pathsFor(t), { pair } = snapshotFixture()
  await assert.rejects(installLocalSnapshotPair(paths, { ...pair, game: null as any }, fixtureSecret), /invalid_snapshot_object/)
  await assert.rejects(validateSnapshotPair({ ...pair, game: { version: 99, rooms: [] } }, fixtureSecret), /snapshot_validation_failed/)
  await assert.rejects(validateSnapshotPair({ ...pair, membership: { extra: 'x'.repeat(MAX_SNAPSHOT_BYTES) } }, fixtureSecret), /snapshot_size_limit/)
  assert.equal(await absent(paths.game), true)
});

test('PG migration reads both namespaces in one read-only transaction and checks both writer locks', async () => {
  const { pair } = snapshotFixture(), pg = new FakeLocalPg(pair)
  assert.deepEqual(await readPostgresSnapshotPair(pg.asClient(), fixtureSecret), pair)
  assert.ok(pg.queries[0].text.includes('REPEATABLE READ READ ONLY'))
  const locks = pg.queries.find(query => query.text.includes('local:writer-locks'))!
  assert.equal(locks.values[0], 0x434f4e54)
  assert.ok(locks.text.includes('1) AS game') && locks.text.includes('2) AS membership'))
  assert.ok(!pg.queries.some(query => /INSERT|UPDATE|CREATE TABLE/.test(query.text)))
  assert.equal(pg.queries.at(-1)?.text, 'COMMIT')
});

test('PG migration rejects an existing writer and exposes no driver details', async () => {
  const { pair } = snapshotFixture(), pg = new FakeLocalPg(pair)
  pg.locksAvailable = false
  await assert.rejects(readPostgresSnapshotPair(pg.asClient(), fixtureSecret), /source_writer_active/)
  assert.ok(!pg.queries.some(query => query.text.includes('read-pair')))
  assert.equal(pg.queries.at(-1)?.text, 'ROLLBACK')
  pg.locksAvailable = true; pg.failOn = 'read-pair'
  await assert.rejects(readPostgresSnapshotPair(pg.asClient(), fixtureSecret), error => error instanceof LocalPersistenceError && !String(error).includes('private-driver'))
});

test('checkpoint captures coherent files while the app owns their writer locks', async t => {
  const paths = await pathsFor(t), { pair } = snapshotFixture()
  await installLocalSnapshotPair(paths, pair, fixtureSecret)
  const game = await FileSnapshotStore.open(paths.game), accounts = await FileSnapshotStore.open(paths.membership)
  try { assert.deepEqual(await readStableLocalSnapshotPair(paths, fixtureSecret), pair) }
  finally { await game.close(); await accounts.close() }
});

test('checkpoint retries when accounts change and never accepts a mixed account interval', async t => {
  const paths = await pathsFor(t), { pair } = snapshotFixture(), changed = structuredClone(pair.membership)
  changed.sessions.push({ ...changed.sessions[0], tokenHash: 'a'.repeat(64) })
  const a = Buffer.from(JSON.stringify(pair.membership)), b = Buffer.from(JSON.stringify(changed)), game = Buffer.from(JSON.stringify(pair.game))
  const reads = [a, game, b, b, game, b]
  const captured = await readStableLocalSnapshotPair(paths, fixtureSecret, { read: async () => reads.shift()! })
  assert.deepEqual(captured.membership, changed)
  assert.equal(reads.length, 0)
  const unstable = [a, game, b, a, game, b, a, game, b]
  await assert.rejects(readStableLocalSnapshotPair(paths, fixtureSecret, { read: async () => unstable.shift()! }), /changed_during_checkpoint/)
});

test('checkpoint commits game and accounts atomically or rolls both back', async () => {
  const { pair } = snapshotFixture(), previous = structuredClone(pair)
  previous.game.savedAt = fixtureNow - 1_000
  const pg = new FakeLocalPg(previous)
  assert.equal(await writePostgresCheckpoint(pg.asClient(), pair), 'written')
  assert.deepEqual(pg.pair, pair)
  const failing = new FakeLocalPg(previous)
  failing.failOn = 'write-membership'
  await assert.rejects(writePostgresCheckpoint(failing.asClient(), pair), /postgres_checkpoint_failed/)
  assert.deepEqual(failing.pair, previous)
  assert.equal(failing.queries.at(-1)?.text, 'ROLLBACK')
});

test('checkpoint skips a live PG writer and releases transaction locks without writing', async () => {
  const { pair } = snapshotFixture(), pg = new FakeLocalPg(pair)
  pg.locksAvailable = false
  assert.equal(await writePostgresCheckpoint(pg.asClient(), pair), 'skipped-writer-active')
  assert.ok(!pg.queries.some(query => query.text.includes('local:write-')))
  assert.equal(pg.queries.at(-1)?.text, 'ROLLBACK')
});

test('receipts contain counts and hashes only, and CLI imports are inert', async () => {
  const { pair } = snapshotFixture(), receipt = JSON.stringify(describeSnapshotPair(pair))
  assert.equal(receipt.includes('fixture@example.test'), false)
  assert.equal(receipt.includes(fixtureToken), false)
  assert.equal(receipt.includes('passwordHash'), false)
  assert.equal(typeof migrateToLocalMain, 'function')
  assert.equal(typeof checkpointLocalMain, 'function')
  assert.equal(operationPgConfig('postgres://fixture@localhost/db').enableChannelBinding, true)
  assert.throws(() => operationPgConfig('not-a-url'), /invalid_database_url/)
});
