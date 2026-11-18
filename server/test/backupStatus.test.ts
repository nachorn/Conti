import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { backupAttempt, BACKUP_STALE_MS, parseBackupStatus, planBackupNotice, readBackupMetadata, writeBackupMetadata } from '../src/operations/backupStatus.js'

const now = 1900000000000
test('stale notice waits three hours, deduplicates attempts for a day, and reports recovery once', () => {
  const initial = backupAttempt(null, 'written', now)
  const fresh = planBackupNotice(initial, null, now + BACKUP_STALE_MS - 1)
  assert.equal(fresh.health, 'fresh'); assert.equal(fresh.notice, null)
  const stale = planBackupNotice(initial, fresh.state, now + BACKUP_STALE_MS)
  assert.equal(stale.notice?.kind, 'stale')
  assert.equal(planBackupNotice(initial, stale.state, now + BACKUP_STALE_MS + 3600000).notice, null)
  assert.equal(planBackupNotice(initial, stale.state, now + BACKUP_STALE_MS + 86400000).notice?.kind, 'stale')
  const success = backupAttempt(initial, 'written', now + BACKUP_STALE_MS + 1000)
  const recovered = planBackupNotice(success, stale.state, success.lastAttemptAt)
  assert.equal(recovered.notice?.kind, 'recovered')
  assert.equal(planBackupNotice(success, recovered.state, success.lastAttemptAt + 1000).notice, null)
})

test('missing status has bootstrap grace, failures retain last success, and clock reversal cannot invent recovery', () => {
  const missing = planBackupNotice(null, null, now)
  assert.equal(missing.health, 'unknown'); assert.equal(missing.notice, null)
  assert.equal(planBackupNotice(null, missing.state, now + BACKUP_STALE_MS).notice?.kind, 'stale')
  const prior = backupAttempt(null, 'written', now)
  assert.equal(backupAttempt(prior, 'failed', now + 1).lastSuccessAt, now)
  const stale = planBackupNotice(prior, null, now + BACKUP_STALE_MS)
  assert.equal(planBackupNotice(prior, stale.state, now + 1).notice, null)
  assert.throws(() => parseBackupStatus({ ...prior, lastSuccessAt: 'secret-untrusted' }), /Invalid/)
})

test('metadata is atomically replaced and refuses non-regular/symlink paths', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nrn-backup-status-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'status.json'), value = backupAttempt(null, 'written', now)
  assert.equal(await readBackupMetadata(path), null)
  await writeFile(path, '{bad optional metadata')
  await assert.rejects(readBackupMetadata(path))
  await writeBackupMetadata(path, value, 0o640)
  assert.deepEqual(parseBackupStatus(await readBackupMetadata(path)), value)
  await writeBackupMetadata(path, backupAttempt(value, 'failed', now + 1), 0o640)
  assert.equal(JSON.parse(await readFile(path, 'utf8')).outcome, 'failed')
  const directory = join(dir, 'bad'); await mkdir(directory)
  await assert.rejects(writeBackupMetadata(directory, value), /Invalid/)
  if (process.platform !== 'win32') { const link = join(dir, 'linked'); await symlink(path, link); await assert.rejects(readBackupMetadata(link), /Invalid/) }
})
