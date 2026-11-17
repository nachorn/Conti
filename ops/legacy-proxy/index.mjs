import { createLegacyProxy, UPSTREAM_ORIGIN } from './proxy.mjs';
import { createPasswordWorkHandler } from './passwordWorker.js';

const rawPort = process.env.PORT ?? '10000';
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('Invalid listener port');
const passwordWork = createPasswordWorkHandler({ authSecret: process.env.MEMBERSHIP_AUTH_SECRET ?? '' });
const proxy = createLegacyProxy({ authSecret: process.env.MEMBERSHIP_AUTH_SECRET, handleRequest: passwordWork });
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
