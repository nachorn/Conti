import { randomUUID } from 'node:crypto'
import { mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { Client } from 'pg'
import lockfile from 'proper-lockfile'

/** Contains private hands and hashed recovery credentials. Never expose it over HTTP. */
export interface SnapshotStore {
  load(): Promise<unknown | null>
  save(snapshot: unknown): Promise<void>
  close(): Promise<void>
  /** Passive local status only; must not query or wake an idle database. */
  isHealthy?(): boolean
}

export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
const LOCK_STALE_MS = 10_000
const LOCK_UPDATE_MS = 2_000

function safeDatabaseErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code)
    if (/^[A-Z0-9_-]{1,40}$/i.test(code)) return code
  }
  const message = error instanceof Error ? error.message : ''
  if (/password authentication failed/i.test(message)) return 'AUTH_FAILED'
  if (/certificate|\bssl\b|\btls\b/i.test(message)) return 'TLS_ERROR'
  if (/getaddrinfo|name resolution|dns/i.test(message)) return 'DNS_ERROR'
  if (/timed?\s*out|timeout/i.test(message)) return 'TIMEOUT'
  if (/permission|privilege/i.test(message)) return 'PERMISSION_ERROR'
  return 'UNKNOWN'
}

function encodeSnapshot(snapshot: unknown): string {
  let encoded: string | undefined
  try {
    encoded = JSON.stringify(snapshot)
  } catch {
    throw new Error('Game snapshot is not valid JSON')
  }
  if (encoded === undefined) throw new Error('Game snapshot is not valid JSON')
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error('Game snapshot exceeds the storage size limit')
  }
  return encoded
}

function decodeSnapshot(encoded: string): unknown {
  if (Buffer.byteLength(encoded, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error('Saved game snapshot exceeds the storage size limit')
  }
  try {
    return JSON.parse(encoded) as unknown
  } catch {
    // Do not include the parser error: it can contain private snapshot contents.
    throw new Error('Saved game snapshot is corrupt; restore a valid backup before starting')
  }
}

function hasCode(error: unknown, code: string): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === code
}

/** Operations are ordered, and save captures its input before waiting for prior IO. */
abstract class SerialSnapshotStore implements SnapshotStore {
  private pending: Promise<unknown> = Promise.resolve()
  private closing: Promise<void> | null = null
  protected unavailable: Error | null = null

  isHealthy(): boolean {
    return this.unavailable === null && this.closing === null
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Game snapshot store is closed'))
    const result = this.pending.then(() => {
      this.assertAvailable()
      return operation()
    })
    this.pending = result.catch(() => undefined)
    return result
  }

  protected assertAvailable(): void {
    if (this.unavailable) throw this.unavailable
  }

  load(): Promise<unknown | null> {
    return this.enqueue(async () => {
      try {
        return await this.readSnapshot()
      } catch (error) {
        // Never allow a later save to overwrite a snapshot we could not read.
        this.unavailable = new Error('Saved game storage could not be loaded; restore a valid snapshot before restarting')
        throw error
      }
    })
  }

  async save(snapshot: unknown): Promise<void> {
    const encoded = encodeSnapshot(snapshot)
    return this.enqueue(() => this.writeSnapshot(encoded))
  }

  close(): Promise<void> {
    this.closing ??= this.pending.then(() => this.release())
    return this.closing
  }

  protected abstract readSnapshot(): Promise<unknown | null>
  protected abstract writeSnapshot(encoded: string): Promise<void>
  protected abstract release(): Promise<void>
}

/**
 * For local development, or an explicitly mounted persistent volume only.
 * Use one server replica and stop the old process before starting a replacement.
 * A lock lease recovers after an ungraceful stop; it is not distributed fencing
 * for multiple active game servers. Never manually remove a live writer's lock.
 */
export class FileSnapshotStore extends SerialSnapshotStore {
  private releaseLock: (() => Promise<void>) | null = null

  private constructor(private readonly filePath: string) {
    super()
  }

  static async open(filePath: string, lockRetries = 12): Promise<FileSnapshotStore> {
    const absolutePath = resolve(filePath)
    await mkdir(dirname(absolutePath), { recursive: true, mode: 0o700 })
    // Resolve the parent so two equivalent paths cannot obtain different locks.
    const canonicalPath = resolve(await realpath(dirname(absolutePath)), basename(absolutePath))
    const store = new FileSnapshotStore(canonicalPath)
    try {
      store.releaseLock = await lockfile.lock(canonicalPath, {
        realpath: false,
        stale: LOCK_STALE_MS,
        update: LOCK_UPDATE_MS,
        retries: { retries: lockRetries, factor: 1, minTimeout: 1_000, maxTimeout: 1_000 },
        onCompromised: () => {
          store.unavailable = new Error('Game storage writer lock was lost; restart this server')
        },
      })
    } catch {
      throw new Error('Cannot acquire game storage writer lock; ensure only one server uses this snapshot')
    }
    return store
  }

  protected async readSnapshot(): Promise<unknown | null> {
    let file
    try {
      file = await open(this.filePath, 'r')
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null
      throw new Error('Cannot read saved games; check persistent storage permissions')
    }
    try {
      if ((await file.stat()).size > MAX_SNAPSHOT_BYTES) {
        throw new Error('Saved game snapshot exceeds the storage size limit')
      }
      return decodeSnapshot(await file.readFile('utf8'))
    } finally {
      await file.close()
    }
  }

  protected async writeSnapshot(encoded: string): Promise<void> {
    // Same directory/filesystem is essential for atomic replacement. An abandoned
    // temporary file from a hard kill is never mistaken for a committed snapshot.
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`
    let temporaryFile
    try {
      temporaryFile = await open(temporaryPath, 'wx', 0o600)
      await temporaryFile.writeFile(encoded, 'utf8')
      await temporaryFile.sync()
      await temporaryFile.close()
      temporaryFile = undefined
      this.assertAvailable()
      await rename(temporaryPath, this.filePath)
      if (process.platform !== 'win32') {
        // Persist the directory entry as well as the file on supported hosts.
        const directory = await open(dirname(this.filePath), 'r')
        try {
          await directory.sync()
        } finally {
          await directory.close()
        }
      }
    } catch {
      // A failure after rename is deliberately reported as uncertain, not success.
      this.unavailable = new Error('Unable to save games durably; game actions must remain paused')
      throw this.unavailable
    } finally {
      await temporaryFile?.close().catch(() => undefined)
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  protected async release(): Promise<void> {
    await this.releaseLock?.()
    this.releaseLock = null
  }
}

/**
 * Use a direct PostgreSQL connection (or session-mode pool), not a transaction
 * pooler: the exclusive writer lock belongs to this connection's session.
 * Keep a single server replica; rolling overlap must be disabled for this model.
 */
export class PostgresSnapshotStore extends SerialSnapshotStore {
  private constructor(private readonly client: Client) {
    super()
    client.on('error', () => {
      this.unavailable = new Error('Game database connection was lost; restart this server')
    })
    client.on('end', () => {
      this.unavailable = new Error('Game database connection is closed')
    })
  }

  static async open(connectionString: string): Promise<PostgresSnapshotStore> {
    let client: Client | undefined
    try {
      const parsed = new URL(connectionString)
      if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error('Invalid database URL')
      }
      client = new Client({
        connectionString,
        application_name: 'conti-game-server',
        // Neon connection strings request SCRAM channel binding. Opt in so the
        // driver can use SCRAM-SHA-256-PLUS when the server offers it.
        enableChannelBinding: true,
        connectionTimeoutMillis: 10_000,
        statement_timeout: 25_000,
        query_timeout: 30_000,
        lock_timeout: 20_000,
        keepAlive: true,
        keepAliveInitialDelayMillis: 10_000,
        // TLS is controlled by the supplied URL / pg settings. Do not disable
        // certificate verification to work around deployment configuration.
      })
      const store = new PostgresSnapshotStore(client)
      await client.connect()
      // A bounded wait accommodates a graceful predecessor shutting down. Fixed
      // lock IDs isolate Conti's singleton writer within this database.
      await client.query('SELECT pg_advisory_lock($1, $2)', [0x434f4e54, 1])
      await client.query(`
        CREATE TABLE IF NOT EXISTS conti_game_state (
          id smallint PRIMARY KEY CHECK (id = 1),
          snapshot jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `)
      return store
    } catch (error) {
      // Keep credentials and raw driver messages out of hosted logs while still
      // exposing enough of the failure class to diagnose deployment safely.
      console.error(`Game database startup failed (${safeDatabaseErrorCode(error)})`)
      await client?.end().catch(() => undefined)
      // Connection errors can include credentials; return an actionable safe error.
      throw new Error('Cannot open game database or acquire its writer lock; verify DATABASE_URL and stop the previous server')
    }
  }

  protected async readSnapshot(): Promise<unknown | null> {
    try {
      const result = await this.client.query<{ bytes: number; encoded: string | null }>(`
        SELECT octet_length(snapshot::text) AS bytes,
          CASE WHEN octet_length(snapshot::text) <= $1 THEN snapshot::text ELSE NULL END AS encoded
        FROM conti_game_state WHERE id = 1
      `, [MAX_SNAPSHOT_BYTES])
      const row = result.rows[0]
      if (!row) return null
      if (row.bytes > MAX_SNAPSHOT_BYTES || row.encoded === null) {
        throw new Error('Saved game snapshot exceeds the storage size limit')
      }
      return decodeSnapshot(row.encoded)
    } catch {
      throw new Error('Cannot load saved games from the database; startup must stop to protect existing games')
    }
  }

  protected async writeSnapshot(encoded: string): Promise<void> {
    try {
      await this.client.query('BEGIN')
      // Do not inherit an asynchronous commit setting that could acknowledge a
      // saved turn before PostgreSQL has flushed its write-ahead log.
      await this.client.query('SET LOCAL synchronous_commit = on')
      await this.client.query(`
        INSERT INTO conti_game_state (id, snapshot, updated_at) VALUES (1, $1::jsonb, now())
        ON CONFLICT (id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at
      `, [encoded])
      await this.client.query('COMMIT')
    } catch {
      await this.client.query('ROLLBACK').catch(() => undefined)
      this.unavailable = new Error('Unable to save games durably; game actions must remain paused')
      throw this.unavailable
    }
  }

  protected async release(): Promise<void> {
    // Ending the session releases its advisory lock even after an error.
    await this.client.end()
  }
}

/** Production must opt into external PostgreSQL or an actual durable volume. */
export async function createSnapshotStore(env: NodeJS.ProcessEnv = process.env): Promise<SnapshotStore> {
  const databaseUrl = env.DATABASE_URL?.trim()
  if (databaseUrl) return PostgresSnapshotStore.open(databaseUrl)
  const snapshotPath = env.GAME_STATE_PATH?.trim()
  if (snapshotPath) return FileSnapshotStore.open(snapshotPath)
  if (env.NODE_ENV === 'production' || env.RAILWAY_ENVIRONMENT_ID || env.RENDER === 'true') {
    throw new Error('Game recovery requires DATABASE_URL or GAME_STATE_PATH on a persistent mounted volume in production')
  }
  return FileSnapshotStore.open('./data/games.json')
}
