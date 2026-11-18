import assert from 'node:assert/strict'
import test from 'node:test'
import { createMembershipEmailSender } from '../src/membershipEmail.js'

test('backup notices reuse the existing private email transport with fixed content', async () => {
  const sent: any[] = []
  const sender = createMembershipEmailSender({ RESEND_API_KEY: 'public-fixture-key', MEMBERSHIP_EMAIL_FROM: 'test@example.test' }, async (_url, options) => {
    sent.push(JSON.parse(options!.body as string)); return new Response(JSON.stringify({ id: 'fixture-message' }), { status: 200 })
  })!
  await sender.backupNotice('owner@example.test', { kind: 'stale', lastSuccessfulAt: 1000, observedAt: 2000 })
  await sender.backupNotice('owner@example.test', { kind: 'recovered', lastSuccessfulAt: 2000, observedAt: 2000 })
  assert.match(sent[0].subject, /atrasada/); assert.match(sent[1].subject, /restablecidas/)
  assert(!JSON.stringify(sent).includes('public-fixture-key'))
  await assert.rejects(sender.backupNotice('owner@example.test', { kind: 'recovered', lastSuccessfulAt: null, observedAt: 2000 }))
  assert.equal(sent.length, 2)
})
