import test from 'node:test';
import assert from 'node:assert/strict';
import { scrypt } from 'node:crypto';
import { createLegacyProxy } from '../proxy.mjs';
import { createPasswordWorkClient, createPasswordWorkHandler } from '../../../server/dist/passwordWorker.js';

test('the signed password handler runs locally and never forwards password work to Azure', async () => {
  const authSecret = 'local-deployment-review-secret-'.repeat(3);
  const handler = createPasswordWorkHandler({ authSecret });
  let forwarded = 0;
  const proxy = createLegacyProxy({ authSecret, handleRequest: handler, request() { forwarded++; throw new Error('Unexpected upstream'); } });
  await new Promise(resolve => proxy.server.listen(0, '127.0.0.1', resolve));
  const local = `http://127.0.0.1:${proxy.server.address().port}`;
  try {
    const client = createPasswordWorkClient({ origin: 'https://worker.example.test', authSecret,
      request: (url, init) => fetch(local + new URL(url).pathname, init) });
    const password = 'Synthetic deployment test password';
    const salt = Buffer.alloc(16, 31);
    const actual = await client.derive(password, salt);
    const expected = await new Promise((resolve, reject) => scrypt(password, salt, 32,
      { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result)));
    assert.deepEqual(actual, expected);
    const denied = await fetch(local + '/internal/password/derive', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 401);
    assert.equal(forwarded, 0);
    assert.deepEqual(handler.status(), { active: 0, queued: 0 });
  } finally { await Promise.all([proxy.close(), handler.close()]); }
});
