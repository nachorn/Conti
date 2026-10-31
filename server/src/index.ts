import { createGameServer } from './app.js'
import { createSnapshotStore } from './storage.js'
import { createMembershipService, adConfigFromEnvironment } from './membership.js'
import { turnstileFromEnvironment } from './turnstile.js'

const origins = (process.env.CLIENT_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean)
if (process.env.NODE_ENV === 'production' && origins.length === 0) {
  throw new Error('CLIENT_ORIGINS must list the approved website origins in production')
}
for (const origin of origins) {
  const parsed = new URL(origin)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
    throw new Error('CLIENT_ORIGINS must contain exact http(s) origins without paths or trailing slashes')
  }
}
const turnstile = turnstileFromEnvironment(process.env, origins)
const store = await createSnapshotStore()
const membership = await createMembershipService()
const server = await createGameServer(store, {
  origins,
  turnstile,
  debug: process.env.NODE_ENV !== 'production' && process.env.ENABLE_DEBUG_ACTIONS === 'true',
  dashboardKey: process.env.ADMIN_DASHBOARD_KEY,
  membership,
  adConfig: adConfigFromEnvironment(process.env),
})
// Leave proxy headers untrusted by default. Set a bounded hop count only after
// verifying that the production service cannot be reached around that proxy.
if (process.env.MEMBERSHIP_TRUST_PROXY_HOPS) {
  if (!/^[1-3]$/.test(process.env.MEMBERSHIP_TRUST_PROXY_HOPS)) throw new Error('MEMBERSHIP_TRUST_PROXY_HOPS must be 1, 2, or 3 for a verified proxy topology')
  server.app.set('trust proxy', Number(process.env.MEMBERSHIP_TRUST_PROXY_HOPS))
}
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
  try { await server.close(); await membership?.close(); clearTimeout(timeout) }
  catch { console.error('Shutdown save failed; restart will recover the last committed game'); process.exitCode = 1 }
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())

// Restart through the host supervisor after the first failed action. Do not poll
// the DB or keep a sleeping free database awake with background queries.
const recoveryWatchdog = setInterval(() => {
  if (server.repository.failed || membership?.hasFailedOperation()) void shutdown(1)
}, 1_000)
recoveryWatchdog.unref()
