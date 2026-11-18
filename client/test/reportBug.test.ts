import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { copyReportToClipboard, getReportText, initLogCapture, pushLog } from '../src/lib/reportBug.ts'

const TOKEN = 'A'.repeat(43), EMAIL = 'synthetic-private@example.test', PASSWORD = 'syntheticPassword42', CODE = '654321'
function browser(t: TestContext, href = `https://user:${PASSWORD}@nrn.example.test/connect?code=${CODE}&token=${TOKEN}#email=${EMAIL}`) {
  const beforeWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), beforeNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  const listeners: Record<string, (event: any) => void> = {}
  const clipboard = { text: '', fail: false }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { href }, innerWidth: 390, innerHeight: 844,
    addEventListener(name: string, listener: (event: any) => void) { listeners[name] = listener } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Synthetic browser', clipboard: { async writeText(text: string) { if (clipboard.fail) throw new Error('denied'); clipboard.text = text } } } })
  t.after(() => {
    if (beforeWindow) Object.defineProperty(globalThis, 'window', beforeWindow); else Reflect.deleteProperty(globalThis, 'window')
    if (beforeNavigator) Object.defineProperty(globalThis, 'navigator', beforeNavigator); else Reflect.deleteProperty(globalThis, 'navigator')
  })
  return { listeners, clipboard }
}
function noSecrets(value: string) { for (const secret of [TOKEN, EMAIL, PASSWORD, CODE]) assert.equal(value.includes(secret), false, 'Private test values must not enter diagnostics') }

test('report URLs omit credentials, query strings and fragments while retaining the page path and diagnostic context', t => {
  browser(t)
  const report = getReportText({ gameType: 'pocha', phase: 'bidding', round: 3, token: TOKEN, password: PASSWORD, code: CODE, email: EMAIL,
    nested: { Authorization: `Bearer ${TOKEN}`, cookie: 'session=privateCookie', apiKey: 'privateApiKey', secret: 'privateSecret' } })
  noSecrets(report)
  for (const secret of ['privateCookie', 'privateApiKey', 'privateSecret']) assert.equal(report.includes(secret), false)
  assert(report.includes('https://nrn.example.test/connect')); assert(report.includes('bidding')); assert(report.includes('pocha')); assert(report.includes('390x844'))
  assert.equal(report.includes('?code='), false); assert.equal(report.includes('#email='), false)
})

test('logs redact credentials in free text, nested arrays, errors and all URLs at capture and export time', t => {
  browser(t)
  const error = new TypeError(`Fetch failed password=${PASSWORD} code=${CODE} Bearer ${TOKEN} contact ${EMAIL} https://nrn.example.test/connect?token=${TOKEN}#${CODE}`)
  pushLog('error', 'NETWORK_FAILURE', error, [`${TOKEN}`, { sessionToken: TOKEN, userEmail: EMAIL, plain: `password="${PASSWORD}"` }],
    `Cookie: session=${PASSWORD}; auth=${TOKEN}`, Symbol(`email=${EMAIL}`))
  const report = getReportText({ problem: 'could not reconnect', destination: `/connect?code=${CODE}#token=${TOKEN}` })
  noSecrets(report); assert(report.includes('NETWORK_FAILURE')); assert(report.includes('Fetch failed')); assert(report.includes('TypeError')); assert(report.includes('could not reconnect'))
  assert.equal(report.includes('?token='), false)
})

test('captured objects are redacted snapshots and later mutations cannot change or add retained private values', () => {
  const value = { token: TOKEN, phase: 'captured_phase', nested: { email: EMAIL } }
  pushLog('warn', 'SNAPSHOT_MARKER', value)
  value.phase = 'later_phase_should_not_be_retained'; value.token = 'differentPrivateToken'; value.nested.email = 'differentPrivateEmail'
  const report = getReportText()
  assert(report.includes('captured_phase')); assert.equal(report.includes('later_phase_should_not_be_retained'), false)
  assert.equal(report.includes('differentPrivateToken'), false); assert.equal(report.includes('differentPrivateEmail'), false); noSecrets(report)
})

test('unquoted passphrases with spaces are removed through the end of their line in messages and logs', () => {
  const phrase = 'correct horse battery staple', tail = 'battery staple'
  pushLog('error', new Error(`LOGIN_FAILED password=${phrase}`), `Authentication failed passphrase=${phrase}`,
    `server rejected password="${phrase}"`, `raw JSON {"password":"${phrase}","phase":"bidding"}`)
  const report = getReportText({ phase: 'bidding' })
  assert.equal(report.includes(phrase), false); assert.equal(report.includes(tail), false)
  assert(report.includes('LOGIN_FAILED')); assert(report.includes('bidding')); assert(report.includes('[redacted]'))
})

test('cyclic, deep, getter-based and hostile values cannot execute custom serialization or break the report', () => {
  let getters = 0, serializers = 0
  const value: Record<string, unknown> = { phase: 'safe_diagnostic' }
  value.self = value
  Object.defineProperty(value, 'password', { enumerable: true, get() { getters++; return PASSWORD } })
  Object.defineProperty(value, 'ordinaryGetter', { enumerable: true, get() { getters++; throw new Error('must not run') } })
  value.toJSON = () => { serializers++; throw new Error('must not run') }
  const hostile = new Proxy({}, { ownKeys() { throw new Error('cannot inspect') } })
  assert.doesNotThrow(() => pushLog('warn', value, hostile))
  const report = getReportText({ object: value, hostile })
  assert.equal(getters, 0); assert.equal(serializers, 0); noSecrets(report)
  assert(report.includes('[circular]')); assert(report.includes('[accessor omitted]')); assert(report.includes('[uninspectable]')); assert(report.includes('safe_diagnostic'))
})

test('mirrored console messages and browser error events receive redacted, bounded diagnostics', t => {
  const { listeners } = browser(t)
  const before = { log: console.log, warn: console.warn, error: console.error }, target = console as unknown as { __reportBugPatched?: boolean }, wasPatched = target.__reportBugPatched
  const mirrored: string[] = []
  console.log = (...args) => { mirrored.push(args.join(' ')) }; console.warn = console.log; console.error = console.log
  delete target.__reportBugPatched
  try {
    initLogCapture(); initLogCapture()
    console.error('CONSOLE_MARKER', { password: PASSWORD, email: EMAIL, phase: 'playing' }, `Bearer ${TOKEN}`)
    listeners.error({ message: `login code=${CODE}`, filename: `https://nrn.example.test/file.js?token=${TOKEN}`, lineno: 12, colno: 3, error: new Error(`password=${PASSWORD}`) })
    listeners.unhandledrejection({ reason: { token: TOKEN, reason: 'network unavailable' } })
    noSecrets(mirrored.join('\n')); noSecrets(getReportText())
    assert(mirrored.join('\n').includes('CONSOLE_MARKER')); assert(mirrored.join('\n').includes('playing')); assert(getReportText().includes('network unavailable'))
  } finally { console.log = before.log; console.warn = before.warn; console.error = before.error; if (wasPatched === undefined) delete target.__reportBugPatched; else target.__reportBugPatched = wasPatched }
})

test('clipboard export is explicit and sanitized, and unavailable clipboard access returns false', async t => {
  const { clipboard } = browser(t)
  assert.equal(await copyReportToClipboard({ password: PASSWORD, email: EMAIL, phase: 'bidding' }), true)
  noSecrets(clipboard.text); assert(clipboard.text.includes('bidding'))
  clipboard.fail = true; assert.equal(await copyReportToClipboard({ token: TOKEN }), false)
})

test('log count, entry sizes, nesting and final report size remain bounded', () => {
  let deep: unknown = { token: TOKEN }
  for (let i = 0; i < 100; i++) deep = { nested: deep }
  pushLog('warn', 'DEPTH_MARKER', deep)
  assert(getReportText().includes('[depth limit]'))
  for (let i = 0; i < 350; i++) pushLog('log', `bounded-entry-${i}`, 'long message '.repeat(3000), Array(1000).fill({ password: PASSWORD }))
  const report = getReportText({ large: 'context '.repeat(100_000) })
  assert(report.length <= 64 * 1024); assert.equal(report.includes('bounded-entry-0"'), false); assert(report.includes('[report truncated]')); noSecrets(report)
  assert(report.includes('bounded-entry-349'), 'the newest error must survive the report size cap')
})
