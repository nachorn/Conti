// First-party controller only. Default-off pages return before storage, CMP or network access.
export const GUIDE_MEMBERSHIP_KEY = 'conti-membership-session'
export function guideConsentAllowsAds(data, success, bridgeAllows) {
  if (!bridgeAllows || !data || !success || data.cmpStatus !== 'loaded' || !['tcloaded', 'useractioncomplete'].includes(data.eventStatus)) return false
  if (data.vendor?.consents?.[755] === false || [1, 3, 4].some(id => data.purpose?.consents?.[id] === false)) return false
  if (data.gdprApplies === false) return true
  return data.gdprApplies === true && typeof data.tcString === 'string' && data.tcString.length > 0 && data.vendor?.consents?.[755] === true && [1, 3, 4].every(id => data.purpose?.consents?.[id] === true)
}

/** A stored premium flag is never used. Unresolved, malformed or failed sessions suppress ads. */
export async function verifyGuideVisitor({ storage, fetch, now = Date.now, signal }) {
  try {
    const raw = storage.getItem(GUIDE_MEMBERSHIP_KEY)
    if (raw === null) return true
    if (raw.length > 2048) return false
    const saved = JSON.parse(raw)
    if (!saved || typeof saved.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(saved.token) || !Number.isSafeInteger(saved.expiresAt) || saved.expiresAt <= now() || saved.expiresAt > now() + 31 * 86400000) return false
    const response = await fetch('https://api.nrnplay.com/api/membership/me', {
      method: 'GET', headers: { Authorization: `Bearer ${saved.token}` }, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal,
    })
    if (!response.ok) return false
    const value = await response.json()
    return !!(value?.account && typeof value.account.id === 'string' && value.account.adFree === false && Number.isSafeInteger(value.expiresAt) && value.expiresAt > now() && storage.getItem(GUIDE_MEMBERSHIP_KEY) === raw)
  } catch { return false }
}

export function startGuideAdvertising(win = window, doc = document) {
  const meta = name => doc.querySelector(`meta[name="${name}"]`)?.content
  if (meta('nrn-guide-ad-enabled') !== 'true') return () => {}
  const client = meta('nrn-guide-ad-client') || '', slot = meta('nrn-guide-ad-slot') || '', nonce = meta('nrn-guide-ad-nonce') || ''
  const bridge = win.nrnAdPrivacy, tcf = win.__tcfapi
  const area = doc.querySelector('[data-nrn-guide-ad]'), unit = area?.querySelector('ins'), preferences = area?.querySelector('button')
  if (!/^ca-pub-\d{16}$/.test(client) || client === 'ca-pub-0000000000000000' || !/^\d{10}$/.test(slot) || /^0+$/.test(slot) ||
    !/^[A-Za-z0-9+/]{22}==$/.test(nonce) || doc.querySelector('script[src="/ads/guide.js"]')?.nonce !== nonce ||
    !area || !unit || !preferences || typeof tcf !== 'function' || typeof bridge?.openPreferences !== 'function' || typeof bridge?.canRequestAds !== 'function' || typeof bridge?.subscribeChanges !== 'function') return () => {}

  let closed = false, attempted = false, permitted = false, queued = false, listenerId, unsubscribe, observer
  let regionalReady = false
  const controller = new AbortController()
  const pause = () => { if (win.adsbygoogle) win.adsbygoogle.pauseAdRequests = 1; area.hidden = true }
  const allowed = () => {
    try { return !closed && regionalReady && permitted && bridge === win.nrnAdPrivacy && tcf === win.__tcfapi && bridge.canRequestAds() === true } catch { return false }
  }
  const close = () => {
    if (closed) return
    closed = true; controller.abort(); pause(); observer?.disconnect()
    try { unsubscribe?.() } catch { /* Remain suppressed. */ }
    if (listenerId !== undefined) { try { tcf('removeEventListener', 2, () => {}, listenerId) } catch { /* Remain suppressed. */ } }
    win.removeEventListener('pagehide', close); win.removeEventListener('storage', accountChanged); win.removeEventListener('focus', revalidate)
    preferences.removeEventListener('click', openPreferences)
  }
  const accountChanged = event => { if (event.key === null || event.key === GUIDE_MEMBERSHIP_KEY) close() }
  const freeVisitor = () => {
    try { return verifyGuideVisitor({ storage: win.localStorage, fetch: win.fetch.bind(win), signal: controller.signal }) } catch { return Promise.resolve(false) }
  }
  const revalidate = async () => {
    if (!queued || closed) return
    pause()
    if (allowed() && await freeVisitor() && allowed()) { win.adsbygoogle.pauseAdRequests = 0; area.hidden = false } else close()
  }
  const openPreferences = () => { try { bridge.openPreferences() } catch { pause() } }
  async function request() {
    if (!allowed() || attempted || !win.navigator.onLine) return
    attempted = true
    if (!await freeVisitor() || !allowed() || !win.navigator.onLine) { close(); return }
    // Only a real positive CMP decision AND a fresh non-premium account check reach this point.
    const script = doc.createElement('script')
    script.async = true; script.crossOrigin = 'anonymous'; script.nonce = nonce
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`
    const loaded = await new Promise(resolve => {
      let done = false
      const finish = success => { if (done) return; done = true; win.clearTimeout(timer); script.onload = null; script.onerror = null; if (!success) script.remove(); resolve(success) }
      const timer = win.setTimeout(() => finish(false), 15000)
      script.onload = () => finish(true); script.onerror = () => finish(false)
      controller.signal.addEventListener('abort', () => finish(false), { once: true })
      const queue = win.adsbygoogle || []; queue.pauseAdRequests = 1; win.adsbygoogle = queue
      try { doc.head.append(script) } catch { finish(false) }
    })
    if (!loaded || !allowed() || !await freeVisitor() || !allowed()) { close(); return }
    unit.dataset.adClient = client; unit.dataset.adSlot = slot
    area.hidden = false
    try {
      win.adsbygoogle.pauseAdRequests = 0
      win.adsbygoogle.push({}); queued = true
      observer = new MutationObserver(() => { if (unit.dataset.adStatus === 'unfilled') close() })
      observer.observe(unit, { attributes: true, attributeFilter: ['data-ad-status'] })
    } catch { close() }
  }
  function changed() {
    if (!allowed()) { pause(); if (attempted) close() }
    else void request()
  }
  try {
    unsubscribe = bridge.subscribeChanges(changed)
    if (typeof unsubscribe !== 'function') { close(); return close }
    regionalReady = true
    preferences.addEventListener('click', openPreferences)
    win.addEventListener('pagehide', close, { once: true }); win.addEventListener('storage', accountChanged); win.addEventListener('focus', revalidate)
    tcf('addEventListener', 2, (data, success) => {
      if (closed) {
        if (data?.listenerId !== undefined) { try { tcf('removeEventListener', 2, () => {}, data.listenerId) } catch { /* No ad permitted. */ } }
        return
      }
      listenerId = data?.listenerId
      permitted = guideConsentAllowsAds(data, success, true)
      changed()
    })
  } catch { close() }
  return close
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') startGuideAdvertising()
