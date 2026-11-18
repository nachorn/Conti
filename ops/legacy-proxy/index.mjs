import { createLegacyProxy, UPSTREAM_ORIGIN } from './proxy.mjs';
import { createPasswordWorkHandler } from './passwordWorker.js';
import { readProxyCredentials } from './credentials.mjs';

const rawPort = process.env.PORT ?? '10000';
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('Invalid listener port');
const credentials = readProxyCredentials(process.env);
const passwordWork = createPasswordWorkHandler({ signingKey: credentials.signingKey, authSecret: credentials.authSecret });
const proxy = createLegacyProxy({ legacyKey: credentials.legacyKey, authSecret: credentials.authSecret, handleRequest: passwordWork });
proxy.server.listen(Number(rawPort), '0.0.0.0', () => {
  console.log(`NRN legacy proxy listening on port ${rawPort}; upstream ${UPSTREAM_ORIGIN}`);
});
proxy.server.on('error', () => { console.error('Legacy proxy listener failed'); process.exitCode = 1; });
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  void Promise.all([proxy.close(), passwordWork.close()]);
});
