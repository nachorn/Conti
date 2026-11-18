import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readProxyCredentials } from '../credentials.mjs';
import { createLegacyProxy, deriveLegacyProxyKey } from '../proxy.mjs';
import { createPasswordWorkClient, createPasswordWorkHandler, derivePasswordWorkerSigningKey, PASSWORD_WORK_PATH } from '../../../server/dist/passwordWorker.js';

const secret = randomBytes(32).toString('base64url');
const keys = { NRN_LEGACY_PROXY_KEY: deriveLegacyProxyKey(secret), NRN_PASSWORD_WORKER_SIGNING_KEY: derivePasswordWorkerSigningKey(secret) };

test('old, transitional and strict environments preserve the exact existing scoped key bytes', () => {
  assert.equal(keys.NRN_PASSWORD_WORKER_SIGNING_KEY, createHmac('sha256', secret).update('nrnplay:password-worker:v1').digest('base64url'));
  assert.equal(readProxyCredentials({ MEMBERSHIP_AUTH_SECRET: secret }).authSecret, secret);
  const transitional = { ...keys };
  Object.defineProperty(transitional, 'MEMBERSHIP_AUTH_SECRET', { get() { throw new Error('Principal secret must not be read when scoped keys exist'); } });
  assert.deepEqual(readProxyCredentials(transitional), { legacyKey: keys.NRN_LEGACY_PROXY_KEY, signingKey: keys.NRN_PASSWORD_WORKER_SIGNING_KEY, authSecret: undefined });
  assert.deepEqual(readProxyCredentials({ ...keys, NRN_REQUIRE_SCOPED_RENDER_SECRETS: 'true', PORT: '10000', NODE_ENV: 'production' }), readProxyCredentials(keys));
});

test('explicitly malformed scoped keys and strict environments with unrelated credentials fail closed', () => {
  for (const key of ['', 'A'.repeat(64), 'a'.repeat(63)]) assert.throws(() => readProxyCredentials({ ...keys, MEMBERSHIP_AUTH_SECRET: secret, NRN_LEGACY_PROXY_KEY: key }), /canonical/);
  for (const key of ['', 'A'.repeat(42), 'A'.repeat(42) + 'B', ' ' + keys.NRN_PASSWORD_WORKER_SIGNING_KEY]) assert.throws(() => readProxyCredentials({ ...keys, MEMBERSHIP_AUTH_SECRET: secret, NRN_PASSWORD_WORKER_SIGNING_KEY: key }), /canonical/);
  assert.throws(() => readProxyCredentials({ MEMBERSHIP_AUTH_SECRET: secret, NRN_REQUIRE_SCOPED_RENDER_SECRETS: 'true' }), /requires both/);
  for (const name of ['MEMBERSHIP_AUTH_SECRET', 'DATABASE_URL', 'ADMIN_DASHBOARD_KEY', 'ADMIN_ACCOUNT_EMAILS', 'SMTP_PASSWORD', 'GOOGLE_REFRESH_TOKEN', 'RESEND_API_KEY', 'BMC_WEBHOOK_SECRET']) {
    assert.throws(() => readProxyCredentials({ ...keys, NRN_REQUIRE_SCOPED_RENDER_SECRETS: 'true', [name]: 'synthetic-private-placeholder' }), /principal application credentials/);
  }
});

test('strict Render mode accepts an existing Azure-style signed client without any principal environment credential', async () => {
  const credentials = readProxyCredentials({ ...keys, NRN_REQUIRE_SCOPED_RENDER_SECRETS: 'true' });
  const worker = createPasswordWorkHandler({ signingKey: credentials.signingKey });
  let forwarded = 0;
  const proxy = createLegacyProxy({ legacyKey: credentials.legacyKey, handleRequest: worker, request() { forwarded++; throw new Error('Unexpected upstream'); } });
  await new Promise(resolve => proxy.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${proxy.server.address().port}`;
  try {
    const client = createPasswordWorkClient({ origin: 'https://worker.example.test', authSecret: secret, request: (_url, init) => fetch(base + PASSWORD_WORK_PATH, init) });
    const result = await client.derive('Synthetic scoped deployment password', Buffer.alloc(16, 17));
    assert.equal(result.length, 32);
    assert.equal(forwarded, 0);
  } finally { await Promise.all([proxy.close(), worker.close()]); }
});

test('derived-only Render worker retains the 32-reader resource bound and cancels readers on close', async () => {
  const credentials = readProxyCredentials({ ...keys, NRN_REQUIRE_SCOPED_RENDER_SECRETS: 'true' });
  const worker = createPasswordWorkHandler({ signingKey: credentials.signingKey });
  const requests = Array.from({ length: 40 }, () => {
    const req = new EventEmitter(), res = new EventEmitter();
    Object.assign(req, { url: PASSWORD_WORK_PATH, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': '4096',
      'x-nrn-password-timestamp': String(Date.now()), 'x-nrn-password-nonce': 'A'.repeat(22), 'x-nrn-password-signature': 'A'.repeat(43) },
      resume() {}, destroy() { req.emit('aborted'); } });
    Object.assign(res, { destroyed: false, writableEnded: false, statusCode: 200, setHeader() {}, end() { res.writableEnded = true; res.emit('close'); } });
    worker(req, res);
    return { req, res };
  });
  let cancelled = false;
  try {
    assert.equal(requests.filter(({ req }) => req.listenerCount('data')).length, 32);
    assert.equal(requests.filter(({ res }) => res.statusCode === 503 && res.writableEnded).length, 8);
  } finally {
    await worker.close();
    cancelled = requests.every(({ req }) => req.listenerCount('data') === 0);
    for (const { req } of requests) req.emit('aborted');
  }
  assert(cancelled);
  assert.deepEqual(worker.status(), { active: 0, queued: 0 });
});
