import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

// OWASP's scrypt fallback: N=2^17, r=8, p=1. One worker bounds memory use
// on the single game server; pending work is bounded separately from HTTP IO.
const N = 131072, R = 8, P = 1, MAX_PENDING = 8
let active = false
const waiting: (() => void)[] = []
export class PasswordWorkBusy extends Error {
  constructor() { super('Password verification busy') }
}
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (active) {
    if (waiting.length >= MAX_PENDING) throw new PasswordWorkBusy()
    await new Promise<void>(resolve => waiting.push(resolve))
  } else active = true
  try { return await work() }
  finally {
    const next = waiting.shift()
    if (next) next()
    else active = false
  }
}
const prefix = `scrypt-v1$${N}$${R}$${P}$`
const dummy = `${prefix}${'0'.repeat(32)}$${'0'.repeat(64)}`
const format = /^scrypt-v1\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{64}$/
export const isStoredPasswordHash = (value: unknown): value is string => typeof value === 'string' && format.test(value)

const common = new Set([
  '123456789012345', '1234567890123456', '12345678901234567890',
  'passwordpassword', 'password123456789', 'qwertyuiopasdfgh',
  'contraseñacontraseña', 'contraseña123456789', 'letmeinletmein123',
])
export function passwordIsAcceptable(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 256 || Buffer.byteLength(value, 'utf8') > 512) return false
  const length = [...value].length
  if (length < 15 || length > 128) return false
  return value.trim().length > 0 && !/^(.)\1+$/us.test(value) && !common.has(value.normalize('NFKC').toLowerCase())
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return slot(() => new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N, r: R, p: P, maxmem: 192 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key))
  }))
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt)
  return `${prefix}${salt.toString('hex')}$${key.toString('hex')}`
}
/** Missing accounts still perform the same bounded KDF; no raw password is kept. */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const valid = isStoredPasswordHash(stored)
  const encoded = valid ? stored : dummy
  const parts = encoded.split('$')
  const key = await derive(password, Buffer.from(parts[4], 'hex'))
  const matches = timingSafeEqual(key, Buffer.from(parts[5], 'hex'))
  return valid && matches
}
