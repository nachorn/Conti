const scopedNames = new Set(['NRN_LEGACY_PROXY_KEY', 'NRN_PASSWORD_WORKER_SIGNING_KEY']);

/** Transition: prefer both scoped keys, then remove the old environment and enable strict mode. */
export function readProxyCredentials(env) {
  const strict = env.NRN_REQUIRE_SCOPED_RENDER_SECRETS;
  if (strict !== undefined && strict !== 'true' && strict !== 'false') throw new Error('Invalid scoped Render mode');
  const legacyKey = env.NRN_LEGACY_PROXY_KEY;
  const signingKey = env.NRN_PASSWORD_WORKER_SIGNING_KEY;
  if (legacyKey !== undefined && (typeof legacyKey !== 'string' || !/^[a-f0-9]{64}$/.test(legacyKey))) throw new Error('Legacy proxy key must be canonical SHA-256 hex');
  if (signingKey !== undefined && (typeof signingKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(signingKey) ||
      Buffer.from(signingKey, 'base64url').toString('base64url') !== signingKey)) throw new Error('Password worker key must be canonical 32-byte base64url');
  if (strict === 'true') {
    if (legacyKey === undefined || signingKey === undefined) throw new Error('Scoped Render mode requires both derived credentials');
    const forbidden = Object.keys(env).some(name => !scopedNames.has(name) && env[name] !== undefined && (
      ['MEMBERSHIP_AUTH_SECRET', 'DATABASE_URL', 'ADMIN_DASHBOARD_KEY', 'ADMIN_ACCOUNT_EMAILS', 'RENDER_API_KEY'].includes(name) ||
      /^(?:SMTP_|GOOGLE_|GMAIL_|RESEND_|STRIPE_|BMC_|TURNSTILE_)/.test(name)
    ));
    if (forbidden) throw new Error('Scoped Render mode cannot contain principal application credentials');
  }
  const authSecret = legacyKey === undefined || signingKey === undefined ? env.MEMBERSHIP_AUTH_SECRET : undefined;
  if ((legacyKey === undefined || signingKey === undefined) && (typeof authSecret !== 'string' || authSecret.trim().length < 32)) throw new Error('Both scoped keys or the existing transition secret are required');
  return { legacyKey, signingKey, authSecret };
}
