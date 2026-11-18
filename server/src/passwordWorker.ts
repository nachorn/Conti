import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const PASSWORD_WORK_PATH = '/internal/password/derive'
const CONTEXT = 'nrnplay:password-worker:v1'
const MAX_BODY = 4096, MAX_READERS = 32, WINDOW_MS = 30_000, MAX_REPLAYS = 4096
const NONCE = /^[A-Za-z0-9_-]{22}$/, MAC = /^[A-Za-z0-9_-]{43}$/
const HEADERS = { timestamp: 'x-nrn-password-timestamp', nonce: 'x-nrn-password-nonce', signature: 'x-nrn-password-signature', response: 'x-nrn-password-response' } as const
const digest = (body: Uint8Array) => createHash('sha256').update(body).digest('hex')
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
function legacySigningKey(authSecret: string) {
  const secret = authSecret.trim()
  if (secret.length < 32) throw new Error('Password worker requires the existing account authentication secret')
  return createHmac('sha256', secret).update(CONTEXT).digest()
}
/** Offline derivation for a separately provisioned worker; never print this credential. */
export function derivePasswordWorkerSigningKey(authSecret: string): string {
  const key = legacySigningKey(authSecret)
  try { return key.toString('base64url') } finally { key.fill(0) }
}
type WorkerCredentials = { authSecret?: string; signingKey?: string }
function signingKey(options: WorkerCredentials): Buffer {
  if (options.signingKey === undefined) return legacySigningKey(options.authSecret ?? '')
  if (typeof options.signingKey !== 'string' || !MAC.test(options.signingKey)) throw new Error('Password worker signing key must be canonical 32-byte base64url')
  const key = Buffer.from(options.signingKey, 'base64url')
  if (key.length !== 32 || key.toString('base64url') !== options.signingKey) throw new Error('Password worker signing key must be canonical 32-byte base64url')
  return key
}
function signature(key: Buffer, timestamp: string, nonce: string, body: Uint8Array) {
  return createHmac('sha256', key).update(`${timestamp}\n${nonce}\nPOST\n${PASSWORD_WORK_PATH}\n${digest(body)}`).digest('base64url')
}
function responseSignature(key: Buffer, timestamp: string, nonce: string, status: number, body: Uint8Array) {
  return createHmac('sha256', key).update(`response\n${timestamp}\n${nonce}\n${status}\n${digest(body)}`).digest('base64url')
}
const validPassword = (password: unknown): password is string => typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= 512
function saltFrom(value: unknown): Buffer | null {
  if (typeof value !== 'string' || !NONCE.test(value)) return null
  const salt = Buffer.from(value, 'base64url')
  return salt.length === 16 && salt.toString('base64url') === value ? salt : null
}
function fixedOrigin(origin: string) {
  const url = new URL(origin)
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.port) throw new Error('Password worker URL must be an exact HTTPS origin')
  return url.origin
}
export class PasswordWorkerUnavailable extends Error {
  constructor() { super('Password worker unavailable') }
}

async function readResponse(response: Response): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > 256) { await response.body?.cancel(); throw new PasswordWorkerUnavailable() }
  if (!response.body) throw new PasswordWorkerUnavailable()
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const item = await reader.read()
      if (item.done) return Buffer.concat(chunks, length)
      length += item.value.length
      if (length > 256) { await reader.cancel(); throw new PasswordWorkerUnavailable() }
      chunks.push(item.value)
    }
  } finally { reader.releaseLock() }
}

/** No account identifier, stored hash or session credential is sent to the worker. */
export function createPasswordWorkClient(options: {
  origin: string; request?: typeof fetch; now?: () => number; timeoutMs?: number
} & WorkerCredentials) {
  if (!options.request && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Password worker requires verified TLS')
  const origin = fixedOrigin(options.origin), key = signingKey(options)
  const request = options.request ?? fetch, now = options.now ?? Date.now
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 4000, 4000))
  return {
    async derive(password: string, salt: Buffer): Promise<Buffer> {
      if (!validPassword(password) || !Buffer.isBuffer(salt) || salt.length !== 16) throw new PasswordWorkerUnavailable()
      const timestamp = String(now()), nonce = randomBytes(16).toString('base64url')
      const body = Buffer.from(JSON.stringify({ password, salt: salt.toString('base64url') }))
      const outbound = new Uint8Array(body)
      const controller = new AbortController()
      let timer: NodeJS.Timeout | undefined
      try {
        return await Promise.race([
          (async () => {
            const response = await request(origin + PASSWORD_WORK_PATH, { method: 'POST',
              headers: { 'Content-Type': 'application/json', [HEADERS.timestamp]: timestamp, [HEADERS.nonce]: nonce,
                [HEADERS.signature]: signature(key, timestamp, nonce, body) },
              body: outbound, signal: controller.signal, redirect: 'manual', cache: 'no-store', credentials: 'omit',
            })
            if (response.status !== 200) { await response.body?.cancel(); throw new PasswordWorkerUnavailable() }
            const bytes = await readResponse(response), proof = response.headers.get(HEADERS.response) ?? ''
            if (!MAC.test(proof) || !same(proof, responseSignature(key, timestamp, nonce, 200, bytes))) throw new PasswordWorkerUnavailable()
            const value: unknown = JSON.parse(bytes.toString('utf8'))
            if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).join(',') !== 'key') throw new PasswordWorkerUnavailable()
            const encoded = (value as { key?: unknown }).key
            if (typeof encoded !== 'string' || !MAC.test(encoded)) throw new PasswordWorkerUnavailable()
            const result = Buffer.from(encoded, 'base64url')
            if (result.length !== 32 || result.toString('base64url') !== encoded) throw new PasswordWorkerUnavailable()
            return result
          })(),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new PasswordWorkerUnavailable()) }, timeoutMs) }),
        ])
      } catch { throw new PasswordWorkerUnavailable() }
      finally { if (timer) clearTimeout(timer); body.fill(0); outbound.fill(0) }
    },
  }
}

type Job = { password: string; salt: Buffer; res: ServerResponse; timestamp: string; nonce: string; cancelled: () => void }
export interface PasswordWorkHandler {
  (req: IncomingMessage, res: ServerResponse): boolean
  status(): { active: number; queued: number }
  close(): Promise<void>
}

/** Standalone Node handler suitable for the existing Render proxy process. */
export function createPasswordWorkHandler(options: WorkerCredentials & { now?: () => number }): PasswordWorkHandler {
  const key = signingKey(options), now = options.now ?? Date.now
  const replays = new Map<string, number>(), waiting: Job[] = []
  // Signatures cannot be verified before the body arrives. Bound that untrusted work too.
  const readers = new Set<() => void>()
  let active: Job | null = null, closing = false
  const closed: (() => void)[] = []
  const send = (res: ServerResponse, status: number, data: unknown, timestamp = '', nonce = '') => {
    if (res.destroyed || res.writableEnded) return
    const body = Buffer.from(JSON.stringify(data))
    try {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff')
      if (status >= 400) res.setHeader('Connection', 'close')
      if (status === 200) res.setHeader(HEADERS.response, responseSignature(key, timestamp, nonce, status, body))
      res.end(body)
    } catch { res.destroy() }
  }
  const busy = (res: ServerResponse) => send(res, 503, { error: 'password_work_busy' })
  const finish = () => {
    active = null
    const next = waiting.shift()
    if (next) run(next)
    else if (closing) { key.fill(0); for (const resolve of closed.splice(0)) resolve() }
  }
  const run = (job: Job) => {
    job.res.off('close', job.cancelled)
    if (closing || job.res.destroyed) { job.password = ''; job.salt.fill(0); busy(job.res); finish(); return }
    active = job
    // Match the canonical scrypt-v1 format exactly. Clients cannot change cost.
    try {
      scrypt(job.password, job.salt, 32, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, result) => {
        job.password = ''; job.salt.fill(0)
        if (error) busy(job.res)
        else { send(job.res, 200, { key: result.toString('base64url') }, job.timestamp, job.nonce); result.fill(0) }
        finish()
      })
    } catch { job.password = ''; job.salt.fill(0); busy(job.res); finish() }
  }

  const dispatch = async (req: IncomingMessage, res: ServerResponse) => {
    if (closing) { busy(res); req.resume(); return }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(res, 405, { error: 'invalid_request' }); req.resume(); return }
    const header = (name: string) => typeof req.headers[name] === 'string' ? req.headers[name] as string : ''
    const timestamp = header(HEADERS.timestamp), nonce = header(HEADERS.nonce), proof = header(HEADERS.signature)
    const fresh = () => /^\d{1,16}$/.test(timestamp) && Number.isSafeInteger(Number(timestamp)) && Math.abs(now() - Number(timestamp)) <= WINDOW_MS
    if (!fresh() || !NONCE.test(nonce) || !MAC.test(proof)) { send(res, 401, { error: 'unauthorized' }); req.resume(); return }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(header('content-type')) ||
      (header('content-encoding') && header('content-encoding') !== 'identity')) { send(res, 415, { error: 'invalid_request' }); req.resume(); return }
    if (Number(header('content-length')) > MAX_BODY) { send(res, 413, { error: 'invalid_request' }); req.resume(); return }
    if (readers.size >= MAX_READERS) { busy(res); req.resume(); return }
    let body: Buffer | undefined
    try {
      body = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []; let length = 0, settled = false
        const timer = setTimeout(() => { if (!settled) { cleanup(); reject(new Error('Invalid request')); req.destroy() } }, 5000)
        const cleanup = () => {
          settled = true; clearTimeout(timer); readers.delete(cancel); chunks.length = 0
          req.off('data', data); req.off('end', end); req.off('error', error); req.off('aborted', error); res.off('close', cancel)
        }
        const cancel = () => { if (!settled) { cleanup(); busy(res); req.resume(); reject(new Error('Invalid request')) } }
        const data = (chunk: Buffer) => {
          length += chunk.length
          if (length > MAX_BODY) { cleanup(); send(res, 413, { error: 'invalid_request' }); req.resume(); reject(new Error('Invalid request')); return }
          chunks.push(chunk)
        }
        const end = () => { if (!settled) { const result = Buffer.concat(chunks, length); cleanup(); resolve(result) } }
        const error = () => { if (!settled) { cleanup(); reject(new Error('Invalid request')) } }
        readers.add(cancel); res.once('close', cancel)
        req.on('data', data); req.once('end', end); req.once('error', error); req.once('aborted', error)
      })
      if (!fresh() || !same(proof, signature(key, timestamp, nonce, body))) { send(res, 401, { error: 'unauthorized' }); return }
      for (const [used, expires] of replays) if (expires <= now()) replays.delete(used)
      if (replays.has(nonce)) { send(res, 409, { error: 'invalid_request' }); return }
      if (replays.size >= MAX_REPLAYS) { busy(res); return }
      replays.set(nonce, Number(timestamp) + WINDOW_MS + 1)
      const value: unknown = JSON.parse(body.toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'password,salt') { send(res, 400, { error: 'invalid_request' }); return }
      const input = value as { password?: unknown; salt?: unknown }, salt = saltFrom(input.salt)
      if (!validPassword(input.password) || !salt) { send(res, 400, { error: 'invalid_request' }); return }
      if (closing || res.destroyed || (active && waiting.length >= 8)) { salt.fill(0); busy(res); return }
      const job: Job = { password: input.password, salt, res, timestamp, nonce, cancelled: () => {} }
      if (!active) run(job)
      else {
        job.cancelled = () => {
          const index = waiting.indexOf(job)
          if (index >= 0) { waiting.splice(index, 1); job.password = ''; job.salt.fill(0) }
        }
        res.once('close', job.cancelled); waiting.push(job)
      }
    } catch { send(res, 400, { error: 'invalid_request' }) }
    finally { body?.fill(0) }
  }

  const handler = ((req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== PASSWORD_WORK_PATH) return false
    void dispatch(req, res).catch(() => { busy(res) })
    return true
  }) as PasswordWorkHandler
  handler.status = () => ({ active: active ? 1 : 0, queued: waiting.length })
  handler.close = async () => {
    closing = true; replays.clear()
    for (const cancel of [...readers]) cancel()
    for (const job of waiting.splice(0)) { job.res.off('close', job.cancelled); job.password = ''; job.salt.fill(0); busy(job.res) }
    if (!active) { key.fill(0); return }
    await new Promise<void>(resolve => closed.push(resolve))
  }
  return handler
}
