const MAX_LOGS = 200
const LOGS: { level: string; time: string; args: unknown[] }[] = []

function formatArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`
      if (typeof a === 'object' && a !== null) return JSON.stringify(a, null, 0)
      return String(a)
    })
    .join(' ')
}

function capture(level: string, original: (...args: unknown[]) => void) {
  return (...args: unknown[]) => {
    const time = new Date().toISOString()
    LOGS.push({ level, time, args })
    if (LOGS.length > MAX_LOGS) LOGS.shift()
    original.apply(console, args)
  }
}

/** Call from app to add an entry to the bug report log (e.g. socket errors, key events). */
export function pushLog(level: 'log' | 'warn' | 'error', ...args: unknown[]): void {
  const time = new Date().toISOString()
  LOGS.push({ level, time, args })
  if (LOGS.length > MAX_LOGS) LOGS.shift()
}

export function initLogCapture(): void {
  if (typeof window === 'undefined') return
  const patched = (console as unknown as { __reportBugPatched?: boolean }).__reportBugPatched
  if (patched) return
  const origLog = console.log
  const origWarn = console.warn
  const origError = console.error
  if (typeof origLog === 'function') console.log = capture('log', origLog)
  if (typeof origWarn === 'function') console.warn = capture('warn', origWarn)
  if (typeof origError === 'function') console.error = capture('error', origError)
  ;(console as unknown as { __reportBugPatched?: boolean }).__reportBugPatched = true

  window.addEventListener('error', (event) => {
    pushLog('error', `Uncaught: ${event.message}`, event.filename, event.lineno, event.colno, event.error)
  })
  window.addEventListener('unhandledrejection', (event) => {
    pushLog('error', 'Unhandled promise rejection', event.reason)
  })
}

export function getReportText(context?: Record<string, unknown>): string {
  const lines: string[] = [
    '--- Bug report ---',
    `Time: ${new Date().toISOString()}`,
    `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
    '',
  ]
  if (typeof window !== 'undefined') {
    lines.push('Environment:')
    lines.push(`  userAgent: ${navigator.userAgent.slice(0, 80)}...`)
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (vw && vh) lines.push(`  viewport: ${vw}x${vh}`)
    lines.push('')
  }
  if (context && Object.keys(context).length > 0) {
    lines.push('Game context:')
    for (const [k, v] of Object.entries(context)) {
      const val = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)
      lines.push(`  ${k}: ${val}`)
    }
    lines.push('')
  }
  lines.push('Recent logs / errors:')
  if (LOGS.length === 0) {
    lines.push('  (No console logs or errors captured. Describe what you did before the bug.)')
  } else {
    for (const { level, time, args } of LOGS) {
      lines.push(`[${time}] ${level.toUpperCase()}: ${formatArgs(args)}`)
    }
  }
  lines.push('')
  lines.push('--- End ---')
  return lines.join('\n')
}

export async function copyReportToClipboard(context?: Record<string, unknown>): Promise<boolean> {
  const text = getReportText(context)
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
