import assert from 'node:assert/strict'
import test from 'node:test'
import { readAccountForm } from '../src/lib/accountForm.ts'

const fallback = { name: '', email: '', password: '', confirmation: '', code: '' }
test('account submission reads password-manager-filled controls without changing literal password spaces', () => {
  const values = new Map([['nickname', 'Ana'], ['username', 'ana@example.com'], ['password', '  una frase larga de acceso  '], ['confirmPassword', '  una frase larga de acceso  ']])
  const fields = readAccountForm({ get: key => values.get(key) ?? null }, fallback)
  assert.deepEqual(fields, { name: 'Ana', email: 'ana@example.com', password: '  una frase larga de acceso  ', confirmation: '  una frase larga de acceso  ', code: '' })
})
test('code verification retains the pending account fields and recovery reads its new password', () => {
  const pending = { name: 'Ana', email: 'ana@example.com', password: 'previous phrase', confirmation: 'previous phrase', code: '' }
  const form = new FormData()
  form.set('code', '123456')
  assert.deepEqual(readAccountForm(form, pending), { ...pending, code: '123456' })
  form.set('newPassword', 'a new long password phrase')
  form.set('confirmPassword', 'a new long password phrase')
  assert.equal(readAccountForm(form, pending).password, 'a new long password phrase')
})
