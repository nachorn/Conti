import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { backupAlertsMain } from '../src/cli/backup-alerts.js'
import { backupAttempt, writeBackupMetadata, BACKUP_STALE_MS } from '../src/operations/backupStatus.js'

test('alert CLI uses only local status, sends once to approved fixtures and recovers once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nrn-alert-cli-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const statusPath = join(dir, 'status.json'), statePath = join(dir, 'alerts.json'), now = 1900000000000
  await writeBackupMetadata(statusPath, backupAttempt(null, 'written', now))
  const env = { NRN_BACKUP_STATUS_PATH: statusPath, NRN_BACKUP_ALERT_STATE_PATH: statePath,
    NRN_BACKUP_ALERT_EMAILS: 'owner@example.test', RESEND_API_KEY: 'public-fixture-key', MEMBERSHIP_EMAIL_FROM: 'sender@example.test' }
  const sent: any[] = []
  const request: typeof fetch = async (_url, options) => { sent.push(JSON.parse(options!.body as string)); return new Response('{"id":"fixture"}', { status: 200 }) }
  await backupAlertsMain(['--plan'], env, request, () => now + BACKUP_STALE_MS)
  assert.equal(sent.length, 0)
  await assert.rejects(readFile(statePath))
  await backupAlertsMain(['--apply'], env, request, () => now + BACKUP_STALE_MS)
  assert.equal(sent.length, 1)
  await backupAlertsMain(['--apply'], env, request, () => now + BACKUP_STALE_MS + 1000)
  assert.equal(sent.length, 1)
  await writeBackupMetadata(statusPath, backupAttempt(null, 'written', now + BACKUP_STALE_MS + 2000))
  await backupAlertsMain(['--apply'], env, request, () => now + BACKUP_STALE_MS + 2000)
  assert.equal(sent.length, 2); assert.match(sent[1].subject, /restablecidas/)
})

test('an uncertain send is persisted once and never immediately resent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'nrn-alert-uncertain-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const now = 1900000000000, statusPath = join(dir, 'status.json'), statePath = join(dir, 'alerts.json')
  await writeBackupMetadata(statusPath, backupAttempt(null, 'written', now))
  const env = { NRN_BACKUP_STATUS_PATH: statusPath, NRN_BACKUP_ALERT_STATE_PATH: statePath, NRN_BACKUP_ALERT_EMAILS: 'owner@example.test',
    RESEND_API_KEY: 'public-fixture-key', MEMBERSHIP_EMAIL_FROM: 'sender@example.test' }
  let calls = 0
  const request: typeof fetch = async () => { calls++; throw new Error('private-provider-error') }
  const previousExit = process.exitCode
  try {
    await backupAlertsMain(['--apply'], env, request, () => now + BACKUP_STALE_MS)
    assert.equal(calls, 1); assert.equal(process.exitCode, 1)
    await backupAlertsMain(['--apply'], env, request, () => now + BACKUP_STALE_MS + 1000)
    assert.equal(calls, 1)
  } finally { process.exitCode = previousExit }
})
