import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { describeSnapshotPair, LocalPersistenceError, operationPaths, operationPgConfig, readStableLocalSnapshotPair, writePostgresCheckpoint } from '../operations/localPersistence.js'

export async function checkpointLocalMain(args = process.argv.slice(2), env = process.env): Promise<void> {
  let client: Client | undefined
  try {
    if (args.some(arg => arg !== '--plan' && arg !== '--apply') || args.includes('--plan') && args.includes('--apply')) throw new LocalPersistenceError('unknown_checkpoint_option')
    const apply = args.includes('--apply')
    if (!env.MEMBERSHIP_AUTH_SECRET) throw new LocalPersistenceError('existing_account_secret_required')
    // Validate the coherent local pair before a database connection can wake Neon.
    const pair = await readStableLocalSnapshotPair(operationPaths(env), env.MEMBERSHIP_AUTH_SECRET)
    let status = 'plan'
    if (apply) {
      if (!env.DATABASE_URL) throw new LocalPersistenceError('private_database_environment_required')
      client = new Client(operationPgConfig(env.DATABASE_URL))
      client.on('error', () => {})
      await client.connect()
      status = await writePostgresCheckpoint(client, pair)
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', status, ...describeSnapshotPair(pair) }, null, 2))
  } catch (error) {
    console.error(error instanceof LocalPersistenceError ? error.code : 'local_checkpoint_failed')
    process.exitCode = 1
  } finally { await client?.end().catch(() => undefined) }
}
function invokedDirectly(): boolean {
  if (!process.argv[1]) return false
  try {
    // Deployment's current/ symlink and ESM resolution must identify one file.
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
  } catch { return false /* Imports with a missing/non-file argv stay inert. */ }
}
if (invokedDirectly()) void checkpointLocalMain()
