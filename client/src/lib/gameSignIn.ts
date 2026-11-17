import type { MembershipSession } from '@shared/membership'
import { isMembershipSession } from './membershipSession.ts'

export const GAME_SIGN_IN_STORAGE_KEY = 'nrn-game-sign-in-v1'
export const GAME_SIGN_IN_TTL = 10 * 60 * 1000
const SECRET = /^[A-Za-z0-9_-]{43}$/
const GAME_ORIGINS = new Set([
  'https://football.nrnplay.com', 'https://conti.nrnplay.com', 'https://pocha.nrnplay.com',
  'https://footballchampion.net',
])
const LOCAL_ORIGINS = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:5174', 'http://127.0.0.1:5174',
])
export type GameSignInStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export interface GameConnectionRequest { origin: string; challenge: string; state: string }
interface PendingGameSignIn { origin: string; verifier: string; state: string; expiresAt: number; previousToken?: string }
export interface GameSignInProof { origin: string; code: string; verifier: string; previousToken?: string }
type ErrorCode = 'invalid_request' | 'storage' | 'expired' | 'exchange' | 'unavailable'

export class GameSignInError extends Error {
  readonly code: ErrorCode
  constructor(code: ErrorCode) { super(`NRN game sign-in: ${code}`); this.name = 'GameSignInError'; this.code = code }
}

function developmentMode() { return import.meta.env?.DEV === true }
function browserStorage(): GameSignInStorage | null { try { return window.sessionStorage } catch { return null } }
function apiBaseUrl() { return import.meta.env?.VITE_SOCKET_URL || (developmentMode() ? 'http://localhost:3001' : '') }

/** Exact origins only: never accept a path, credentials, suffix domain or redirect URL. */
export function isAllowedGameOrigin(value: unknown, development = false): value is string {
  if (typeof value !== 'string' || value.length > 200) return false
  try {
    const url = new URL(value)
    return url.origin === value && !url.username && !url.password &&
      (GAME_ORIGINS.has(value) || (development && LOCAL_ORIGINS.has(value)))
  } catch { return false }
}

export function parseGameConnectionRequest(search: string, development = false): GameConnectionRequest | null {
  if (search.length > 1200) return null
  const query = new URLSearchParams(search)
  if ([...query.keys()].length !== 3 || ['origin', 'challenge', 'state'].some(key => query.getAll(key).length !== 1)) return null
  const origin = query.get('origin')
  const challenge = query.get('challenge') ?? ''
  const state = query.get('state') ?? ''
  return isAllowedGameOrigin(origin, development) && SECRET.test(challenge) && SECRET.test(state)
    ? { origin, challenge, state } : null
}

function base64Url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface CreateGameSignInOptions {
  origin: string
  storage: GameSignInStorage | null
  crypto?: Pick<Crypto, 'getRandomValues' | 'subtle'>
  now?: number
  development?: boolean
  centralOrigin?: string
  previousToken?: string | null
}

/** Store the private PKCE verifier before returning a public central sign-in URL. */
export async function createGameSignInRequest(options: CreateGameSignInOptions): Promise<string> {
  const development = options.development ?? false
  const central = options.centralOrigin ?? 'https://nrnplay.com'
  if (!isAllowedGameOrigin(options.origin, development) ||
    (central !== 'https://nrnplay.com' && !(development && LOCAL_ORIGINS.has(central)))) throw new GameSignInError('invalid_request')
  if (!options.storage) throw new GameSignInError('storage')
  const crypto = options.crypto ?? globalThis.crypto
  if (!crypto?.subtle || !crypto.getRandomValues) throw new GameSignInError('unavailable')
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  const pending: PendingGameSignIn = { origin: options.origin, verifier, state, expiresAt: (options.now ?? Date.now()) + GAME_SIGN_IN_TTL,
    ...(typeof options.previousToken === 'string' && SECRET.test(options.previousToken) ? { previousToken: options.previousToken } : {}) }
  try { options.storage.setItem(GAME_SIGN_IN_STORAGE_KEY, JSON.stringify(pending)) }
  catch { throw new GameSignInError('storage') }
  const destination = new URL('/connect', central)
  destination.search = new URLSearchParams({ origin: options.origin, challenge, state }).toString()
  return destination.href
}

export interface BeginGameSignInOptions extends Partial<CreateGameSignInOptions> { navigate?: (url: string) => void }
export async function beginGameSignIn(options: BeginGameSignInOptions = {}): Promise<void> {
  const development = options.development ?? developmentMode()
  const origin = options.origin ?? window.location.origin
  const destination = await createGameSignInRequest({
    origin,
    storage: options.storage === undefined ? browserStorage() : options.storage,
    crypto: options.crypto,
    now: options.now,
    development,
    centralOrigin: options.centralOrigin ?? (import.meta.env?.VITE_NRN_AUTH_URL || (development ? origin : 'https://nrnplay.com')),
    previousToken: options.previousToken,
  })
  ;(options.navigate ?? (url => window.location.assign(url)))(destination)
}

export interface ReadGameSignInOptions {
  hash: string
  origin: string
  storage: GameSignInStorage | null
  scrub: () => void
  now?: number
  development?: boolean
}

/** Scrub the callback synchronously, then consume its per-tab proof exactly once. */
export function readGameSignInReturn(options: ReadGameSignInOptions): GameSignInProof | null {
  const fragment = new URLSearchParams(options.hash.replace(/^#/, ''))
  if (!fragment.has('nrn-code')) return null
  try { options.scrub() } catch { throw new GameSignInError('storage') }
  if (options.hash.length > 1200 || [...fragment.keys()].length !== 2 ||
    fragment.getAll('nrn-code').length !== 1 || fragment.getAll('state').length !== 1 ||
    !isAllowedGameOrigin(options.origin, options.development ?? false)) throw new GameSignInError('invalid_request')
  const code = fragment.get('nrn-code') ?? ''
  const state = fragment.get('state') ?? ''
  if (!SECRET.test(code) || !SECRET.test(state)) throw new GameSignInError('invalid_request')
  if (!options.storage) throw new GameSignInError('storage')
  let pending: Partial<PendingGameSignIn> | null
  try { pending = JSON.parse(options.storage.getItem(GAME_SIGN_IN_STORAGE_KEY) ?? 'null') as Partial<PendingGameSignIn> | null }
  catch { throw new GameSignInError('storage') }
  const now = options.now ?? Date.now()
  if (!pending || typeof pending !== 'object' || pending.origin !== options.origin || pending.state !== state ||
    typeof pending.verifier !== 'string' || !SECRET.test(pending.verifier) || typeof pending.expiresAt !== 'number' ||
    !Number.isSafeInteger(pending.expiresAt) ||
    (pending.previousToken !== undefined && (typeof pending.previousToken !== 'string' || !SECRET.test(pending.previousToken)))) throw new GameSignInError('invalid_request')
  if (pending.expiresAt <= now || pending.expiresAt > now + GAME_SIGN_IN_TTL) throw new GameSignInError('expired')
  try { options.storage.removeItem(GAME_SIGN_IN_STORAGE_KEY) }
  catch { throw new GameSignInError('storage') }
  return { origin: options.origin, code, verifier: pending.verifier, ...(pending.previousToken ? { previousToken: pending.previousToken } : {}) }
}

interface RequestOptions { fetch?: typeof fetch; apiUrl?: string }
async function post(path: string, body: unknown, token: string | null, options: RequestOptions): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await (options.fetch ?? globalThis.fetch)(`${(options.apiUrl ?? apiBaseUrl()).replace(/\/+$/, '')}/api/membership/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', signal: controller.signal,
    })
    if (!response.ok) throw new GameSignInError('exchange')
    return await response.json() as unknown
  } catch (error) {
    if (error instanceof GameSignInError) throw error
    throw new GameSignInError('unavailable')
  } finally { clearTimeout(timer) }
}

/** Central page only; the server issues a one-use code bound to the target and PKCE challenge. */
export async function authorizeGameSignIn(request: GameConnectionRequest, token: string, options: RequestOptions & { development?: boolean } = {}): Promise<string> {
  if (!isAllowedGameOrigin(request.origin, options.development ?? developmentMode()) || !SECRET.test(request.challenge) ||
    !SECRET.test(request.state) || !SECRET.test(token)) throw new GameSignInError('invalid_request')
  const value = await post('game-authorize', { origin: request.origin, challenge: request.challenge }, token, options)
  if (!value || typeof value !== 'object' || !('code' in value) || typeof value.code !== 'string' || !SECRET.test(value.code)) throw new GameSignInError('exchange')
  return value.code
}

export function gameSignInReturnUrl(request: GameConnectionRequest, code: string, development = false): string {
  if (!isAllowedGameOrigin(request.origin, development) || !SECRET.test(code) || !SECRET.test(request.state)) throw new GameSignInError('invalid_request')
  const url = new URL('/', request.origin)
  url.hash = new URLSearchParams({ 'nrn-code': code, state: request.state }).toString()
  return url.href
}

interface ContinuationState { busy: boolean; failed: boolean }
interface ContinuationOptions {
  navigate: (url: string) => void
  isCurrent: (token: string) => boolean
  onState: (state: ContinuationState) => void
  authorize?: (request: GameConnectionRequest, token: string) => Promise<string>
  development?: boolean
}

/** Effect replays share a request and can commit its result only once while mounted. */
export function createGameSignInContinuation(options: ContinuationOptions) {
  type Attempt = { request: GameConnectionRequest; token: string; settled: boolean; failed: boolean; code?: string; navigated: boolean; promise: Promise<void> }
  let current: Attempt | null = null
  const synchronize = (attempt: Attempt) => {
    if (current !== attempt || !options.isCurrent(attempt.token)) return
    if (attempt.code && !attempt.navigated) {
      attempt.navigated = true
      try { options.navigate(gameSignInReturnUrl(attempt.request, attempt.code, options.development)) }
      catch { attempt.code = undefined; attempt.navigated = false; attempt.failed = true }
    }
    options.onState({ busy: !attempt.settled, failed: attempt.failed })
  }
  return {
    run(request: GameConnectionRequest, token: string, retry = false): Promise<void> {
      const previous = current
      if (previous && previous.token === token && previous.request.origin === request.origin &&
        previous.request.challenge === request.challenge && previous.request.state === request.state && (!retry || !previous.failed)) {
        synchronize(previous)
        return previous.promise
      }
      const attempt: Attempt = { request, token, settled: false, failed: false, navigated: false, promise: Promise.resolve() }
      current = attempt
      attempt.promise = Promise.resolve().then(() => (options.authorize ?? authorizeGameSignIn)(request, token))
        .then(code => { attempt.code = code }, () => { attempt.failed = true })
        .then(() => { attempt.settled = true; synchronize(attempt) })
      synchronize(attempt)
      return attempt.promise
    },
  }
}

export interface ConsumeGameSignInOptions extends Partial<Omit<ReadGameSignInOptions, 'scrub'>>, RequestOptions { scrub?: () => void }
let inFlight: { origin: string; storage: GameSignInStorage | null; hash: string; promise: Promise<MembershipSession | null> } | null = null

/** Browser startup: no callback means null. Repeated StrictMode calls share one exchange. */
export function consumeGameSignIn(options: ConsumeGameSignInOptions = {}): Promise<MembershipSession | null> {
  const origin = options.origin ?? window.location.origin
  const storage = options.storage === undefined ? browserStorage() : options.storage
  const hash = options.hash ?? window.location.hash
  const isCallback = new URLSearchParams(hash.replace(/^#/, '')).has('nrn-code')
  if (isCallback && inFlight?.origin === origin && inFlight.storage === storage && inFlight.hash === hash) return inFlight.promise
  if (!isCallback) {
    return inFlight?.origin === origin && inFlight.storage === storage ? inFlight.promise : Promise.resolve(null)
  }
  let proof: GameSignInProof | null
  try {
    proof = readGameSignInReturn({ hash, origin, storage, now: options.now, development: options.development ?? developmentMode(),
      scrub: options.scrub ?? (() => window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)),
    })
  } catch (error) { return Promise.reject(error) }
  if (!proof) return Promise.resolve(null)
  const promise = post('game-exchange', proof, null, options).then(value => {
    if (!isMembershipSession(value, options.now ?? Date.now())) throw new GameSignInError('exchange')
    return value
  })
  const current = { origin, storage, hash, promise }
  inFlight = current
  void promise.then(() => { if (inFlight === current) inFlight = null }, () => { if (inFlight === current) inFlight = null })
  return promise
}
