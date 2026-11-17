import http from 'node:http';
import https from 'node:https';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export const UPSTREAM_ORIGIN = 'https://api.nrnplay.com';
const upstream = new URL(UPSTREAM_ORIGIN);
const hopHeaders = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const identityHeaders = new Set([
  'forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
  'x-real-ip', 'cf-connecting-ip', 'true-client-ip',
]);

export function deriveLegacyProxyKey(authSecret) {
  const secret = typeof authSecret === 'string' ? authSecret.trim() : '';
  if (secret.length < 32) throw new Error('The existing account secret is required');
  return createHmac('sha256', secret).update('nrnplay:legacy-proxy:v3').digest('hex');
}

function cleanHeaders(headers, { inbound = false } = {}) {
  const excluded = new Set(hopHeaders);
  for (const name of String(headers.connection ?? '').split(',')) excluded.add(name.trim().toLowerCase());
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || excluded.has(lower)) continue;
    if (inbound && (identityHeaders.has(lower) || lower.startsWith('x-forwarded-') || lower.startsWith('x-nrn-'))) continue;
    result[lower] = value;
  }
  return result;
}

function validPath(path) {
  return typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !/[\\#\r\n\0]/.test(path);
}

function clientAddress(socket) {
  const address = socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
  return isIP(address) ? address : undefined;
}

function json(res, status, code) {
  const body = JSON.stringify({ error: code });
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
  res.end(body);
}

function rawHeaders(status, headers) {
  // Node has already validated response header characters. Preserve array headers (Set-Cookie).
  const lines = [`HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? 'Response'}`];
  for (const [name, value] of Object.entries(headers)) {
    for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
  }
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function rawError(socket, status, code) {
  if (socket.destroyed) return;
  const body = JSON.stringify({ error: code });
  socket.end(rawHeaders(status, {
    connection: 'close', 'content-type': 'application/json',
    'content-length': Buffer.byteLength(body), 'cache-control': 'no-store',
  }) + body);
}

/** A single fixed HTTPS upstream. request is injectable solely for local TLS tests. */
export function createLegacyProxy({
  authSecret,
  request = https.request,
  headerTimeoutMs = 30_000,
  idleTimeoutMs = 75_000,
  shutdownGraceMs = 7_500,
} = {}) {
  const legacyKey = deriveLegacyProxyKey(authSecret);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 8 });
  const sockets = new Set();
  const upgradedSockets = new Set();
  let closing;
  let checkClosed = () => {};

  function options(req, websocket = false) {
    const headers = cleanHeaders(req.headers, { inbound: true });
    headers.host = upstream.hostname;
    headers['x-nrn-legacy-key'] = legacyKey;
    const ip = clientAddress(req.socket);
    if (ip) headers['x-nrn-client-ip'] = ip;
    headers['x-nrn-legacy-hop'] = '1';
    if (websocket) {
      headers.connection = 'Upgrade';
      headers.upgrade = 'websocket';
    }
    return {
      protocol: 'https:', hostname: upstream.hostname, servername: upstream.hostname,
      port: 443, method: req.method, path: req.url, headers, agent,
      // TLS peer verification is never disabled; Host and SNI match the fixed destination.
    };
  }

  function allowed(req) {
    if (!validPath(req.url)) return [400, 'invalid_request_target'];
    if (req.headers['x-nrn-legacy-hop']) return [508, 'proxy_loop'];
    return null;
  }

  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    const invalid = allowed(req);
    if (invalid) { json(res, ...invalid); req.resume(); return; }
    if (req.method === 'CONNECT') { json(res, 405, 'method_not_allowed'); req.resume(); return; }
    if ((req.method === 'GET' || req.method === 'HEAD') && req.url.split('?')[0] === '/health') {
      req.resume();
      const body = JSON.stringify({ ok: true, mode: 'legacy-proxy', upstream: UPSTREAM_ORIGIN });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    let outgoing;
    let deadline;
    const fail = () => {
      clearTimeout(deadline);
      if (res.headersSent) res.destroy();
      else if (!res.destroyed) json(res, 503, 'upstream_unavailable');
    };
    try {
      outgoing = request(options(req), (response) => {
        clearTimeout(deadline);
        res.writeHead(response.statusCode ?? 502, cleanHeaders(response.headers));
        response.on('error', () => res.destroy());
        response.pipe(res);
      });
      deadline = setTimeout(() => outgoing.destroy(new Error('Upstream response deadline')), headerTimeoutMs);
      deadline.unref();
      outgoing.setTimeout(idleTimeoutMs, () => outgoing.destroy(new Error('Upstream idle deadline')));
      outgoing.on('error', fail);
      req.on('aborted', () => outgoing.destroy());
      res.on('close', () => { clearTimeout(deadline); if (!res.writableFinished) outgoing.destroy(); });
      req.pipe(outgoing);
    } catch { fail(); }
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 5_000;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => { sockets.delete(socket); checkClosed(); });
  });
  server.on('clientError', (error, socket) => rawError(socket, error.code === 'HPE_HEADER_OVERFLOW' ? 431 : 400, 'invalid_request'));
  server.on('connect', (_req, socket) => rawError(socket, 405, 'method_not_allowed'));

  server.on('upgrade', (req, client, clientHead) => {
    client.pause();
    const invalid = allowed(req);
    if (invalid) { rawError(client, ...invalid); return; }
    if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      rawError(client, 400, 'unsupported_upgrade'); return;
    }
    let outgoing;
    let deadline;
    let established = false;
    const fail = () => {
      clearTimeout(deadline);
      if (established) client.destroy();
      else rawError(client, 503, 'upstream_unavailable');
    };
    try {
      outgoing = request(options(req, true));
      deadline = setTimeout(() => outgoing.destroy(new Error('Upstream upgrade deadline')), headerTimeoutMs);
      deadline.unref();
      outgoing.on('error', fail);
      client.on('error', () => outgoing.destroy());
      client.on('close', () => { clearTimeout(deadline); outgoing.destroy(); });
      outgoing.on('upgrade', (response, target, upstreamHead) => {
        clearTimeout(deadline);
        if (response.statusCode !== 101 || response.headers.upgrade?.toLowerCase() !== 'websocket' || client.destroyed) {
          target.destroy(); fail(); return;
        }
        established = true;
        upgradedSockets.add(target);
        target.on('close', () => { upgradedSockets.delete(target); client.destroy(); });
        target.on('error', () => client.destroy());
        client.on('close', () => target.destroy());
        const headers = cleanHeaders(response.headers);
        headers.connection = 'Upgrade';
        headers.upgrade = 'websocket';
        client.write(rawHeaders(101, headers), 'latin1');
        if (upstreamHead.length) client.write(upstreamHead);
        if (clientHead.length) target.write(clientHead);
        target.pipe(client);
        client.pipe(target);
        client.resume();
      });
      outgoing.on('response', (response) => {
        clearTimeout(deadline);
        const headers = cleanHeaders(response.headers);
        headers.connection = 'close';
        client.write(rawHeaders(response.statusCode ?? 502, headers), 'latin1');
        response.on('error', () => client.destroy());
        response.pipe(client);
      });
      outgoing.end();
    } catch { fail(); }
  });

  return {
    server,
    close() {
      if (closing) return closing;
      closing = new Promise((resolve) => {
        let serverClosed = false;
        const force = setTimeout(() => {
          for (const socket of upgradedSockets) socket.destroy();
          for (const socket of sockets) socket.destroy();
        }, shutdownGraceMs);
        force.unref();
        checkClosed = () => {
          if (!serverClosed || sockets.size) return;
          clearTimeout(force);
          agent.destroy();
          resolve();
        };
        server.close(() => { serverClosed = true; checkClosed(); });
        server.closeIdleConnections();
      });
      return closing;
    },
  };
}
