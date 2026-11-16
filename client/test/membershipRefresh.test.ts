import assert from 'node:assert/strict'
import test from 'node:test'
import { subscribeMembershipRefresh } from '../src/lib/membershipRefresh.ts'
import { hasCosmeticAccess } from '../src/lib/cosmetics.ts'

test('returning to a visible page refreshes authoritative courtesy access without waiting for the minute poll', () => {
  const target = new EventTarget()
  const page = Object.assign(new EventTarget(), { hidden: true })
  let account = { adFree: false, expiresAt: null as number | null }
  let server = { ...account }
  let reads = 0
  const listener = subscribeMembershipRefresh(() => { reads++; account = { ...server } }, target, page)
  server = { adFree: true, expiresAt: 1_952_569_394_000 }
  target.dispatchEvent(new Event('focus'))
  listener.refreshVisible()
  assert.equal(reads, 0, 'hidden tabs do not poll or adopt cached access')
  assert.equal(hasCosmeticAccess(account, 1_800_000_000_000), false)
  page.hidden = false
  page.dispatchEvent(new Event('visibilitychange'))
  assert.equal(reads, 1)
  assert.equal(hasCosmeticAccess(account, 1_800_000_000_000), true)
  listener.dispose()
})

test('visible focus and polling also observe revocation, and unmount removes both lifecycle listeners', () => {
  const target = new EventTarget()
  const page = Object.assign(new EventTarget(), { hidden: false })
  let reads = 0
  let account = { adFree: true, expiresAt: null }
  const server = { adFree: false, expiresAt: null }
  const listener = subscribeMembershipRefresh(() => { reads++; account = { ...server } }, target, page)
  target.dispatchEvent(new Event('focus'))
  assert.equal(hasCosmeticAccess(account), false, 'server-side revocation is applied on visible focus')
  listener.refreshVisible()
  assert.equal(reads, 2)
  listener.dispose()
  target.dispatchEvent(new Event('focus'))
  page.dispatchEvent(new Event('visibilitychange'))
  assert.equal(reads, 2)
})
