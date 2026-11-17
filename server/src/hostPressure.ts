import { readFile } from 'node:fs/promises'

const CGROUP_ROOT = '/sys/fs/cgroup'
// scrypt's working set is about 128 MiB; reserve another 32 MiB for native/IO work.
const PASSWORD_HEADROOM = 160n * 1024n * 1024n
function memoryBytes(raw: string): bigint {
  const value = raw.trim()
  if (!/^(0|[1-9]\d{0,19})$/.test(value)) throw new Error('Cgroup memory unavailable')
  const bytes = BigInt(value)
  if (bytes > 18_446_744_073_709_551_615n) throw new Error('Cgroup memory unavailable')
  return bytes
}
function ownCgroupDirectory(raw: string): string {
  const lines = raw.split('\n').map(line => line.trim()).filter(Boolean)
  if (lines.some(line => !/^\d+:[^:]*:.*$/.test(line))) throw new Error('Process cgroup unavailable')
  const unified = lines.filter(line => line.startsWith('0:'))
  if (unified.length !== 1 || !unified[0].startsWith('0::/')) throw new Error('Process cgroup unavailable')
  const path = unified[0].slice(3)
  if (path === '/') return CGROUP_ROOT
  const parts = path.slice(1).split('/')
  if (parts.some(part => !/^[A-Za-z0-9_.:@-]+$/.test(part) || part === '.' || part === '..')) throw new Error('Unsafe process cgroup path')
  return `${CGROUP_ROOT}/${parts.join('/')}`
}

/** A passive host read. Never query a database or change RACE's process. */
export function createPasswordPressureProbe(options: {
  raceMemoryPath?: string
  minimumAvailableMb?: number
  raceThresholdMb?: number
  read?: (path: string) => Promise<string>
  now?: () => number
} = {}) {
  const load = options.read ?? (path => readFile(path, 'utf8'))
  const now = options.now ?? Date.now
  if (options.raceMemoryPath && (!options.raceMemoryPath.startsWith('/sys/fs/cgroup/') || !options.raceMemoryPath.endsWith('/memory.current') || options.raceMemoryPath.includes('/../'))) throw new Error('RACE memory path must identify its existing cgroup memory.current file')
  let cached: { at: number; pressure: boolean } | undefined
  return async (): Promise<boolean> => {
    if (cached && now() >= cached.at && now() - cached.at < 1000) return cached.pressure
    let pressure = true
    try {
      const mem = await load('/proc/meminfo')
      const availableKb = Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(mem)?.[1])
      if (!Number.isFinite(availableKb) || availableKb <= 0) throw new Error('Host memory unavailable')
      pressure = availableKb < (options.minimumAvailableMb ?? 256) * 1024
      if (options.raceMemoryPath) {
        const raw = (await load(options.raceMemoryPath)).trim()
        if (!/^\d+$/.test(raw)) throw new Error('RACE memory unavailable')
        pressure ||= Number(raw) >= (options.raceThresholdMb ?? 300) * 1024 * 1024
      }
      if (!pressure) {
        let directory = ownCgroupDirectory(await load('/proc/self/cgroup'))
        // A namespace-root process can hide its real ancestors; do not guess a
        // safe limit. The actual VM service has its own non-root systemd cgroup.
        if (directory === CGROUP_ROOT) throw new Error('Process cgroup limit is unavailable')
        while (directory !== CGROUP_ROOT) {
          const current = memoryBytes(await load(`${directory}/memory.current`))
          const maximum = (await load(`${directory}/memory.max`)).trim()
          if (maximum !== 'max' && memoryBytes(maximum) - current < PASSWORD_HEADROOM) { pressure = true; break }
          // An unlimited leaf can still be constrained by a finite parent.
          directory = directory.slice(0, directory.lastIndexOf('/'))
        }
        // The real root has no memory.max/current knobs; MemAvailable covers it.
      }
    } catch { pressure = true /* Missing measurements must not admit another 128 MiB KDF. */ }
    cached = { at: now(), pressure }
    return pressure
  }
}
