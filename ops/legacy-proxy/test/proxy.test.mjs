import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createLegacyProxy, deriveLegacyProxyKey, UPSTREAM_ORIGIN } from '../proxy.mjs';
import { key, cert } from './tls-fixture.mjs';

const authSecret = 'public-test-only-secret-0123456789';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function setup(t, handler = (_req, res) => res.end('ok'), proxyOptions = {}) {
  const target = https.createServer({ key, cert }, handler);
  const targetSockets = new Set();
  target.on('connection', (socket) => {
    targetSockets.add(socket);
    socket.on('close', () => targetSockets.delete(socket));
  });
  const targetPort = await listen(target);
  const sent = [];
  const proxy = createLegacyProxy({
    authSecret,
    shutdownGraceMs: 30,
    request(options, callback) {
      sent.push(options);
      assert.equal(options.protocol, 'https:');
      assert.equal(options.hostname, 'api.nrnplay.com');
      assert.equal(options.servername, 'api.nrnplay.com');
      assert.equal(options.port, 443);
      assert.equal(options.headers.host, 'api.nrnplay.com');
      assert.notEqual(options.rejectUnauthorized, false);
      return https.request({ ...options, hostname: '127.0.0.1', port: targetPort, servername: 'localhost', ca: cert, agent: false }, callback);
    },
    ...proxyOptions,
  });
  const port = await listen(proxy.server);
  t.after(async () => {
    await proxy.close();
    for (const socket of targetSockets) socket.destroy();
    await new Promise((resolve) => target.close(resolve));
  });
  return { port, proxy, target, sent };
}

function call(port, options = {}, chunks = []) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, agent: false, ...options }, (res) => {
      const bytes = [];
      res.on('data', (data) => bytes.push(data));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(bytes) }));
    });
    req.on('error', reject);
    for (const chunk of chunks) req.write(chunk);
    req.end();
  });
}

function raw(port, request, complete = (bytes) => bytes.includes(Buffer.from('\r\n\r\n'))) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    const chunks = [];
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Timed out waiting for proxy bytes')); }, 2_000);
    const finish = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(Buffer.concat(chunks));
    };
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk) => { chunks.push(chunk); if (complete(Buffer.concat(chunks))) finish(); });
    socket.on('end', finish);
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
  });
}

test('health is local, including HEAD; ready retains upstream status', async (t) => {
  const { port, sent } = await setup(t, (_req, res) => { res.writeHead(503); res.end('not ready'); });
  const healthy = await call(port, { path: '/health' });
  assert.equal(healthy.status, 200);
  assert.deepEqual(JSON.parse(healthy.body), { ok: true, mode: 'legacy-proxy', upstream: UPSTREAM_ORIGIN });
  assert.equal((await call(port, { method: 'HEAD', path: '/health' })).body.length, 0);
  assert.equal(sent.length, 0);
  const ready = await call(port, { path: '/ready' });
  assert.equal(ready.status, 503);
  assert.equal(ready.body.toString(), 'not ready');
  assert.equal(sent.length, 1);
});

test('GET keeps application headers and response cookies but replaces forwarding identity', async (t) => {
  let received;
  const { port } = await setup(t, (req, res) => {
    received = req;
    res.writeHead(207, { 'set-cookie': ['one=1; Secure', 'two=2; Secure'], 'x-upstream': 'yes', connection: 'x-private', 'x-private': 'hidden' });
    res.end('response');
  });
  const response = await call(port, { path: '/api/account/me?raw=a%2Fb&url=https://evil.test', headers: {
    host: 'evil.test', authorization: 'Bearer public-test-token', cookie: 'one=1', origin: 'https://nrnplay.com',
    connection: 'close, x-drop', 'x-drop': 'hidden', 'x-forwarded-for': '8.8.8.8', 'x-forwarded-proto': 'http',
    forwarded: 'for=8.8.8.8', 'x-real-ip': '8.8.8.8', 'cf-connecting-ip': '8.8.8.8',
    'x-nrn-legacy-key': 'spoof', 'x-nrn-client-ip': '8.8.8.8', 'x-nrn-arbitrary': 'hidden', 'x-forwarded-custom': 'hidden',
  } });
  assert.equal(received.url, '/api/account/me?raw=a%2Fb&url=https://evil.test');
  assert.equal(received.headers.host, 'api.nrnplay.com');
  assert.equal(received.headers.authorization, 'Bearer public-test-token');
  assert.equal(received.headers.cookie, 'one=1');
  assert.equal(received.headers.origin, 'https://nrnplay.com');
  for (const name of ['x-drop', 'x-forwarded-for', 'x-forwarded-proto', 'forwarded', 'x-real-ip', 'cf-connecting-ip', 'x-nrn-arbitrary', 'x-forwarded-custom']) assert.equal(received.headers[name], undefined);
  assert.equal(received.headers['x-nrn-legacy-key'], deriveLegacyProxyKey(authSecret));
  assert.equal(received.headers['x-nrn-client-ip'], '127.0.0.1');
  assert.equal(received.headers['x-nrn-legacy-hop'], '1');
  assert.equal(response.status, 207);
  assert.deepEqual(response.headers['set-cookie'], ['one=1; Secure', 'two=2; Secure']);
  assert.equal(response.headers['x-private'], undefined);
});

test('POST streams exact webhook bytes and signature without parsing or retry', async (t) => {
  const body = Buffer.concat([Buffer.from('\ufeff { "unicode": "ñ",\r\n "amount": 1.00 } \n'), Buffer.from([0, 1, 127, 255])]);
  let received;
  let requests = 0;
  const { port } = await setup(t, (req, res) => {
    requests++;
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      received = { body: Buffer.concat(chunks), headers: req.headers };
      res.writeHead(202); res.end('accepted');
    });
  });
  const response = await call(port, { method: 'POST', path: '/api/membership/bmc/webhook', headers: {
    'content-type': 'application/json', 'content-length': body.length, 'x-bmc-signature': 'public-fixture-signature',
  } }, [body.subarray(0, 7), body.subarray(7, 25), body.subarray(25)]);
  assert.equal(response.status, 202);
  assert.deepEqual(received.body, body);
  assert.equal(received.headers['x-bmc-signature'], 'public-fixture-signature');
  assert.equal(requests, 1);
});

test('unavailable upstream fails generically; request deadline destroys stalled work', async (t) => {
  const { port, sent } = await setup(t, () => {}, { headerTimeoutMs: 25 });
  const response = await call(port, { method: 'POST', path: '/webhook' }, ['payload']);
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body), { error: 'upstream_unavailable' });
  assert.equal(sent.length, 1);
});

test('transport errors fail closed and never expose exception details', async (t) => {
  const { port } = await setup(t, undefined, { request() { throw new Error('private-address-or-credential'); } });
  const response = await call(port, { path: '/ready' });
  assert.equal(response.status, 503);
  assert.equal(response.body.toString().includes('private'), false);
});

test('an untrusted upstream TLS certificate is rejected', async (t) => {
  const target = https.createServer({ key, cert }, (_req, res) => res.end('must not be accepted'));
  const targetPort = await listen(target);
  const { port } = await setup(t, undefined, {
    request(options, callback) {
      return https.request({ ...options, hostname: '127.0.0.1', port: targetPort, servername: 'localhost', agent: false }, callback);
    },
  });
  t.after(() => new Promise((resolve) => target.close(resolve)));
  const response = await call(port, { path: '/ready' });
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(response.body), { error: 'upstream_unavailable' });
});

test('rejects absolute targets, CONNECT, unsupported upgrades and proxy loops', async (t) => {
  const { port, sent } = await setup(t);
  for (const path of ['https://evil.test/path', '//evil.test/path', '/bad\\path', '/bad#fragment']) {
    assert.equal((await call(port, { path })).status, 400);
  }
  assert.equal((await call(port, { path: '/', headers: { 'x-nrn-legacy-hop': '1' } })).status, 508);
  assert.match((await raw(port, 'CONNECT evil.test:443 HTTP/1.1\r\nHost: evil.test\r\n\r\n')).toString(), /^HTTP\/1.1 405/);
  assert.match((await raw(port, 'GET / HTTP/1.1\r\nHost: evil.test\r\nConnection: Upgrade\r\nUpgrade: arbitrary\r\n\r\n')).toString(), /^HTTP\/1.1 400/);
  assert.equal(sent.length, 0);
});

test('TLS websocket tunnel preserves upgrade headers and both initial binary packets', async (t) => {
  const firstClient = Buffer.from([0x82, 0x03, 0x00, 0xfe, 0xff]);
  const firstServer = Buffer.from([0x82, 0x02, 0xa1, 0x00]);
  const { port, target, sent } = await setup(t);
  let received = Buffer.alloc(0);
  target.on('upgrade', (req, socket, head) => {
    assert.equal(req.url, '/socket.io/?EIO=4&transport=websocket');
    assert.equal(req.headers.origin, 'https://conti.nrnplay.com');
    assert.equal(req.headers['sec-websocket-key'], 'fixture-key');
    socket.write(Buffer.concat([Buffer.from('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: fixture-accept\r\n\r\n'), firstServer]));
    if (head.length) { received = Buffer.concat([received, head]); socket.write(head); }
    socket.on('data', (data) => { received = Buffer.concat([received, data]); socket.write(data); });
  });
  const request = Buffer.concat([Buffer.from('GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\nHost: ignored\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: https://conti.nrnplay.com\r\nSec-WebSocket-Key: fixture-key\r\nSec-WebSocket-Version: 13\r\n\r\n'), firstClient]);
  const response = await raw(port, request, (bytes) => bytes.includes(firstServer) && bytes.includes(firstClient));
  assert.match(response.toString('latin1'), /^HTTP\/1.1 101/);
  assert.ok(response.includes(firstServer));
  assert.deepEqual(received, firstClient);
  assert.equal(sent.length, 1);
});

test('websocket authorization failure preserves upstream status and body', async (t) => {
  const { port } = await setup(t, (_req, res) => { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('denied'); });
  const response = await raw(port, 'GET /socket.io/ HTTP/1.1\r\nHost: ignored\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n', (bytes) => bytes.includes(Buffer.from('denied')));
  assert.match(response.toString(), /^HTTP\/1.1 403/);
  assert.ok(response.toString().endsWith('denied'));
});

test('graceful shutdown bounds active upgraded connections and is idempotent', async (t) => {
  const { port, target, proxy } = await setup(t);
  target.on('upgrade', (_req, socket) => socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'));
  const client = net.connect(port, '127.0.0.1');
  await once(client, 'connect');
  client.write('GET /socket.io/ HTTP/1.1\r\nHost: ignored\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
  await once(client, 'data');
  const closed = once(client, 'close');
  const closing = proxy.close();
  assert.equal(proxy.close(), closing);
  await closing;
  await closed;
  assert.equal(client.destroyed, true);
});

test('key derivation rotates only the separated transport context', () => {
  assert.equal(deriveLegacyProxyKey(authSecret), createHmac('sha256', authSecret).update('nrnplay:legacy-proxy:v3').digest('hex'));
  assert.notEqual(deriveLegacyProxyKey(authSecret), createHmac('sha256', authSecret).update('nrnplay:legacy-proxy:v2').digest('hex'));
  assert.notEqual(deriveLegacyProxyKey(authSecret), createHmac('sha256', authSecret).update('nrnplay:legacy-proxy:v1').digest('hex'));
  assert.throws(() => deriveLegacyProxyKey('short'));
});
