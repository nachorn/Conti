import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import { describeSnapshotPair, installLocalSnapshotPair, LocalPersistenceError, operationPaths, operationPgConfig, readPostgresSnapshotPair } from '../operations/localPersistence.js'

export async function migrateToLocalMain(args = process.argv.slice(2), env = process.env): Promise<void> {
  let client: Client | undefined
  try {
    const apply = args.includes('--apply'), expected: Record<string, string | undefined> = {}
    for (let i = 0; i < args.length; i++) {
      if (['--plan', '--apply', '--confirm-writer-stopped'].includes(args[i])) continue
      if (['--expected-game-sha256', '--expected-membership-sha256'].includes(args[i])) { expected[args[i]] = args[++i]; continue }
      throw new LocalPersistenceError('unknown_migration_option')
    }
    if (apply && (args.includes('--plan') || !args.includes('--confirm-writer-stopped') ||
      !/^[a-f0-9]{64}$/.test(expected['--expected-game-sha256'] ?? '') || !/^[a-f0-9]{64}$/.test(expected['--expected-membership-sha256'] ?? ''))) throw new LocalPersistenceError('apply_requires_reviewed_hashes_and_stopped_writer')
    const paths = operationPaths(env)
    if (!env.DATABASE_URL || !env.MEMBERSHIP_AUTH_SECRET) throw new LocalPersistenceError('private_database_and_account_environment_required')
    client = new Client(operationPgConfig(env.DATABASE_URL))
    client.on('error', () => {})
    await client.connect()
    const pair = await readPostgresSnapshotPair(client, env.MEMBERSHIP_AUTH_SECRET)
    // Release source locks and connection before local IO; old writer remains stopped.
    await client.end(); client = undefined
    const receipt = describeSnapshotPair(pair)
    if (apply) {
      if (receipt.game.sha256 !== expected['--expected-game-sha256'] || receipt.membership.sha256 !== expected['--expected-membership-sha256']) throw new LocalPersistenceError('source_changed_after_migration_plan')
      await installLocalSnapshotPair(paths, pair, env.MEMBERSHIP_AUTH_SECRET)
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'plan', ...receipt, localInstalled: apply }, null, 2))
  } catch (error) {
    console.error(error instanceof LocalPersistenceError ? error.code : 'local_migration_failed')
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
if (invokedDirectly()) void migrateToLocalMain()
