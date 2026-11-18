import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, open, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { Client, ClientConfig } from 'pg'
import { GameRepository } from '../recovery.js'
import { MembershipService } from '../membership.js'
import { FileSnapshotStore, MAX_SNAPSHOT_BYTES, type SnapshotStore } from '../storage.js'
import { planDailyBackupHistory } from './backupHistory.js'

export interface LocalSnapshotPaths { game: string; membership: string }
export interface SnapshotPair { game: Record<string, any>; membership: Record<string, any> }
export class LocalPersistenceError extends Error {
  constructor(readonly code: string) { super(code) }
}
function fail(code: string): never { throw new LocalPersistenceError(code) }
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const LOCK_CLASS = 0x434f4e54
type Queryable = Pick<Client, 'query'>
export function operationPaths(env: NodeJS.ProcessEnv): LocalSnapshotPaths {
  const game = env.GAME_STATE_PATH?.trim(), membership = env.MEMBERSHIP_STATE_PATH?.trim()
  if (!game || !membership || !isAbsolute(game) || !isAbsolute(membership) || resolve(game) === resolve(membership)) fail('absolute_distinct_snapshot_paths_required')
  return { game, membership }
}
export function operationPgConfig(connectionString: string): ClientConfig {
  let url: URL
  try { url = new URL(connectionString) } catch { return fail('invalid_database_url') }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) fail('invalid_database_url')
  return { connectionString, application_name: 'nrn-local-checkpoint', enableChannelBinding: true,
    connectionTimeoutMillis: 10_000, statement_timeout: 25_000, query_timeout: 30_000,
    lock_timeout: 20_000, keepAlive: true, keepAliveInitialDelayMillis: 10_000 }
}
function decode(buffer: Buffer): Record<string, any> {
  if (buffer.length > MAX_SNAPSHOT_BYTES) fail('snapshot_size_limit')
  let value: unknown
  try { value = JSON.parse(buffer.toString('utf8')) } catch { return fail('invalid_snapshot_json') }
  if (!object(value)) fail('invalid_snapshot_object')
  return value
}
function memoryStore(value: unknown): SnapshotStore {
  return { load: async () => structuredClone(value), save: async () => fail('validation_cannot_write'), close: async () => {}, isHealthy: () => true }
}
export async function validateSnapshotPair(pair: SnapshotPair, authSecret: string): Promise<void> {
  try {
    for (const value of [pair.game, pair.membership]) {
      if (!object(value)) fail('invalid_snapshot_object')
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_SNAPSHOT_BYTES) fail('snapshot_size_limit')
    }
    if (!authSecret || authSecret.trim().length < 32) fail('existing_account_secret_required')
    // Validation never creates a user, email challenge, game, purchase or file.
    await new GameRepository(memoryStore(pair.game)).load(0)
    const membership = new MembershipService({ store: memoryStore(pair.membership), authSecret: authSecret.trim() })
    await membership.load(); await membership.close()
  } catch (error) {
    if (error instanceof LocalPersistenceError) throw error
    fail('snapshot_validation_failed')
  }
}
export function describeSnapshotPair(pair: SnapshotPair) {
  return { game: { rooms: pair.game.rooms.length, results: pair.game.results?.length ?? 0, leagues: pair.game.leagues?.length ?? 0,
    bytes: Buffer.byteLength(JSON.stringify(pair.game)), sha256: hash(JSON.stringify(pair.game)) },
  membership: { accounts: pair.membership.accounts.length, sessions: pair.membership.sessions.length,
    bytes: Buffer.byteLength(JSON.stringify(pair.membership)), sha256: hash(JSON.stringify(pair.membership)) } }
}
async function writerLocks(client: Queryable): Promise<boolean> {
  const result = await client.query<{ game: boolean; membership: boolean }>(`/* local:writer-locks */
    SELECT pg_try_advisory_xact_lock($1, 1) AS game, pg_try_advisory_xact_lock($1, 2) AS membership`, [LOCK_CLASS])
  return result.rows[0]?.game === true && result.rows[0]?.membership === true
}

/**
 * Acquire both writer locks before taking the single pair-read snapshot. READ
 * COMMITTED gives the UNION query a fresh snapshot after lock acquisition;
 * REPEATABLE READ could pin an older snapshot in the preceding lock statement.
 */
export async function readPostgresSnapshotPair(client: Queryable, authSecret: string): Promise<SnapshotPair> {
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY')
    if (!await writerLocks(client)) fail('source_writer_active')
    const result = await client.query<{ namespace: string; bytes: number; encoded: string | null }>(`/* local:read-pair */
      SELECT 'game' AS namespace, octet_length(snapshot::text) AS bytes,
        CASE WHEN octet_length(snapshot::text) <= $1 THEN snapshot::text ELSE NULL END AS encoded
      FROM conti_game_state WHERE id = 1
      UNION ALL
      SELECT 'membership' AS namespace, octet_length(snapshot::text) AS bytes,
        CASE WHEN octet_length(snapshot::text) <= $1 THEN snapshot::text ELSE NULL END AS encoded
      FROM conti_membership_state WHERE id = 1`, [MAX_SNAPSHOT_BYTES])
    if (result.rows.length !== 2 || new Set(result.rows.map(row => row.namespace)).size !== 2) fail('both_source_snapshots_required')
    const data: Partial<SnapshotPair> = {}
    for (const row of result.rows) {
      if (!['game', 'membership'].includes(row.namespace) || !Number.isSafeInteger(row.bytes) || row.bytes > MAX_SNAPSHOT_BYTES || row.encoded === null) fail('invalid_source_snapshot')
      data[row.namespace as keyof SnapshotPair] = decode(Buffer.from(row.encoded))
    }
    const pair = data as SnapshotPair
    await validateSnapshotPair(pair, authSecret)
    await client.query('COMMIT')
    return pair
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof LocalPersistenceError) throw error
    return fail('postgres_source_read_failed')
  }
}

/** Select one dated copy read-only. Restoration targets are separately chosen private files. */
export async function readPostgresHistoryPair(client: Queryable, day: string, authSecret: string): Promise<SnapshotPair> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day + 'T00:00:00.000Z')) ||
    new Date(day + 'T00:00:00.000Z').toISOString().slice(0, 10) !== day) fail('invalid_history_day')
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY')
    const result = await client.query<{ game: string | null; membership: string | null }>(`/* local:history-read */
      SELECT CASE WHEN octet_length(game_snapshot::text) <= $2 THEN game_snapshot::text ELSE NULL END AS game,
        CASE WHEN octet_length(membership_snapshot::text) <= $2 THEN membership_snapshot::text ELSE NULL END AS membership
      FROM nrn_backup_history WHERE backup_day = $1::date`, [day, MAX_SNAPSHOT_BYTES])
    if (result.rows.length !== 1 || result.rows[0].game === null || result.rows[0].membership === null) fail('dated_backup_unavailable')
    const pair = { game: decode(Buffer.from(result.rows[0].game)), membership: decode(Buffer.from(result.rows[0].membership)) }
    await validateSnapshotPair(pair, authSecret)
    await client.query('COMMIT'); return pair
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof LocalPersistenceError) throw error
    return fail('dated_backup_read_failed')
  }
}

async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return true
    return fail('snapshot_path_unavailable')
  }
}
async function syncParents(paths: string[]) {
  if (process.platform === 'win32') return
  for (const parent of new Set(paths.map(dirname))) { const directory = await open(parent, 'r'); try { await directory.sync() } finally { await directory.close() } }
}

/**
 * Both destinations must be absent. Each staged file is fsynced by the existing
 * FileSnapshotStore, then hard-linked exclusively: link never replaces a target.
 * A crash between the two links fails closed at production's pair-existence guard.
 */
export async function installLocalSnapshotPair(paths: LocalSnapshotPaths, pair: SnapshotPair, authSecret: string,
  options: { linkFile?: (source: string, destination: string) => Promise<void> } = {}): Promise<void> {
  operationPaths({ GAME_STATE_PATH: paths.game, MEMBERSHIP_STATE_PATH: paths.membership })
  await validateSnapshotPair(pair, authSecret)
  const targets = [paths.game, paths.membership]
  const locks: FileSnapshotStore[] = [], staged: string[] = []
  const created: { target: string; ino: number; dev: number }[] = []
  try {
    for (const target of targets) if (!await absent(target)) fail('local_target_already_exists')
    for (const target of targets) locks.push(await FileSnapshotStore.open(target))
    for (const target of targets) if (!await absent(target)) fail('local_target_already_exists')
    for (const [index, snapshot] of [pair.game, pair.membership].entries()) {
      const temporary = `${targets[index]}.${randomUUID()}.migration-pending`
      staged.push(temporary)
      const store = await FileSnapshotStore.open(temporary)
      try { await store.save(snapshot) } finally { await store.close() }
    }
    for (const [index, temporary] of staged.entries()) {
      const info = await lstat(temporary)
      if (!info.isFile() || info.isSymbolicLink()) fail('invalid_staged_snapshot')
      await (options.linkFile ?? link)(temporary, targets[index])
      created.push({ target: targets[index], ino: info.ino, dev: info.dev })
    }
    await syncParents(targets)
  } catch (error) {
    // Only remove a link this invocation created, never an unrelated replacement.
    for (const record of created.reverse()) {
      const info = await lstat(record.target).catch(() => null)
      if (info && info.ino === record.ino && info.dev === record.dev && !info.isSymbolicLink()) await unlink(record.target).catch(() => undefined)
    }
    if (error instanceof LocalPersistenceError) throw error
    fail('local_pair_install_failed')
  } finally {
    await Promise.allSettled(locks.map(store => store.close()))
    for (const temporary of staged) await unlink(temporary).catch(() => undefined)
  }
}

export async function readLocalSnapshotBytes(path: string): Promise<Buffer> {
  const info = await lstat(path).catch(() => null)
  if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_SNAPSHOT_BYTES) fail('invalid_local_snapshot_file')
  const file = await open(path, 'r')
  try {
    if ((await file.stat()).size > MAX_SNAPSHOT_BYTES) fail('snapshot_size_limit')
    const data = await file.readFile()
    if (data.length > MAX_SNAPSHOT_BYTES) fail('snapshot_size_limit')
    return data
  } finally { await file.close() }
}

/** Capture one committed game while the account snapshot remains unchanged. */
export async function readStableLocalSnapshotPair(paths: LocalSnapshotPaths, authSecret: string,
  options: { attempts?: number; read?: (path: string) => Promise<Buffer> } = {}): Promise<SnapshotPair> {
  operationPaths({ GAME_STATE_PATH: paths.game, MEMBERSHIP_STATE_PATH: paths.membership })
  const read = options.read ?? readLocalSnapshotBytes, attempts = options.attempts ?? 3
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5) fail('invalid_checkpoint_attempts')
  for (let attempt = 0; attempt < attempts; attempt++) {
    const accountsBefore = await read(paths.membership), game = await read(paths.game), accountsAfter = await read(paths.membership)
    if (!accountsBefore.equals(accountsAfter)) continue
    const pair = { game: decode(game), membership: decode(accountsAfter) }
    await validateSnapshotPair(pair, authSecret)
    return pair
  }
  return fail('account_snapshot_changed_during_checkpoint')
}

/** One short transaction, no persistent locks, pool, polling or SQL keepalives. */
export async function writePostgresCheckpoint(client: Queryable, pair: SnapshotPair, options: { history?: boolean; capturedAtMs?: number } = {}): Promise<'written' | 'skipped-writer-active'> {
  try {
    await client.query('BEGIN')
    if (!await writerLocks(client)) { await client.query('ROLLBACK'); return 'skipped-writer-active' }
    await client.query('SET LOCAL synchronous_commit = on')
    for (const [namespace, table] of [['game', 'conti_game_state'], ['membership', 'conti_membership_state']] as const) {
      await client.query(`/* local:write-${namespace} */ INSERT INTO ${table}(id, snapshot, updated_at)
        VALUES (1, $1::jsonb, now()) ON CONFLICT(id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`, [JSON.stringify(pair[namespace])])
    }
    if (options.history) {
      const capturedAt = options.capturedAtMs ?? Date.now()
      await client.query(`/* local:history-schema */ CREATE TABLE IF NOT EXISTS nrn_backup_history (
        backup_day date PRIMARY KEY, captured_at timestamptz NOT NULL,
        game_snapshot jsonb NOT NULL, membership_snapshot jsonb NOT NULL,
        pair_bytes integer NOT NULL CHECK (pair_bytes > 0 AND pair_bytes <= 67108864)
      )`)
      const metadata = await client.query<{ day: string; bytes: number }>(`/* local:history-metadata */
        SELECT to_char(backup_day, 'YYYY-MM-DD') AS day, pair_bytes AS bytes
        FROM nrn_backup_history ORDER BY backup_day LIMIT 100`)
      if (metadata.rows.length >= 100) fail('invalid_backup_history_metadata')
      // This first plan only checks whether today's anchor already exists/clock reversed.
      let plan = planDailyBackupHistory(metadata.rows, capturedAt, 1)
      // The existing daily anchor is never rewritten or retransmitted each hour.
      if (plan.insert) {
        const measured = await client.query<{ bytes: number }>(`/* local:history-measure */
          SELECT octet_length(g.snapshot::text) + octet_length(m.snapshot::text) AS bytes
          FROM conti_game_state g CROSS JOIN conti_membership_state m WHERE g.id=1 AND m.id=1`)
        const bytes = measured.rows[0]?.bytes
        if (!Number.isSafeInteger(bytes) || bytes < 1) fail('invalid_backup_history_size')
        plan = planDailyBackupHistory(metadata.rows, capturedAt, bytes)
        if (plan.insert) {
          await client.query(`/* local:history-insert */ INSERT INTO nrn_backup_history
            (backup_day, captured_at, game_snapshot, membership_snapshot, pair_bytes)
            SELECT $1::date, $2::timestamptz, g.snapshot, m.snapshot, $3
            FROM conti_game_state g CROSS JOIN conti_membership_state m WHERE g.id=1 AND m.id=1
            ON CONFLICT (backup_day) DO NOTHING`, [plan.day, new Date(capturedAt).toISOString(), bytes])
          if (plan.deleteDays.length) await client.query(`/* local:history-prune */ DELETE FROM nrn_backup_history
            WHERE backup_day = ANY($1::date[])`, [plan.deleteDays])
        }
      }
    }
    await client.query('COMMIT')
    return 'written'
  } catch {
    await client.query('ROLLBACK').catch(() => undefined)
    return fail('postgres_checkpoint_failed')
  }
}
