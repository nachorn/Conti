import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// Reviewed 2026-11-17: upstream has no patched picomatch release. Vite and
// its glob helpers are development dependencies; neither published static
// assets nor the game server accepts glob patterns. Never waive runtime use.
export const BUILD_ADVISORY = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const EXPIRES = Date.parse('2026-12-18T00:00:00Z');
const TOOL_PACKAGES = new Set(['picomatch', 'fdir', 'tinyglobby', 'vite']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function checkClientAudit(report, lock, now = Date.now(), latestPicomatch = '4.0.7') {
  if (!object(report) || report.error || !object(report.metadata?.vulnerabilities) || !object(report.vulnerabilities) ||
      !object(lock?.packages) || !Number.isFinite(now)) throw new Error('Dependency audit did not return a complete report');
  const counts = report.metadata.vulnerabilities;
  if (!['info', 'low', 'moderate', 'high', 'critical'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) throw new Error('Invalid audit totals');
  const high = Object.entries(report.vulnerabilities).filter(([, value]) => ['high', 'critical'].includes(value?.severity));
  if (high.length !== counts.high + counts.critical) throw new Error('Inconsistent audit totals');
  const reviewed = (name, seen = new Set()) => {
    if (!TOOL_PACKAGES.has(name) || seen.has(name)) return false;
    const value = report.vulnerabilities[name];
    if (!object(value) || value.severity === 'critical' || !Array.isArray(value.nodes) || !value.nodes.length ||
        !value.nodes.every(node => typeof node === 'string' && lock.packages[node]?.dev === true) ||
        !Array.isArray(value.via) || !value.via.length) return false;
    const next = new Set(seen).add(name);
    return value.via.every(advisory => typeof advisory === 'string' ? reviewed(advisory, next)
      : object(advisory) && advisory.url === BUILD_ADVISORY && advisory.name === 'picomatch');
  };
  if (high.length && (latestPicomatch !== '4.0.7' || now >= EXPIRES || !high.every(([name]) => reviewed(name)))) {
    throw new Error('An unreviewed, runtime, expired or critical dependency advisory blocks this build');
  }
  return { counts: { ...counts }, reviewedBuildOnly: high.length > 0, expiresAt: new Date(EXPIRES).toISOString() };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const result = checkClientAudit(JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), Date.now(), JSON.parse(fs.readFileSync(process.argv[4], 'utf8')));
    if (result.reviewedBuildOnly) console.warn(`OPEN: ${BUILD_ADVISORY}; no upstream fix. Development-only, no public glob input. Review expires ${result.expiresAt}.`);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
