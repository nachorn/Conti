import { lstat, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BackupNotice } from '../membershipEmail.js'

export const BACKUP_STALE_MS = 3 * 60 * 60 * 1000
const REMINDER_MS = 24 * 60 * 60 * 1000
export interface BackupStatus { version: 1; lastSuccessAt: number | null; lastAttemptAt: number; outcome: 'written' | 'failed' | 'skipped-writer-active' }
export interface BackupAlertState { version: 1; firstObservedAt: number; incident: string | null; lastStaleAttemptAt: number | null; lastRecoveryAttemptAt: number | null }
const timestamp = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0 && (x as number) <= 8.64e15
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
export function parseBackupStatus(x: unknown): BackupStatus {
  if (!object(x) || x.version !== 1 || !timestamp(x.lastAttemptAt) || !(x.lastSuccessAt === null || timestamp(x.lastSuccessAt)) ||
    !['written', 'failed', 'skipped-writer-active'].includes(x.outcome as string)) throw new Error('Invalid backup status metadata')
  return { version: 1, lastSuccessAt: x.lastSuccessAt as number | null, lastAttemptAt: x.lastAttemptAt, outcome: x.outcome as BackupStatus['outcome'] }
}
export function parseBackupAlertState(x: unknown): BackupAlertState {
  if (!object(x) || x.version !== 1 || !timestamp(x.firstObservedAt) || !(x.incident === null || typeof x.incident === 'string' && /^(missing|\d{1,16})$/.test(x.incident)) ||
    ![x.lastStaleAttemptAt, x.lastRecoveryAttemptAt].every(v => v === null || timestamp(v))) throw new Error('Invalid backup alert metadata')
  return { version: 1, firstObservedAt: x.firstObservedAt, incident: x.incident as string | null, lastStaleAttemptAt: x.lastStaleAttemptAt as number | null, lastRecoveryAttemptAt: x.lastRecoveryAttemptAt as number | null }
}
export async function readBackupMetadata(path: string): Promise<unknown | null> {
  if (!isAbsolute(path)) throw new Error('Absolute backup metadata path required')
  const info = await lstat(path).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e })
  if (!info) return null
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw new Error('Invalid backup metadata file')
  const bytes = await readFile(path)
  if (bytes.length > 4096) throw new Error('Backup metadata limit exceeded')
  return JSON.parse(bytes.toString('utf8'))
}
export async function writeBackupMetadata(path: string, value: BackupStatus | BackupAlertState, mode = 0o600): Promise<void> {
  if (!isAbsolute(path) || ![0o600, 0o640].includes(mode)) throw new Error('Private absolute backup metadata path required')
  const parent = await lstat(dirname(path))
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('Private backup metadata directory required')
  const data = JSON.stringify(value) + '\n'
  if (Buffer.byteLength(data) > 4096) throw new Error('Backup metadata limit exceeded')
  const target = await lstat(path).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return null; throw e })
  if (target && (!target.isFile() || target.isSymbolicLink())) throw new Error('Invalid backup metadata target')
  const temporary = join(dirname(path), '.' + randomUUID() + '.pending')
  try {
    const file = await open(temporary, 'wx', mode)
    try { await file.writeFile(data); await file.chmod(mode); await file.sync() } finally { await file.close() }
    await rename(temporary, path)
    if (process.platform !== 'win32') { const directory = await open(dirname(path), 'r'); try { await directory.sync() } finally { await directory.close() } }
  } finally { await unlink(temporary).catch(() => {}) }
}
export function backupAttempt(previous: BackupStatus | null, outcome: BackupStatus['outcome'], now: number): BackupStatus {
  if (!timestamp(now)) throw new Error('Invalid backup attempt clock')
  return { version: 1, lastAttemptAt: now, lastSuccessAt: outcome === 'written' ? now : previous?.lastSuccessAt ?? null, outcome }
}
/** Persist returned state BEFORE sending. Unknown/failed delivery is never immediately retried. */
export function planBackupNotice(status: BackupStatus | null, prior: BackupAlertState | null, now: number): { state: BackupAlertState; notice: BackupNotice | null; health: 'fresh' | 'stale' | 'unknown' } {
  if (!timestamp(now)) throw new Error('Invalid backup monitor clock')
  const state: BackupAlertState = prior && prior.firstObservedAt <= now ? { ...prior } : { version: 1, firstObservedAt: now, incident: null, lastStaleAttemptAt: null, lastRecoveryAttemptAt: null }
  const success = status && status.lastSuccessAt !== null && timestamp(status.lastSuccessAt) && status.lastSuccessAt <= now ? status.lastSuccessAt : null
  const fresh = success !== null && now - success < BACKUP_STALE_MS
  const health = fresh ? 'fresh' : success === null && now - state.firstObservedAt < BACKUP_STALE_MS ? 'unknown' : 'stale'
  if (fresh && state.incident !== null && success !== null && (state.incident === 'missing' || success > Number(state.incident))) {
    state.incident = null; state.lastRecoveryAttemptAt = now
    return { state, health, notice: { kind: 'recovered', lastSuccessfulAt: success, observedAt: now } }
  }
  if (health !== 'stale') return { state, health, notice: null }
  const incident = success === null ? 'missing' : String(success)
  if (state.incident !== incident || state.lastStaleAttemptAt === null || now - state.lastStaleAttemptAt >= REMINDER_MS) {
    state.incident = incident; state.lastStaleAttemptAt = now
    return { state, health, notice: { kind: 'stale', lastSuccessfulAt: success, observedAt: now } }
  }
  return { state, health, notice: null }
}
