import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createSnapshotStore, FileSnapshotStore, MAX_SNAPSHOT_BYTES } from '../src/storage.js'

async function temporarySnapshot(t: test.TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'conti-storage-test-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return join(directory, 'games.json')
}

test('file snapshots round-trip and reopen immediately after graceful close', async t => {
  const path = await temporarySnapshot(t)
  const snapshot = { version: 1, rooms: [{ roomId: '1234', hand: ['private-card'], scores: [7, 12] }] }
  const first = await FileSnapshotStore.open(path)
  assert.equal(first.isHealthy(), true)
  assert.equal(await first.load(), null)
  assert.equal(first.isHealthy(), true)
  await first.save(snapshot)
  assert.deepEqual(await first.load(), snapshot)
  await first.close()
  assert.equal(first.isHealthy(), false)
  await first.close()
  await assert.rejects(first.load(), /closed/)
  const second = await FileSnapshotStore.open(path)
  try {
    assert.equal(second.isHealthy(), true)
    assert.deepEqual(await second.load(), snapshot)
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
  } finally {
    await second.close()
  }
})

test('queued saves capture inputs immediately and finish before close', async t => {
  const path = await temporarySnapshot(t)
  const store = await FileSnapshotStore.open(path)
  const mutable = { turn: 2 }
  const firstSave = store.save({ turn: 1 })
  const secondSave = store.save(mutable)
  mutable.turn = 99
  const closing = store.close()
  assert.equal(store.isHealthy(), false)
  await Promise.all([firstSave, secondSave, closing])
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { turn: 2 })
})

test('corrupt snapshots fail without overwriting or leaking private contents', async t => {
  const path = await temporarySnapshot(t)
  const corrupt = '{"private-hand":"do-not-log",'
  await writeFile(path, corrupt)
  const store = await FileSnapshotStore.open(path)
  try {
    await assert.rejects(store.load(), error => {
      assert.match(String(error), /corrupt/)
      assert.doesNotMatch(String(error), /do-not-log/)
      return true
    })
    assert.equal(store.isHealthy(), false)
    await assert.rejects(store.save({ wouldErasePrivateGame: true }), error => {
      assert.match(String(error), /could not be loaded/)
      assert.doesNotMatch(String(error), /do-not-log/)
      return true
    })
    assert.equal(await readFile(path, 'utf8'), corrupt)
  } finally {
    await store.close()
  }
})

test('snapshot size and JSON validation protect the last committed value', async t => {
  const path = await temporarySnapshot(t)
  const store = await FileSnapshotStore.open(path)
  try {
    await store.save({ good: true })
    await assert.rejects(store.save(undefined), /valid JSON/)
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic
    await assert.rejects(store.save(cyclic), /valid JSON/)
    await assert.rejects(store.save('x'.repeat(MAX_SNAPSHOT_BYTES)), /size limit/)
    assert.equal(store.isHealthy(), true, 'input validation alone must not poison healthy storage')
    assert.deepEqual(await store.load(), { good: true })
    await writeFile(path, ' '.repeat(MAX_SNAPSHOT_BYTES + 1))
    await assert.rejects(store.load(), /size limit/)
    assert.equal(store.isHealthy(), false)
  } finally {
    await store.close()
  }
})

test('a second file writer cannot acquire a live writer lock', async t => {
  const path = await temporarySnapshot(t)
  const store = await FileSnapshotStore.open(path)
  try {
    await assert.rejects(FileSnapshotStore.open(path, 0), /writer lock/)
  } finally {
    await store.close()
  }
})

test('a failed atomic replacement rejects and prevents further unconfirmed writes', async t => {
  const path = await temporarySnapshot(t)
  // An existing directory makes the final rename fail on every supported OS.
  await mkdir(path)
  const store = await FileSnapshotStore.open(path)
  try {
    await assert.rejects(store.save({ turn: 1, privateHand: 'do-not-log' }), error => {
      assert.match(String(error), /Unable to save games durably/)
      assert.doesNotMatch(String(error), /do-not-log/)
      return true
    })
    assert.equal(store.isHealthy(), false)
    await assert.rejects(store.save({ turn: 2 }), /Unable to save games durably/)
    assert.ok((await stat(path)).isDirectory())
  } finally {
    await store.close()
  }
})

test('an abandoned partial temporary write never replaces the committed snapshot', async t => {
  const path = await temporarySnapshot(t)
  const store = await FileSnapshotStore.open(path)
  await store.save({ turn: 10 })
  await store.close()
  await writeFile(`${path}.interrupted.tmp`, '{"turn":')
  const reopened = await FileSnapshotStore.open(path)
  try {
    assert.deepEqual(await reopened.load(), { turn: 10 })
  } finally {
    await reopened.close()
  }
})

test('killing a writer during replacement leaves a complete old or new snapshot and a recoverable lease', { timeout: 20_000 }, async t => {
  const path = await temporarySnapshot(t)
  const initial = { turn: 'old' }
  const next = { turn: 'new', padding: 'x'.repeat(2 * 1024 * 1024) }
  const store = await FileSnapshotStore.open(path)
  await store.save(initial)
  await store.close()
  const moduleUrl = new URL('../src/storage.ts', import.meta.url).href
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import { FileSnapshotStore } from ${JSON.stringify(moduleUrl)};
    const store = await FileSnapshotStore.open(process.env.CONTI_TEST_PATH);
    const next = { turn: 'new', padding: 'x'.repeat(2 * 1024 * 1024) };
    process.send('writing');
    await store.save(next);
    setInterval(() => {}, 1000);
  `], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, CONTI_TEST_PATH: path },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr!.on('data', chunk => { stderr += String(chunk) })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  const exit = once(child, 'exit')
  await Promise.race([
    once(child, 'message'),
    exit.then(() => { throw new Error(`Snapshot writer exited unexpectedly: ${stderr}`) }),
  ])
  child.kill('SIGKILL')
  await exit
  const committed: unknown = JSON.parse(await readFile(path, 'utf8'))
  assert.ok(JSON.stringify(committed) === JSON.stringify(initial) || JSON.stringify(committed) === JSON.stringify(next))
  // Simulate elapsed wall time without making the test wait out the 10s lease.
  // SIGKILL intentionally bypasses proper-lockfile's normal exit cleanup.
  try {
    const old = new Date(Date.now() - 20_000)
    await utimes(`${path}.lock`, old, old)
  } catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const reopened = await FileSnapshotStore.open(path, 0)
  try {
    assert.deepEqual(await reopened.load(), committed)
    await reopened.save({ recovered: true })
    assert.deepEqual(await reopened.load(), { recovered: true })
  } finally {
    await reopened.close()
  }
})

test('production refuses implicit ephemeral files and never falls back from a bad database URL', async () => {
  await assert.rejects(createSnapshotStore({ NODE_ENV: 'production' }), /requires DATABASE_URL or GAME_STATE_PATH/)
  await assert.rejects(createSnapshotStore({ RAILWAY_ENVIRONMENT_ID: 'production-environment' }), /requires DATABASE_URL or GAME_STATE_PATH/)
  await assert.rejects(createSnapshotStore({ RENDER: 'true' }), /requires DATABASE_URL or GAME_STATE_PATH/)
  await assert.rejects(createSnapshotStore({
    NODE_ENV: 'production',
    DATABASE_URL: 'not a database URL with secret-password',
    GAME_STATE_PATH: './must-not-be-used/games.json',
  }), error => {
    assert.match(String(error), /Cannot open game database/)
    assert.doesNotMatch(String(error), /secret-password/)
    return true
  })
})
