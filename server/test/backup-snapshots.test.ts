import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'
import { backupSnapshots, readPostgresSnapshots, type SnapshotCopies, type SnapshotQueryClient } from '../scripts/backup-snapshots.ts'
import { MAX_SNAPSHOT_BYTES } from '../src/storage.js'

function copies(): SnapshotCopies {
  return {
    game: JSON.stringify({ version: 1, savedAt: Date.now(), rooms: [] }),
    membership: JSON.stringify({ version: 1, accounts: [{ id: 'private-account', email: 'private@example.test', createdAt: 1 }],
      sessions: [], challenges: [], limits: [], grants: [], orders: [], revokedPayments: [], events: [] }),
  }
}
const row = (encoded: string) => ({ rows: [{ bytes: Buffer.byteLength(encoded), encoded }] })

test('PostgreSQL reads both snapshots in one read-only repeatable view, despite a concurrent source change', async () => {
  const initial = copies(), current = { ...initial }, queries: string[] = []
  let pinned: SnapshotCopies | undefined
  const client: SnapshotQueryClient = { async query(sql, values) {
    queries.push(sql.trim())
    if (sql.startsWith('BEGIN')) { pinned = { ...current }; return { rows: [] } }
    if (sql.includes('FROM conti_game_state')) {
      assert.deepEqual(values, [MAX_SNAPSHOT_BYTES])
      current.membership = JSON.stringify({ changed: 'after-the-first-read' })
      return row(pinned!.game)
    }
    if (sql.includes('FROM conti_membership_state')) {
      assert.deepEqual(values, [MAX_SNAPSHOT_BYTES])
      return row(pinned!.membership)
    }
    return { rows: [] }
  } }
  assert.deepEqual(await readPostgresSnapshots(client), initial)
  assert.notEqual(current.membership, initial.membership)
  assert.equal(queries[0], 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  assert.equal(queries.at(-1), 'COMMIT')
  assert.equal(queries.filter(sql => sql.includes('FROM ')).length, 2)
  assert.ok(queries.some(sql => sql.includes('statement_timeout')))
  assert.ok(queries.some(sql => sql.includes('lock_timeout')))
  assert.ok(queries.filter(sql => sql.includes('FROM ')).every(sql => sql.includes('CASE WHEN octet_length(snapshot::text) <= $1')))
  assert.equal(queries.some(sql => /pg_advisory|CREATE|INSERT|UPDATE|DELETE|ALTER|DROP/i.test(sql)), false)
})

test('an oversized second snapshot rolls back without returning a partial backup', async () => {
  const queries: string[] = [], valid = copies()
  const client: SnapshotQueryClient = { async query(sql) {
    queries.push(sql.trim())
    if (sql.includes('FROM conti_game_state')) return row(valid.game)
    if (sql.includes('FROM conti_membership_state')) return { rows: [{ bytes: MAX_SNAPSHOT_BYTES + 1, encoded: null }] }
    return { rows: [] }
  } }
  await assert.rejects(readPostgresSnapshots(client), /capacity|unavailable/)
  assert.equal(queries.at(-1), 'ROLLBACK')
  assert.equal(queries.includes('COMMIT'), false)
})

test('valid copies export to a fresh private directory with exact contents and a final hash manifest', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'nrn-snapshot-export-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  const valid = copies()
  let closed = 0
  const reader = { async read() { return valid }, async close() { closed++ } }
  const first = await backupSnapshots(parent, reader)
  const second = await backupSnapshots(parent, reader)
  assert.equal(closed, 2)
  assert.equal(first.complete, true)
  assert.notEqual(first.backupDirectory, second.backupDirectory)
  assert.equal(await readFile(join(first.backupDirectory, 'game.json'), 'utf8'), valid.game)
  assert.equal(await readFile(join(first.backupDirectory, 'membership.json'), 'utf8'), valid.membership)
  assert.deepEqual((await readdir(first.backupDirectory)).sort(), ['game.json', 'manifest.json', 'membership.json'])
  const manifest = JSON.parse(await readFile(join(first.backupDirectory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.kind, 'nrn-application-snapshots')
  assert.equal(manifest.isolation, 'repeatable-read-read-only')
  assert.equal(manifest.maxSnapshotBytes, MAX_SNAPSHOT_BYTES)
  for (const [file, encoded] of [['game.json', valid.game], ['membership.json', valid.membership]]) {
    assert.equal(manifest.files[file].bytes, Buffer.byteLength(encoded))
    assert.equal(manifest.files[file].sha256, createHash('sha256').update(encoded).digest('hex'))
    if (process.platform !== 'win32') assert.equal((await stat(join(first.backupDirectory, file))).mode & 0o777, 0o600)
  }
  if (process.platform !== 'win32') assert.equal((await stat(first.backupDirectory)).mode & 0o777, 0o700)
  assert.doesNotMatch(JSON.stringify(first), /private-account|private@example/)
  assert.doesNotMatch(JSON.stringify(manifest), /private-account|private@example/)
})

test('both snapshots validate before any export directory exists, and the reader closes after failure', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'nrn-snapshot-invalid-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  for (const invalid of ['{"private@example.test":', JSON.stringify({ version: 999 }), 'x'.repeat(MAX_SNAPSHOT_BYTES + 1)]) {
    let closed = false
    const reader = { async read() { return { ...copies(), membership: invalid } }, async close() { closed = true } }
    await assert.rejects(backupSnapshots(parent, reader))
    assert.equal(closed, true)
    assert.deepEqual(await readdir(parent), [])
  }
})

test('a missing parent is refused without reading the database and help works without network or database configuration', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'nrn-snapshot-help-test-'))
  t.after(() => rm(parent, { recursive: true, force: true }))
  let reads = 0, closed = false
  await assert.rejects(backupSnapshots(join(parent, 'does-not-exist'), {
    async read() { reads++; return copies() }, async close() { closed = true },
  }))
  assert.equal(reads, 0)
  assert.equal(closed, true)
  const run = promisify(execFile)
  const script = fileURLToPath(new URL('../scripts/backup-snapshots.ts', import.meta.url))
  const { stdout, stderr } = await run(process.execPath, ['--import', 'tsx', script, '--help'], {
    env: { ...process.env, DATABASE_URL: 'invalid-private-connection-string-for-help-test' },
  })
  assert.match(stdout, /--directory/)
  assert.match(stdout, /Does not restore or modify the database/)
  assert.doesNotMatch(stdout + stderr, /invalid-private-connection-string/)
  assert.equal(stderr, '')
})
