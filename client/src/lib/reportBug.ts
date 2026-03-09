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
}

export function getReportText(context?: Record<string, unknown>): string {
  const lines: string[] = [
    '--- Bug report ---',
    `Time: ${new Date().toISOString()}`,
    `URL: ${typeof window !== 'undefined' ? window.location.href : ''}`,
    '',
  ]
  if (context && Object.keys(context).length > 0) {
    lines.push('Context:')
    for (const [k, v] of Object.entries(context)) {
      lines.push(`  ${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`)
    }
    lines.push('')
  }
  lines.push('Recent logs:')
  for (const { level, time, args } of LOGS) {
    lines.push(`[${time}] ${level.toUpperCase()}: ${formatArgs(args)}`)
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
