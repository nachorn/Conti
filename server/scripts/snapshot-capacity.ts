import { open } from 'node:fs/promises'
import { GameRepository } from '../src/recovery.js'
import { MembershipService } from '../src/membership.js'
import { MAX_SNAPSHOT_BYTES, snapshotCapacity, type SnapshotStore } from '../src/storage.js'

// Offline only: inspect explicitly supplied backup copies, validate restoration
// in memory, and print counts/bytes. Never connects to a database or writes files.
async function readCopy(path: string) {
  const file = await open(path, 'r')
  try {
    const bytes = (await file.stat()).size
    if (bytes > MAX_SNAPSHOT_BYTES) throw new Error('Backup copy exceeds the current storage limit')
    return { value: JSON.parse(await file.readFile('utf8')) as unknown, fileBytes: bytes }
  } finally { await file.close() }
}
function readOnlyMemoryStore(value: unknown): SnapshotStore {
  return { async load() { return structuredClone(value) }, async save() { throw new Error('Read-only backup check') }, async close() {} }
}

async function main() {
  const args = process.argv.slice(2)
  if (!args.length || args.includes('--help')) {
    console.log('Offline backup validation: node --import tsx scripts/snapshot-capacity.ts --game <game-copy.json> --membership <membership-copy.json>')
    return
  }
  if (args.length !== 4 || args[0] !== '--game' || args[2] !== '--membership' || args[1] === args[3]) {
    throw new Error('Supply separate game and membership backup copies')
  }
  const [game, membership] = await Promise.all([readCopy(args[1]), readCopy(args[3])])
  const repository = new GameRepository(readOnlyMemoryStore(game.value))
  await repository.load()
  const accounts = await new MembershipService({
    store: readOnlyMemoryStore(membership.value),
    // This validates structure only. Stored HMAC challenges are not used to log in.
    authSecret: 'offline-backup-validation-no-authentication-or-network',
  }).load()
  try {
    const result = {
      valid: true, mode: 'offline-read-only',
      game: { ...repository.storageCapacity(), fileBytes: game.fileBytes },
      membership: { ...snapshotCapacity(membership.value), fileBytes: membership.fileBytes },
      restoredInMemory: true,
      note: 'Validates the supplied copies; does not establish backup freshness or restore the live service',
    }
    console.log(JSON.stringify(result, null, 2))
    if (result.game.warning || result.membership.warning) process.exitCode = 2
  } finally { await accounts.close() }
}

main().catch(() => {
  // Parser and filesystem errors may include private source content or paths.
  console.error('Backup validation failed. Check separate valid backup copies and their size; source files were not modified.')
  process.exitCode = 1
})
