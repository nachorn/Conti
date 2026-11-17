import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Literal URLs are visible to Node File Trace and remain relative to this module
// when a monorepo function is packaged below /var/task/client/api.
const guides = new Map([
  ['es/continental', { relative: 'es/continental/index.html', url: new URL('../public/learn/es/continental/index.html', import.meta.url) }],
  ['en/continental', { relative: 'en/continental/index.html', url: new URL('../public/learn/en/continental/index.html', import.meta.url) }],
  ['es/pocha', { relative: 'es/pocha/index.html', url: new URL('../public/learn/es/pocha/index.html', import.meta.url) }],
  ['en/pocha', { relative: 'en/pocha/index.html', url: new URL('../public/learn/en/pocha/index.html', import.meta.url) }],
])

async function readGuide(guide, { publicRoot, cwd, load }) {
  const candidates = publicRoot ? [join(publicRoot, guide.relative)] : [
    fileURLToPath(guide.url),
    join(cwd, 'client', 'public', 'learn', guide.relative),
    join(cwd, 'public', 'learn', guide.relative),
  ]
  let missing
  for (const path of new Set(candidates)) {
    try { return await load(path, 'utf8') }
    catch (error) { if (error?.code !== 'ENOENT') throw error; missing = error }
  }
  throw missing
}
export const BASELINE_EDITORIAL_CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://va.vercel-scripts.com https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://api.nrnplay.com wss://api.nrnplay.com https://conti-server.onrender.com wss://conti-server.onrender.com https://vitals.vercel-insights.com https://vitals.vercel-analytics.com; frame-src https://challenges.cloudflare.com; worker-src 'self' blob:; upgrade-insecure-requests"

function httpsUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port ? url : null } catch { return null }
}
export function editorialAdConfig(env, host) {
  if (env.EDITORIAL_ADS_ENABLED !== 'true' || env.EDITORIAL_ADS_APPROVED !== 'true' || env.EDITORIAL_ADS_CONSENT_READY !== 'true' || env.EDITORIAL_ADS_CSP_REVIEWED !== 'true' || env.EDITORIAL_ADS_CMP !== 'external') return null
  const client = env.EDITORIAL_ADS_CLIENT || ''
  const slot = env.EDITORIAL_ADS_SLOT || ''
  const cmp = httpsUrl(env.EDITORIAL_ADS_CMP_SCRIPT_URL)
  const hosts = (env.EDITORIAL_ADS_ALLOWED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  const origins = (env.EDITORIAL_ADS_RESOURCE_ORIGINS || '').split(',').map(value => httpsUrl(value.trim()))
  if (!/^ca-pub-\d{16}$/.test(client) || client === 'ca-pub-0000000000000000' || !/^\d{10}$/.test(slot) || /^0+$/.test(slot) || !cmp ||
    !hosts.length || hosts.some(value => !/^[a-z0-9.-]+$/.test(value)) || !hosts.includes(String(host || '').toLowerCase()) ||
    !origins.length || origins.some(value => !value || value.pathname !== '/' || value.search) || origins.length > 20) return null
  return { client, slot, cmpScript: cmp.href, origins: [...new Set([cmp.origin, ...origins.map(value => value.origin)])] }
}
export function editorialAdCsp(nonce, config) {
  const origins = config.origins.join(' ')
  return ["default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`, "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${origins}`, `connect-src 'self' https://api.nrnplay.com https://conti-server.onrender.com ${origins}`,
    `frame-src ${origins}`, "worker-src 'self' blob:", 'upgrade-insecure-requests'].join('; ')
}
const escape = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
export function renderEditorialGuide(html, config, nonce) {
  if (!config) return html
  const meta = `<meta name="nrn-guide-ad-enabled" content="true"><meta name="nrn-guide-ad-client" content="${config.client}"><meta name="nrn-guide-ad-slot" content="${config.slot}"><meta name="nrn-guide-ad-nonce" content="${nonce}">`
  const cmp = `<script nonce="${nonce}" defer src="${escape(config.cmpScript)}"></script>`
  return html.replace(/<script\b/gi, `<script nonce="${nonce}"`).replace(/<head\b[^>]*>/i, match => `${match}${meta}${cmp}`)
}

export function createEditorialHandler({ env = process.env, publicRoot, cwd = process.cwd(), load = readFile, nonce = () => randomBytes(16).toString('base64') } = {}) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('CDN-Cache-Control', 'no-store')
    response.setHeader('Vercel-CDN-Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    response.setHeader('Content-Security-Policy', BASELINE_EDITORIAL_CSP)
    if (!['GET', 'HEAD'].includes(request.method || 'GET')) { response.setHeader('Allow', 'GET, HEAD'); return response.status(405).end() }
    const { lang, game } = request.query || {}
    const file = typeof lang === 'string' && typeof game === 'string' ? guides.get(`${lang}/${game}`) : undefined
    if (!file) return response.status(404).end()
    try {
      const html = await readGuide(file, { publicRoot, cwd, load })
      const config = editorialAdConfig(env, request.headers?.host)
      const value = config ? nonce() : null
      if (config) response.setHeader('Content-Security-Policy', editorialAdCsp(value, config))
      response.setHeader('Content-Type', 'text/html; charset=utf-8')
      return response.status(200).end(request.method === 'HEAD' ? '' : renderEditorialGuide(html, config, value))
    } catch { return response.status(503).end() }
  }
}
export default createEditorialHandler()
