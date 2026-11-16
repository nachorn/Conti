/** A certified, separately installed CMP owns the UI and the TCF signals.
 * This adapter is deliberately disabled until that integration is configured.
 */
export interface AdConsentData {
  listenerId?: number
  cmpStatus?: string
  eventStatus?: string
  gdprApplies?: boolean
  tcString?: string
  purpose?: { consents?: Record<number, boolean> }
  vendor?: { consents?: Record<number, boolean> }
}
export interface AdTcfApi {
  (command: 'addEventListener', version: 2, callback: (data: AdConsentData, success: boolean) => void): void
  (command: 'removeEventListener', version: 2, callback: (success: boolean) => void, listenerId: number): void
}
declare global {
  interface Window {
    __tcfapi?: AdTcfApi
    /** Installed by the selected CMP integration; must reopen its real UI. */
    nrnAdPrivacy?: {
      openPreferences: () => void
      canRequestAds: () => boolean
      subscribeChanges: (listener: () => void) => () => void
    }
  }
}
export function adConsentConfigured(env = import.meta.env): boolean {
  return env?.VITE_ADS_CONSENT_READY === 'true' && env?.VITE_ADS_CMP === 'external'
}
/** Conservative personalized-ad gate. Unknown/loading/denied signals fail closed. */
export function consentAllowsAds(data: AdConsentData, success: boolean): boolean {
  if (!data || !success || data.cmpStatus !== 'loaded' || !['tcloaded', 'useractioncomplete'].includes(data.eventStatus ?? '')) return false
  // Never override an explicit refusal just because the CMP reports non-GDPR.
  if (data.vendor?.consents?.[755] === false || [1, 3, 4].some(id => data.purpose?.consents?.[id] === false)) return false
  if (data.gdprApplies === false) return true
  return data.gdprApplies === true && typeof data.tcString === 'string' && data.tcString.length > 0 &&
    data.vendor?.consents?.[755] === true && [1, 3, 4].every(id => data.purpose?.consents?.[id] === true)
}
export function canOpenAdPreferences(): boolean {
  return adConsentConfigured() && typeof window !== 'undefined' && typeof window.nrnAdPrivacy?.openPreferences === 'function'
}
export function openAdPreferences(): boolean {
  if (!canOpenAdPreferences()) return false
  try { window.nrnAdPrivacy!.openPreferences(); return true } catch { return false }
}
export interface AdConsentSession { allowed: () => boolean; close: () => void }
interface AdConsentEnvironment {
  configured: boolean; api?: AdTcfApi; preferencesAvailable: boolean; siteAllowsAds: () => boolean
  subscribeChanges?: (listener: () => void) => () => void
}

/** Keep listening through playback so a revocation pauses subsequent requests. */
export async function acquireAdConsent(onChange: (allowed: boolean) => void, signal?: AbortSignal, environment: AdConsentEnvironment = {
  configured: adConsentConfigured(), api: typeof window === 'undefined' ? undefined : window.__tcfapi,
  preferencesAvailable: canOpenAdPreferences(),
  siteAllowsAds: () => typeof window !== 'undefined' && window.nrnAdPrivacy?.canRequestAds?.() === true,
  subscribeChanges: typeof window !== 'undefined' && typeof window.nrnAdPrivacy?.subscribeChanges === 'function'
    ? listener => window.nrnAdPrivacy!.subscribeChanges(listener) : undefined,
}): Promise<AdConsentSession | null> {
  const subscribeChanges = environment.subscribeChanges
  if (!environment.configured || !environment.api || !environment.preferencesAvailable || !subscribeChanges || signal?.aborted) return null
  const api = environment.api
  return new Promise(resolve => {
    let allowed = false
    let closed = false
    let settled = false
    let listenerId: number | undefined
    let unsubscribeChanges: (() => void) | undefined
    const allowedNow = () => {
      try { return allowed && !closed && environment.siteAllowsAds() === true } catch { return false }
    }
    const close = () => {
      if (closed) return
      closed = true
      allowed = false
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      try { unsubscribeChanges?.() } catch { /* No more requests are permitted. */ }
      if (listenerId !== undefined) { try { api('removeEventListener', 2, () => {}, listenerId) } catch { /* Fail closed. */ } }
    }
    const finish = (session: AdConsentSession | null) => { if (!settled) { settled = true; clearTimeout(timer); resolve(session) } }
    const abort = () => { onChange(false); close(); finish(null) }
    const timer = setTimeout(abort, 8_000)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      unsubscribeChanges = subscribeChanges(() => { if (!closed) onChange(allowedNow()) })
      if (typeof unsubscribeChanges !== 'function') throw new Error('Privacy change subscription unavailable')
      api('addEventListener', 2, (data, success) => {
        listenerId = data?.listenerId
        if (closed) {
          if (listenerId !== undefined) { try { api('removeEventListener', 2, () => {}, listenerId) } catch { /* No requests allowed. */ } }
          return
        }
        // TCF alone does not encode every regional opt-out. The installed CMP
        // must explicitly confirm its complete, applicable advertising decision.
        allowed = consentAllowsAds(data, success)
        const permission = allowedNow()
        onChange(permission)
        if (!settled && (!data || data.cmpStatus === 'loaded' || !success || data.cmpStatus === 'error')) {
          if (permission) finish({ allowed: allowedNow, close })
          else { close(); finish(null) }
        }
      })
    } catch { abort() }
  })
}
