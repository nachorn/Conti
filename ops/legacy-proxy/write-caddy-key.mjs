import { writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { deriveLegacyProxyKey } from './proxy.mjs';

// Offline installation helper. Input comes from the existing private environment,
// never an argument. Output is exclusively a new protected file, never stdout.
const destination = process.argv[2];
if (!destination || !isAbsolute(destination) || process.argv.length !== 3) throw new Error('Supply one absolute private output path');
const key = deriveLegacyProxyKey(process.env.MEMBERSHIP_AUTH_SECRET);
await writeFile(destination, `NRN_LEGACY_PROXY_KEY=${key}\n`, { flag: 'wx', mode: 0o600 });
console.log('Created protected Caddy key file');
