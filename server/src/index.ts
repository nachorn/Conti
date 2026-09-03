import { createGameServer } from './app.js'
import { createSnapshotStore } from './storage.js'

const store = await createSnapshotStore()
const server = await createGameServer(store, {
  origins: (process.env.CLIENT_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  debug: process.env.ENABLE_DEBUG_ACTIONS === 'true',
})
const port = await server.listen(Number(process.env.PORT) || 3001)
console.log(`Continental Rummy server listening on port ${port}; game recovery enabled`)

let stopping = false
async function shutdown(exitCode = 0) {
  if (stopping) return
  stopping = true
  clearInterval(recoveryWatchdog)
  process.exitCode = exitCode
  const timeout = setTimeout(() => process.exit(1), 8_000)
  timeout.unref()
  try { await server.close(); clearTimeout(timeout) }
  catch { console.error('Shutdown save failed; restart will recover the last committed game'); process.exitCode = 1 }
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

// Restart through the host supervisor after the first failed action. Do not poll
// the DB or keep a sleeping free database awake with background queries.
const recoveryWatchdog = setInterval(() => {
  if (server.repository.failed) void shutdown(1)
}, 1_000)
recoveryWatchdog.unref()
