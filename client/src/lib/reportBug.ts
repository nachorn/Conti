const MAX_LOGS = 200
const MAX_ENTRY = 4000
const MAX_REPORT = 64 * 1024
const REDACTED = '[redacted]'
// Store only bounded strings. Raw objects, errors and credentials are never retained.
const LOGS: { level: string; time: string; args: string }[] = []
const sensitiveKey = (value: string) => /token|password|passwd|passphrase|secret|auth|cookie|email|credential|session|salt|hash|code|key/i.test(value)

function sanitizeText(value: string): string {
  return value.slice(0, 8000)
    .replace(/https?:\/\/[^\s<>"'`]+/gi, raw => {
      try { const url = new URL(raw); return `${url.origin}${url.pathname}${url.search || url.hash ? '[parameters omitted]' : ''}` }
      catch { return '[URL omitted]' }
    })
    .replace(/\/(?:[^\s<>"'`?#]+)[?#][^\s<>"'`]*/g, raw => `${raw.split(/[?#]/, 1)[0]}[parameters omitted]`)
    .replace(/\b(?:set-cookie|cookie|authorization|proxy-authorization)\b["']?\s*[:=]\s*[^\r\n]*/gi, '[private header omitted]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]+/gi, `Authorization ${REDACTED}`)
    .replace(/\b(token|password|passwd|passphrase|secret|credential|session|email|code|api[_-]?key|auth)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\r\n]+)/gi, `$1=${REDACTED}`)
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email omitted]')
    .replace(/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43,}(?![A-Za-z0-9_-])/g, '[credential omitted]')
}

/** Inspect own data descriptors only: never call a getter, toJSON or custom toString. */
function describe(value: unknown, depth: number, seen: WeakSet<object>, budget: { nodes: number; chars: number }): string {
  if (--budget.nodes < 0 || budget.chars <= 0) return '[limit]'
  const clipped = (text: string) => { const output = text.slice(0, Math.min(2000, budget.chars)); budget.chars -= output.length; return output }
  if (typeof value === 'string') return JSON.stringify(clipped(sanitizeText(value)))
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'undefined' || typeof value === 'symbol') return clipped(sanitizeText(String(value)))
  if (typeof value === 'function') return '[function]'
  if (typeof value !== 'object') return '[unknown]'
  if (seen.has(value)) return '[circular]'
  if (depth >= 4) return '[depth limit]'
  seen.add(value)
  try {
    const array = Array.isArray(value)
    const arrayLength: unknown = array ? Object.getOwnPropertyDescriptor(value, 'length')?.value : 0
    const keys = array ? Array.from({ length: typeof arrayLength === 'number' && Number.isSafeInteger(arrayLength) && arrayLength >= 0 ? Math.min(20, arrayLength) : 0 }, (_, i) => String(i))
      : Object.getOwnPropertyNames(value).slice(0, 30)
    const parts: string[] = []
    const prototype = !array ? Object.getPrototypeOf(value) as object | null : null
    const name = prototype ? Object.getOwnPropertyDescriptor(prototype, 'name') : undefined
    if (!keys.includes('name') && Object.getOwnPropertyDescriptor(value, 'message') && typeof name?.value === 'string' && /^[A-Za-z]{1,40}Error$|^Error$/.test(name.value)) {
      parts.push(`"name": ${JSON.stringify(sanitizeText(name.value))}`)
    }
    for (const key of keys) {
      if (budget.chars <= 0 || budget.nodes <= 0) { parts.push('[limit]'); break }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) continue
      const label = JSON.stringify(clipped(sanitizeText(key).slice(0, 80)))
      const content = sensitiveKey(key) ? JSON.stringify(REDACTED) : !('value' in descriptor) ? '[accessor omitted]' : describe(descriptor.value, depth + 1, seen, budget)
      parts.push(array ? content : `${label}: ${content}`)
    }
    return array ? `[${parts.join(', ')}]` : `{${parts.join(', ')}}`
  } catch { return '[uninspectable]' }
  finally { seen.delete(value) }
}

function formatArgs(args: unknown[]): string {
  const budget = { nodes: 150, chars: 6000 }, seen = new WeakSet<object>()
  return args.slice(0, 20).map(value => describe(value, 0, seen, budget)).join(' ').slice(0, MAX_ENTRY)
}
function store(level: 'log' | 'warn' | 'error', args: unknown[]): string {
  const safe = formatArgs(args)
  LOGS.push({ level: level === 'warn' || level === 'error' ? level : 'log', time: new Date().toISOString(), args: safe })
  if (LOGS.length > MAX_LOGS) LOGS.shift()
  return safe
}
function capture(level: 'log' | 'warn' | 'error', original: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    const safe = store(level, args)
    // The mirrored browser console receives the same redacted snapshot.
    try { original.call(console, safe) } catch { /* Diagnostics must not interrupt the app. */ }
  }
}

export function pushLog(level: 'log' | 'warn' | 'error', ...args: unknown[]): void { store(level, args) }

export function initLogCapture(): void {
  if (typeof window === 'undefined') return
  const target = console as unknown as { __reportBugPatched?: boolean }
  if (target.__reportBugPatched) return
  if (typeof console.log === 'function') console.log = capture('log', console.log)
  if (typeof console.warn === 'function') console.warn = capture('warn', console.warn)
  if (typeof console.error === 'function') console.error = capture('error', console.error)
  target.__reportBugPatched = true
  window.addEventListener('error', event => pushLog('error', 'Uncaught error', event.message, event.filename, event.lineno, event.colno, event.error))
  window.addEventListener('unhandledrejection', event => pushLog('error', 'Unhandled promise rejection', event.reason))
}

export function getReportText(context?: Record<string, unknown>): string {
  let url = '', environment = ''
  try {
    if (typeof window !== 'undefined') {
      url = sanitizeText(window.location.href)
      environment = `Environment: ${sanitizeText(navigator.userAgent).slice(0, 100)}\nViewport: ${window.innerWidth}x${window.innerHeight}\n`
    }
  } catch { /* Browser metadata is optional. */ }
  const lines = ['--- Bug report ---', `Time: ${new Date().toISOString()}`, `URL: ${url}`, environment]
  if (context) lines.push('Game context:', formatArgs([context]))
  lines.push('Recent logs / errors:')
  let length = lines.join('\n').length
  const recent = LOGS.slice(-100)
  if (!recent.length) lines.push('  (No logs captured. Describe what you did before the bug.)')
  const included: string[] = []
  // Keep the newest failure when large earlier messages exhaust the report budget.
  for (const { level, time, args } of recent.reverse()) {
    const line = `[${time}] ${level.toUpperCase()}: ${sanitizeText(args)}`
    if (length + line.length > MAX_REPORT - 100) { lines.push('[report truncated]'); break }
    included.push(line); length += line.length + 1
  }
  lines.push(...included.reverse())
  lines.push('--- End ---')
  return lines.join('\n').slice(0, MAX_REPORT)
}

export async function copyReportToClipboard(context?: Record<string, unknown>): Promise<boolean> {
  try { await navigator.clipboard.writeText(getReportText(context)); return true }
  catch { return false }
}
