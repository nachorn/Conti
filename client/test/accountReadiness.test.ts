import assert from 'node:assert/strict'
import test from 'node:test'
import { accountView } from '../src/lib/accountReadiness.ts'

test('initial checks never present an unresolved saved session as signed out', () => {
  for (const serverStatus of ['connecting', 'ready', 'unavailable'] as const) {
    assert.equal(accountView({ account: null, token: 'saved-token', loaded: false, serverStatus }), 'pending')
    assert.equal(accountView({ account: null, token: 'saved-token', loaded: true, serverStatus }), 'pending')
  }
  assert.equal(accountView({ account: null, token: null, loaded: false, serverStatus: 'ready' }), 'pending')
})

test('only a completed healthy check without account or credential can offer sign-in', () => {
  assert.equal(accountView({ account: null, token: null, loaded: true, serverStatus: 'ready' }), 'signed-out')
  assert.equal(accountView({ account: null, token: null, loaded: true, serverStatus: 'unavailable' }), 'pending')
  assert.equal(accountView({ account: null, token: null, loaded: true, serverStatus: 'connecting' }), 'pending')
  assert.equal(accountView({ account: { id: 'last-account' }, token: null, loaded: true, serverStatus: 'ready' }), 'pending')
})

test('an already verified account stays visible during background recovery', () => {
  for (const serverStatus of ['connecting', 'ready', 'unavailable'] as const) {
    assert.equal(accountView({ account: { id: 'verified-account' }, token: 'verified-token', loaded: true, serverStatus }), 'signed-in')
  }
})
