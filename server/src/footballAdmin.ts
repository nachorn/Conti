import { createHmac } from 'node:crypto'
import type { FootballAdminReport, AdminOverview } from '../../shared/platformAdmin.js'

const REPORT_URL = 'https://football.nrnplay.com/api/admin-report'
const MAX_BYTES = 64 * 1024
const CACHE_MS = 5 * 60_000
type FootballState = AdminOverview['football']
export interface FootballAdminClient { read(): Promise<FootballState> }

/** Only this scoped derivative is sent to Football; never the master admin key. */
export function deriveFootballReportKey(dashboardKey?: string): string | null {
  const key = dashboardKey?.trim()
  return key && key.length >= 32 && key.length <= 256
    ? createHmac('sha256', key).update('nrnplay:football-admin-report:v1').digest('base64url') : null
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
const text = (value: unknown, max = 160): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)

/** Explicitly rebuild a bounded report; unknown fields can never enter the admin response. */
export function parseFootballAdminReport(value: unknown): FootballAdminReport | null {
  if (!object(value) || !count(value.generatedAt) || !count(value.since) || !count(value.until) || value.since > value.until ||
      !object(value.totals) || Object.keys(value.totals).length > 64 ||
      !Array.isArray(value.daily) || value.daily.length > 366 || !Array.isArray(value.screens) || value.screens.length > 100 ||
      !Array.isArray(value.devices) || value.devices.length > 100 || !Array.isArray(value.errors) || value.errors.length > 100) return null
  const totals: Record<string, number> = {}
  for (const [key, number] of Object.entries(value.totals)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || ['constructor', 'prototype', '__proto__'].includes(key) || !count(number)) return null
    totals[key] = number
  }
  const daily: FootballAdminReport['daily'] = [], screens: FootballAdminReport['screens'] = [], devices: FootballAdminReport['devices'] = [], errors: FootballAdminReport['errors'] = []
  for (const row of value.daily) {
    if (!object(row) || typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !count(row.events) || !count(row.careersCreated) || !count(row.firstMatchesCompleted)) return null
    const stamp = Date.parse(`${row.date}T00:00:00Z`)
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== row.date) return null
    daily.push({ date: row.date, events: row.events, careersCreated: row.careersCreated, firstMatchesCompleted: row.firstMatchesCompleted })
  }
  for (const row of value.screens) {
    if (!object(row) || !text(row.screen) || !count(row.count)) return null
    screens.push({ screen: row.screen, count: row.count })
  }
  for (const row of value.devices) {
    if (!object(row) || !text(row.device) || !count(row.count)) return null
    devices.push({ device: row.device, count: row.count })
  }
  for (const row of value.errors) {
    if (!object(row) || !text(row.name) || !text(row.source) || !count(row.count)) return null
    errors.push({ name: row.name, source: row.source, count: row.count })
  }
  return { generatedAt: value.generatedAt, since: value.since, until: value.until, totals, daily, screens, devices, errors }
}

export function createFootballAdminClient(options: { dashboardKey?: string; request?: typeof fetch; now?: () => number; timeoutMs?: number } = {}): FootballAdminClient {
  const key = deriveFootballReportKey(options.dashboardKey), request = options.request ?? fetch, now = options.now ?? Date.now
  let report: FootballAdminReport | null = null, available = false, nextAttempt = -Infinity, inflight: Promise<void> | null = null
  const state = (): FootballState => ({ available, stale: !available && report !== null, report: report === null ? null : structuredClone(report) })
  const refresh = async () => {
    const controller = new AbortController()
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: NodeJS.Timeout | undefined
    try {
      const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
        controller.abort(); void reader?.cancel().catch(() => undefined); reject(new Error('Football report unavailable'))
      }, options.timeoutMs ?? 4000) })
      const incoming = (async () => {
        const response = await request(REPORT_URL, { method: 'GET', redirect: 'error', cache: 'no-store',
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: controller.signal })
        if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json') || !response.body) throw new Error('Football report unavailable')
        const size = response.headers.get('content-length')
        if (size !== null && (!/^\d+$/.test(size) || Number(size) > MAX_BYTES)) throw new Error('Football report unavailable')
        reader = response.body.getReader()
        const chunks: Uint8Array[] = []; let length = 0
        while (true) {
          const item = await reader.read(); if (item.done) break
          length += item.value.byteLength
          if (length > MAX_BYTES) throw new Error('Football report unavailable')
          chunks.push(item.value)
        }
        const parsed = parseFootballAdminReport(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        if (!parsed) throw new Error('Football report unavailable')
        return parsed
      })()
      report = await Promise.race([incoming, deadline]); available = true
    } catch { available = false }
    finally {
      if (timer) clearTimeout(timer)
      controller.abort()
      void reader?.cancel().catch(() => undefined)
      nextAttempt = now() + CACHE_MS
    }
  }
  return { async read() {
    if (!key) return state()
    if (!inflight && now() >= nextAttempt) {
      inflight = refresh().finally(() => { inflight = null })
    }
    if (inflight) await inflight
    return state()
  } }
}
