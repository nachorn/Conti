import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import test from 'node:test'
import { MembershipService } from '../src/membership.js'
import { SecurityNotices, type SecurityNoticeSender } from '../src/securityNotices.js'

test('limits notice concurrency and queue size, suppresses duplicates, and keeps delivery errors private', async () => {
  let time = 1000
  const sends: string[] = []
  const completions: (() => void)[] = []
  const notices = new SecurityNotices(async email => {
    sends.push(email)
    await new Promise<void>(resolve => completions.push(resolve))
    throw new Error('private delivery details')
  }, () => time)
  const account = { id: 'one', email: 'first@example.com' }
  notices.schedule(account, 'password_changed', 'es')
  notices.schedule(account, 'password_changed', 'es')
  notices.schedule(account, 'administration_opened', 'es')
  await setImmediate()
  assert.deepEqual(sends, [account.email, account.email])
  for (let i = 0; i < 100; i++) notices.schedule({ id: `member-${i}`, email: `alias${i}@example.com` }, 'password_changed', 'en')
  assert.deepEqual(notices.status(), { pending: 26, failures: 0 })
  time += 15 * 60_000
  const pending = notices.stop()
  for (const complete of completions) complete()
  await Promise.all(pending)
  notices.schedule(account, 'password_changed', 'es')
  assert.deepEqual(notices.status(), { pending: 0, failures: 2 })
  assert.equal(sends.length, 2)
})

test('a notice for the same activity can be emitted again after the cooldown', async () => {
  let time = 1000, sent = 0
  const notices = new SecurityNotices(async () => { sent++ }, () => time)
  const account = { id: 'one', email: 'first@example.com' }
  notices.schedule(account, 'password_changed', 'es')
  await setImmediate()
  notices.schedule(account, 'password_changed', 'es')
  await setImmediate()
  assert.equal(sent, 1)
  time += 15 * 60_000
  notices.schedule(account, 'password_changed', 'es')
  await setImmediate()
  assert.equal(sent, 2)
})

test('notices correspond to completed account and admin actions, and provider errors do not change their result', async () => {
  const email = 'primary@example.com'
  const activity: Parameters<SecurityNoticeSender>[] = []
  let state: unknown = null
  let code = ''
  let failNextSave = false
  const service = await new MembershipService({
    store: {
      async load() { return state },
      async save(value) {
        if (failNextSave) { failNextSave = false; throw new Error('test store failure') }
        state = structuredClone(value)
      },
      async close() {},
    },
    authSecret: 'only-synthetic-security-notice-tests',
    adminEmails: [email],
    sendCode: async (_email, value) => { code = value },
    sendSecurityNotice: async (...event) => { activity.push(event); throw new Error('test delivery failure') },
  }).load()
  await service.requestCode(email, 'es', 'notice-local')
  const initial = await service.verifyCode(email, code, 'notice-local')
  const admin = service.adminAccountVerifier()!
  await admin.challenge(initial.token, 'es')
  const unrelatedCode = (Number(code) + 1).toString().padStart(6, '0').slice(-6)
  assert.throws(() => admin.confirm(initial.token, unrelatedCode), /invalid_code/)
  assert.deepEqual(activity, [])
  const proof = admin.confirm(initial.token, code)
  assert.equal(admin.verify(initial.token, proof), null)
  const replacement = await service.revokeOtherSessions(initial.token, 'es')
  assert.ok(service.authenticate(replacement.token))
  await service.requestPasswordReset(email, 'es', 'notice-local')
  const resetCode = code
  await setImmediate()
  const updated = await service.confirmPasswordReset(email, resetCode, 'Only for the security notice tests', 'notice-local', 'en')
  assert.equal(updated.account.hasPassword, true)
  await setImmediate()
  assert.deepEqual(activity, [
    [email, 'administration_opened', 'es'],
    [email, 'other_sessions_closed', 'es'],
    [email, 'password_changed', 'en'],
  ])
  assert.deepEqual(service.emailDeliveryStatus(), { pending: 0, failures: 3 })
  failNextSave = true
  await assert.rejects(service.revokeOtherSessions(updated.token, 'en'), /server_unavailable/)
  await setImmediate()
  assert.equal(activity.length, 3)
  await service.close()
})
