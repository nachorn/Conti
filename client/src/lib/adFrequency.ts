const KEY = 'nrn-ad-starts-v1'
const HOUR = 60 * 60 * 1000
type AdStorage = Pick<Storage, 'getItem' | 'setItem'>

/** A conservative experience limit, not an impression counter or fraud signal. */
export class AdFrequency {
  private starts: number[] = []
  private readonly storage: AdStorage | null
  private readonly now: () => number
  constructor(storage: AdStorage | null, now = Date.now) { this.storage = storage; this.now = now }
  private recent() {
    const now = this.now()
    let saved: number[] = []
    try {
      const value: unknown = JSON.parse(this.storage?.getItem(KEY) ?? '[]')
      if (Array.isArray(value)) saved = value.filter((at): at is number => typeof at === 'number' && Number.isFinite(at))
    } catch { /* The in-memory cap works even when storage is unavailable. */ }
    this.starts = [...new Set([...this.starts, ...saved])]
      .filter(at => at > now - HOUR && at <= now + 60_000).sort((a, b) => a - b).slice(-2)
    return this.starts
  }
  allowed() { return this.recent().length < 2 }
  recordShown() {
    const starts = this.recent()
    if (starts.length >= 2) return false
    // Distinct starts remain distinct even when the browser clock has low precision.
    const at = Math.max(this.now(), (starts[starts.length - 1] ?? -Infinity) + 1)
    this.starts.push(at)
    try { this.storage?.setItem(KEY, JSON.stringify(this.starts)) } catch { /* Keep the in-memory cap. */ }
    return true
  }
}

let browserGate: AdFrequency | undefined
export function adFrequency() {
  if (!browserGate) {
    let storage: AdStorage | null = null
    try { storage = window.localStorage } catch { /* Private browsing can disable storage. */ }
    browserGate = new AdFrequency(storage)
  }
  return browserGate
}
