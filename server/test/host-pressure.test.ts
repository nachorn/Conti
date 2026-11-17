import test from 'node:test'
import assert from 'node:assert/strict'
import { createPasswordPressureProbe } from '../src/hostPressure.js'

test('RACE pressure offloads password work before the primary host exhausts memory', async () => {
  let tick = 0, race = 199, available = 400, reads = 0
  const probe = createPasswordPressureProbe({ now: () => tick, raceMemoryPath: '/sys/fs/cgroup/system.slice/race.service/memory.current', read: async path => {
    reads++; return path === '/proc/meminfo' ? `MemAvailable: ${available * 1024} kB\n` : String(race * 1024 * 1024)
  } })
  assert.equal(await probe(), false)
  race = 400
  assert.equal(await probe(), false) // The passive sample is cached for one second.
  assert.equal(reads, 2)
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
