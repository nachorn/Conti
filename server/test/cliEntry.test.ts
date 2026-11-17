import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, realpath, rmdir, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const serverDirectory = fileURLToPath(new URL('../', import.meta.url))
const tsxLoader = new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href
// No account/database environment or inherited NODE_OPTIONS reaches these CLIs.
const environment: NodeJS.ProcessEnv = { NODE_ENV: 'test' }
for (const name of ['PATH', 'SystemRoot', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR']) {
  if (process.env[name] !== undefined) environment[name] = process.env[name]
}
const cases = [
  ['migrate-to-local.ts', 'unknown_migration_option'],
  ['checkpoint-local-to-postgres.ts', 'unknown_checkpoint_option'],
] as const

for (const [file, diagnostic] of cases) {
  test(`${file} actually executes through the deployment junction/symlink and directly`, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'nrn-cli-entry-'))
    const current = join(directory, 'current')
    t.after(async () => {
      // Remove the link itself before deleting its empty private parent. Never
      // recursively traverse the junction into the application checkout.
      await unlink(current).catch(error => { if (error.code !== 'ENOENT') throw error })
      await rmdir(directory)
    })
    await symlink(await realpath(serverDirectory), current, process.platform === 'win32' ? 'junction' : 'dir')
    const run = (root: string) => spawnSync(process.execPath,
      ['--import', tsxLoader, join(root, 'src', 'cli', file), '--unknown-entrypoint-probe'],
      { cwd: serverDirectory, env: environment, encoding: 'utf8', timeout: 15_000, windowsHide: true })
    const direct = run(serverDirectory), linked = run(current)
    for (const result of [direct, linked]) {
      assert.equal(result.error, undefined)
      assert.equal(result.signal, null)
      assert.equal(result.status, 1, 'an unknown option must execute validation, not silently exit zero')
      assert.equal(result.stdout, '', 'no success receipt may be emitted')
      assert.equal(result.stderr.trim(), diagnostic)
    }
    assert.equal(linked.status, direct.status)
    assert.equal(linked.stderr, direct.stderr)
  })

  test(`${file} stays inert when imported with missing or unrelated argv`, () => {
    const moduleUrl = new URL(`../src/cli/${file}`, import.meta.url).href
    const code = `process.argv[1] = 'missing-entrypoint-probe.js'; await import(${JSON.stringify(moduleUrl)}); console.log('imported');`
    const result = spawnSync(process.execPath, ['--import', tsxLoader, '--input-type=module', '-e', code],
      { cwd: serverDirectory, env: environment, encoding: 'utf8', timeout: 15_000, windowsHide: true })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 0)
    assert.equal(result.stdout.trim(), 'imported')
    assert.equal(result.stderr, '')
  })
}
