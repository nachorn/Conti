import test from 'node:test'
import assert from 'node:assert/strict'
import { createPasswordPressureProbe } from '../src/hostPressure.js'

const MIB = 1024 * 1024
const OWN = '/sys/fs/cgroup/system.slice/nrnplay.service'
function cgroupFiles() {
  return new Map<string, string>([
    ['/proc/self/cgroup', '0::/system.slice/nrnplay.service\n'],
    [`${OWN}/memory.current`, String(100 * MIB)], [`${OWN}/memory.max`, String(384 * MIB)],
    ['/sys/fs/cgroup/system.slice/memory.current', String(400 * MIB)], ['/sys/fs/cgroup/system.slice/memory.max', 'max'],
  ])
}
function reader(files: Map<string, string>, available = 500) {
  return async (path: string) => {
    if (path === '/proc/meminfo') return `MemAvailable: ${available * 1024} kB\n`
    const value = files.get(path)
    if (value === undefined) throw new Error('Missing test measurement')
    return value
  }
}

test('RACE pressure offloads password work before the primary host exhausts memory', async () => {
  let tick = 0, race = 199, available = 400, reads = 0
  const files = cgroupFiles()
  const probe = createPasswordPressureProbe({ now: () => tick, raceMemoryPath: '/sys/fs/cgroup/system.slice/race.service/memory.current', read: async path => {
    reads++
    if (path === '/proc/meminfo') return `MemAvailable: ${available * 1024} kB\n`
    if (path === '/sys/fs/cgroup/system.slice/race.service/memory.current') return String(race * MIB)
    return reader(files)(path)
  } })
  assert.equal(await probe(), false)
  const sampledReads = reads
  race = 400
  assert.equal(await probe(), false) // The passive sample is cached for one second.
  assert.equal(reads, sampledReads)
  tick = 1000
  assert.equal(await probe(), true)
  race = 199; available = 255; tick = 2000
  assert.equal(await probe(), true)
  available = 300; tick = 3000
  assert.equal(await probe(), false)
})

test('missing or malformed pressure measurements fail closed', async () => {
  for (const value of ['', 'MemAvailable: unknown kB', 'MemAvailable: 0 kB']) {
    assert.equal(await createPasswordPressureProbe({ read: async () => value })(), true)
  }
  const missing = createPasswordPressureProbe({ read: async () => { throw new Error('Not available') } })
  assert.equal(await missing(), true)
  const missingRace = createPasswordPressureProbe({ raceMemoryPath: '/sys/fs/cgroup/race/memory.current', read: async path => {
    if (path === '/proc/meminfo') return 'MemAvailable: 500000 kB\n'
    throw new Error('No cgroup')
  } })
  assert.equal(await missingRace(), true)
  assert.throws(() => createPasswordPressureProbe({ raceMemoryPath: '/tmp/arbitrary' }))
})

test('local KDF requires at least 160 MiB inside its own finite cgroup limit', async () => {
  const files = cgroupFiles()
  let tick = 0
  const probe = createPasswordPressureProbe({ read: reader(files), now: () => tick })
  files.set(`${OWN}/memory.current`, String(224 * MIB)) // Exactly 160 MiB remains.
  assert.equal(await probe(), false)
  files.set(`${OWN}/memory.current`, String(224 * MIB + 1)); tick += 1000
  assert.equal(await probe(), true)
  files.set(`${OWN}/memory.current`, String(223 * MIB)); tick += 1000
  assert.equal(await probe(), false)
})

test('finite ancestor limits apply even when the leaf is unlimited', async () => {
  const files = cgroupFiles()
  files.set(`${OWN}/memory.max`, 'max')
  files.set('/sys/fs/cgroup/system.slice/memory.max', String(1024 * MIB))
  files.set('/sys/fs/cgroup/system.slice/memory.current', String(864 * MIB))
  assert.equal(await createPasswordPressureProbe({ read: reader(files) })(), false)
  files.set('/sys/fs/cgroup/system.slice/memory.current', String(864 * MIB + 1))
  assert.equal(await createPasswordPressureProbe({ read: reader(files) })(), true)
  // A deeper service must also account for the highest finite non-root parent.
  const nested = '/sys/fs/cgroup/system.slice/nrn-group.slice/nrnplay.service'
  files.set('/proc/self/cgroup', '0::/system.slice/nrn-group.slice/nrnplay.service\n')
  for (const path of [nested, '/sys/fs/cgroup/system.slice/nrn-group.slice']) {
    files.set(`${path}/memory.current`, String(100 * MIB)); files.set(`${path}/memory.max`, 'max')
  }
  assert.equal(await createPasswordPressureProbe({ read: reader(files) })(), true)
})

test('unlimited cgroups still require safe host and RACE measurements', async () => {
  const files = cgroupFiles()
  files.set(`${OWN}/memory.max`, 'max')
  assert.equal(await createPasswordPressureProbe({ read: reader(files) })(), false)
  assert.equal(await createPasswordPressureProbe({ read: reader(files, 255) })(), true)
  files.set('/sys/fs/cgroup/race.service/memory.current', String(300 * MIB))
  assert.equal(await createPasswordPressureProbe({ raceMemoryPath: '/sys/fs/cgroup/race.service/memory.current', read: reader(files) })(), true)
})

test('missing or malformed self and ancestor cgroup measurements fail closed', async () => {
  for (const [path, value] of [
    [`${OWN}/memory.current`, ''], [`${OWN}/memory.current`, '-1'], [`${OWN}/memory.current`, '1.5'],
    [`${OWN}/memory.current`, '18446744073709551616'], [`${OWN}/memory.max`, 'unknown'],
    [`${OWN}/memory.max`, '-1'], [`${OWN}/memory.max`, '1.5'],
    ['/sys/fs/cgroup/system.slice/memory.current', 'max'], ['/sys/fs/cgroup/system.slice/memory.max', ''],
  ]) {
    const files = cgroupFiles(); files.set(path, value)
    assert.equal(await createPasswordPressureProbe({ read: reader(files) })(), true)
  }
  for (const missing of ['/proc/self/cgroup', `${OWN}/memory.current`, `${OWN}/memory.max`, '/sys/fs/cgroup/system.slice/memory.max', '/sys/fs/cgroup/system.slice/memory.current']) {
    const files = cgroupFiles(); files.delete(missing)
    assert.equal(await createPasswordPressureProbe({ read: reader(files) })(), true)
  }
})

test('self cgroup paths cannot traverse outside the cgroup mount', async () => {
  for (const raw of ['', '1:memory:/system.slice/nrnplay.service', '0::relative', '0::/../outside',
    '0::/system.slice/./nrnplay.service', '0::/system.slice//nrnplay.service', '0::/system.slice/nrnplay.service/',
    '0::/system.slice\\nrnplay.service', '0::/system.slice/%2e%2e/outside', '0::/safe\n0::/other', '0::/safe\njunk']) {
    const files = cgroupFiles(); files.set('/proc/self/cgroup', raw)
    const seen: string[] = []
    assert.equal(await createPasswordPressureProbe({ read: async path => { seen.push(path); return reader(files)(path) } })(), true)
    assert.deepEqual(seen, ['/proc/meminfo', '/proc/self/cgroup'])
  }
})

test('the real root is not read and namespace-root processes fail closed', async () => {
  const files = cgroupFiles()
  const seen: string[] = []
  assert.equal(await createPasswordPressureProbe({ read: async path => { seen.push(path); return reader(files)(path) } })(), false)
  assert.ok(!seen.some(path => path === '/sys/fs/cgroup/memory.current' || path === '/sys/fs/cgroup/memory.max'))
  files.set('/proc/self/cgroup', '0::/\n')
  assert.equal(await createPasswordPressureProbe({ read: reader(files) })(), true)
})

test('a backwards clock cannot preserve a stale safe sample', async () => {
  const files = cgroupFiles()
  let tick = 1000
  const probe = createPasswordPressureProbe({ read: reader(files), now: () => tick })
  assert.equal(await probe(), false)
  files.set(`${OWN}/memory.current`, String(300 * MIB)); tick = 500
  assert.equal(await probe(), true)
})
