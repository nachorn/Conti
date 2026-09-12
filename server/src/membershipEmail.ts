import { randomUUID } from 'node:crypto'

type Language = 'en' | 'es'
type EmailSender = (email: string, code: string, lang: Language) => Promise<void>
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const unavailable = () => new Error('Email unavailable')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const hasControls = (value: string) => /[\u0000-\u001f\u007f]/.test(value)

/** Only a single ASCII mailbox is accepted in MIME address headers. */
function mailbox(value: string): boolean {
  if (value.length > 254 || hasControls(value)) return false
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  return local.length > 0 && local.length <= 64 && !local.startsWith('.') && !local.endsWith('.') && !local.includes('..') &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local) && domain.includes('.') &&
    domain.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
}

function resendFrom(value: string): boolean {
  if (hasControls(value) || value.length > 400) return false
  if (mailbox(value)) return true
  const named = /^([^<>]+) <([^<>]+)>$/.exec(value)
  return !!named && named[1].trim().length > 0 && mailbox(named[2])
}

function message(code: string, lang: Language) {
  return {
    subject: lang === 'es' ? 'Tu código de acceso · Continental y Pocha' : 'Your sign-in code · Continental & Pocha',
    text: lang === 'es'
      ? `Tu código de acceso es ${code}. Caduca en 10 minutos y solo se puede usar una vez.\n\nSi no lo has solicitado, puedes ignorar este correo.`
      : `Your sign-in code is ${code}. It expires in 10 minutes and can only be used once.\n\nIf you did not request this, you can ignore this email.`,
  }
}

function rawMessage(from: string, to: string, code: string, lang: Language, now: number): string {
  const { subject, text } = message(code, lang)
  const body = Buffer.from(text.replace(/\n/g, '\r\n'), 'utf8').toString('base64').match(/.{1,76}/g)!.join('\r\n')
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Date: ${new Date(now).toUTCString()}`,
    `Message-ID: <${randomUUID()}@${from.split('@')[1]}>`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ].join('\r\n')
  return Buffer.from(mime, 'utf8').toString('base64url')
}

/** Credentials belong only on the server; authorize the refresh token for gmail.send alone. */
export function createMembershipEmailSender(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
  now: () => number = Date.now,
): EmailSender | undefined {
  const provider = env.MEMBERSHIP_EMAIL_PROVIDER?.trim().toLowerCase()
  let deliver: EmailSender
  if (provider === 'gmail') {
    const clientId = env.GOOGLE_CLIENT_ID?.trim()
    const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
    const refreshToken = env.GOOGLE_REFRESH_TOKEN?.trim()
    const from = env.GMAIL_SENDER
    if (!clientId || !clientSecret || !refreshToken || !from || !mailbox(from)) return undefined
    let cached: { value: string; validUntil: number } | undefined
    let refreshing: Promise<string> | undefined
    const accessToken = async (): Promise<string> => {
      if (cached && now() < cached.validUntil) return cached.value
      refreshing ??= (async () => {
        const startedAt = now()
        const response = await request(TOKEN_URL, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
        })
        if (!response.ok) throw unavailable()
        const token: unknown = await response.json()
        if (!object(token) || typeof token.access_token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(token.access_token) ||
            token.token_type !== 'Bearer' || typeof token.expires_in !== 'number' || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 86_400 ||
            (token.scope !== undefined && token.scope !== GMAIL_SEND_SCOPE)) throw unavailable()
        cached = { value: token.access_token, validUntil: startedAt + Math.max(0, token.expires_in * 1000 - 60_000) }
        return token.access_token
      })().finally(() => { refreshing = undefined })
      return refreshing
    }
    deliver = async (email, code, lang) => {
      const raw = rawMessage(from, email, code, lang, now())
      const token = await accessToken()
      const response = await request(SEND_URL, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ raw }),
      })
      // Never automatically retry a send: a timeout may occur after Gmail accepted it.
      if (!response.ok) {
        if (response.status === 401 && cached?.value === token) cached = undefined
        throw unavailable()
      }
      const result: unknown = await response.json()
      if (!object(result) || typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(result.id)) throw unavailable()
    }
  } else if (!provider || provider === 'resend') {
    const key = env.RESEND_API_KEY?.trim()
    const from = env.MEMBERSHIP_EMAIL_FROM
    if (!key || !from || !resendFrom(from)) return undefined
    deliver = async (email, code, lang) => {
      const response = await request('https://api.resend.com/emails', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
        body: JSON.stringify({ from, to: [email], ...message(code, lang) }),
      })
      if (!response.ok) throw unavailable()
    }
  } else return undefined
  return async (email, code, lang) => {
    try {
      if (typeof email !== 'string' || !mailbox(email) || typeof code !== 'string' || !/^\d{6}$/.test(code) || (lang !== 'en' && lang !== 'es')) throw unavailable()
      await deliver(email, code, lang)
    } catch { throw unavailable() }
  }
}
