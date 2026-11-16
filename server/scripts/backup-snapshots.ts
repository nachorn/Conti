import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmod, mkdtemp, open, realpath, rename, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { Client } from 'pg'
import { GameRepository } from '../src/recovery.js'
import { MembershipService } from '../src/membership.js'
import { MAX_SNAPSHOT_BYTES, type SnapshotStore } from '../src/storage.js'

export interface SnapshotCopies { game: string; membership: string }
export interface SnapshotReader { read(): Promise<SnapshotCopies>; close(): Promise<void> }
export interface SnapshotQueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: { bytes?: number; encoded?: string | null }[] }>
}

/** One MVCC view across both application tables; no writer lock or schema work. */
export async function readPostgresSnapshots(client: SnapshotQueryClient): Promise<SnapshotCopies> {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
  try {
    await client.query("SET LOCAL statement_timeout = '25s'")
    await client.query("SET LOCAL lock_timeout = '5s'")
    const read = async (table: 'conti_game_state' | 'conti_membership_state') => {
      const result = await client.query(`
        SELECT octet_length(snapshot::text) AS bytes,
          CASE WHEN octet_length(snapshot::text) <= $1 THEN snapshot::text ELSE NULL END AS encoded
        FROM ${table} WHERE id = 1
      `, [MAX_SNAPSHOT_BYTES])
      if (result.rows.length === 0) return 'null'
      const row = result.rows[0]
      if (result.rows.length !== 1 || !Number.isSafeInteger(row.bytes) || Number(row.bytes) < 0 ||
          Number(row.bytes) > MAX_SNAPSHOT_BYTES || typeof row.encoded !== 'string' ||
          Buffer.byteLength(row.encoded, 'utf8') !== Number(row.bytes)) throw new Error('Snapshot capacity or data unavailable')
      return row.encoded
    }
    const game = await read('conti_game_state')
    const membership = await read('conti_membership_state')
    await client.query('COMMIT')
    return { game, membership }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

function postgresReader(connectionString: string): SnapshotReader {
  const url = new URL(connectionString)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) throw new Error('Invalid database configuration')
  const client = new Client({ connectionString, application_name: 'nrn-snapshot-backup',
    connectionTimeoutMillis: 10_000, statement_timeout: 25_000, query_timeout: 30_000,
    lock_timeout: 5_000, enableChannelBinding: true,
    // Preserve pg/URL TLS settings; never disable certificate checks here.
  })
  // Pending queries reject normally. An idle disconnect after capture must not
  // become an unhandled event that prints a raw provider error or private URL.
  client.on('error', () => undefined)
  return {
    async read() { await client.connect(); return readPostgresSnapshots(client as unknown as SnapshotQueryClient) },
    async close() { await client.end() },
  }
}

function memoryStore(value: unknown): SnapshotStore {
  return { async load() { return structuredClone(value) }, async save() { throw new Error('Read-only backup validation') }, async close() {} }
}

async function validateCopies(copies: SnapshotCopies) {
  for (const encoded of [copies.game, copies.membership]) {
    if (typeof encoded !== 'string' || Buffer.byteLength(encoded, 'utf8') > MAX_SNAPSHOT_BYTES) throw new Error('Snapshot capacity exceeded')
  }
  const repository = new GameRepository(memoryStore(JSON.parse(copies.game)))
  await repository.load()
  const membership = await new MembershipService({ store: memoryStore(JSON.parse(copies.membership)),
    authSecret: 'offline-backup-validation-no-authentication-or-network' }).load()
  try { return { game: repository.storageCapacity(), membership: membership.storageCapacity() } }
  finally { await membership.close() }
}

/** mkdtemp is owner-only on POSIX; Windows requires a private explicit ACL. */
async function makePrivateDirectory(parent: string) {
  const directory = await mkdtemp(join(parent, 'nrn-snapshots-'))
  if (process.platform === 'win32') {
    const run = promisify(execFile)
    const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { timeout: 5_000, windowsHide: true })
    const sid = stdout.match(/S-1-\d+(?:-\d+)+/)?.[0]
    if (!sid) throw new Error('Cannot establish backup folder owner')
    await run('icacls.exe', [directory, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { timeout: 5_000, windowsHide: true })
  } else await chmod(directory, 0o700)
  return directory
}

async function writePrivateFile(path: string, encoded: string) {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(encoded, 'utf8'); await file.sync() }
  finally { await file.close() }
}

/** Exports app snapshots only, not a complete PostgreSQL/schema backup. */
export async function backupSnapshots(directory: string, reader: SnapshotReader) {
  try {
    const parent = await realpath(resolve(directory))
    if (!(await stat(parent)).isDirectory()) throw new Error('Backup parent must be an existing directory')
    const copies = await reader.read()
    const capacity = await validateCopies(copies)
    // No export folder or private file exists until both copies validate.
    const destination = await makePrivateDirectory(parent)
    const files = {
      'game.json': { bytes: Buffer.byteLength(copies.game, 'utf8'), sha256: createHash('sha256').update(copies.game).digest('hex') },
      'membership.json': { bytes: Buffer.byteLength(copies.membership, 'utf8'), sha256: createHash('sha256').update(copies.membership).digest('hex') },
    }
    await writePrivateFile(join(destination, 'game.json'), copies.game)
    await writePrivateFile(join(destination, 'membership.json'), copies.membership)
    const manifest = { version: 1, kind: 'nrn-application-snapshots', createdAt: new Date().toISOString(),
      isolation: 'repeatable-read-read-only', maxSnapshotBytes: MAX_SNAPSHOT_BYTES, files }
    await writePrivateFile(join(destination, 'manifest.json.pending'), JSON.stringify(manifest, null, 2))
    await rename(join(destination, 'manifest.json.pending'), join(destination, 'manifest.json'))
    if (process.platform !== 'win32') {
      const folder = await open(destination, 'r')
      try { await folder.sync() } finally { await folder.close() }
    }
    return { backupDirectory: destination, complete: true, capacity }
  } finally { await reader.close() }
}

export async function main(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    console.log('Usage: node --import tsx scripts/backup-snapshots.ts --directory <existing-parent>\nSet DATABASE_URL privately in the environment first. Exports only the two application snapshots to a new private folder. Does not restore or modify the database.')
    return
  }
  if (args.length !== 2 || args[0] !== '--directory' || !args[1] || !env.DATABASE_URL?.trim()) throw new Error('Invalid backup arguments or environment')
  const result = await backupSnapshots(args[1], postgresReader(env.DATABASE_URL.trim()))
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    // Never print SQL/driver/parser errors, connection strings, recipients or snapshots.
    console.error('Snapshot backup failed. Check the private database configuration, read access, capacity and output folder. Only a valid manifest marks a complete export.')
    process.exitCode = 1
  })
}
