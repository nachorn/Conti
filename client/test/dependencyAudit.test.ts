import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-ignore Plain JS is also used directly by CI.
import { BUILD_ADVISORY, checkClientAudit } from '../../scripts/check-client-audit.mjs'

const now = Date.parse('2026-11-17T12:00:00Z')
function fixture() {
  return { report: { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 } }, vulnerabilities: {
    picomatch: { severity: 'high', nodes: ['node_modules/picomatch'], via: [{ name: 'picomatch', url: BUILD_ADVISORY }] },
    vite: { severity: 'high', nodes: ['node_modules/vite'], via: ['picomatch'] },
  } }, lock: { packages: { 'node_modules/picomatch': { dev: true }, 'node_modules/vite': { dev: true } } } }
}
test('only the reviewed unpatched development advisory is visible and temporarily accepted', () => {
  const { report, lock } = fixture()
  assert.equal(checkClientAudit(report, lock, now).reviewedBuildOnly, true)
  assert.equal(checkClientAudit(report, lock, now).counts.high, 2)
})
test('runtime use, another advisory and expired review cannot bypass the dependency gate', () => {
  const { report, lock } = fixture()
  lock.packages['node_modules/picomatch'].dev = false
  assert.throws(() => checkClientAudit(report, lock, now), /blocks/)
  lock.packages['node_modules/picomatch'].dev = true
  report.vulnerabilities.picomatch.via[0].url = 'https://github.com/advisories/ANOTHER'
  assert.throws(() => checkClientAudit(report, lock, now), /blocks/)
  report.vulnerabilities.picomatch.via[0].url = BUILD_ADVISORY
  assert.throws(() => checkClientAudit(report, lock, now, '4.0.8'), /blocks/)
  assert.throws(() => checkClientAudit(report, lock, Date.parse('2026-12-18T00:00:00Z')), /blocks/)
})
test('incomplete reports and inconsistent totals fail closed; clean reports still pass', () => {
  const { report, lock } = fixture()
  assert.throws(() => checkClientAudit({ error: { code: 'network_failure' } }, lock, now), /complete/)
  report.metadata.vulnerabilities.high = 0
  assert.throws(() => checkClientAudit(report, lock, now), /totals/)
  report.vulnerabilities = {} as typeof report.vulnerabilities
  assert.equal(checkClientAudit(report, lock, now).reviewedBuildOnly, false)
})
