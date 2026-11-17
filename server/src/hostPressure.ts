import { readFile } from 'node:fs/promises'

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
    if (cached && now() - cached.at < 1000) return cached.pressure
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
    } catch { pressure = true /* Missing measurements must not admit another 128 MiB KDF. */ }
    cached = { at: now(), pressure }
    return pressure
  }
}
