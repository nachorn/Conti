import type { AdOutcome } from '@shared/adGate'

export interface AdPlacementInfo { breakStatus?: string; breakFormat?: string }

/** Only actual display and closure callbacks can mark an interstitial complete. */
export function placementOutcome(info: AdPlacementInfo, shown: boolean, closed: boolean): AdOutcome {
  if (info.breakFormat === 'interstitial' && shown && closed) {
    if (info.breakStatus === 'viewed') return 'viewed'
    if (info.breakStatus === 'dismissed') return 'dismissed'
  }
  return info.breakStatus === 'error' ? 'error' : 'unavailable'
}

declare global {
  interface Window { adsbygoogle?: { push: (options: Record<string, unknown>) => unknown } }
}
let sdk: { publisherId: string; ready: Promise<void> } | null = null
let activePlacement = false

/** Google H5 production SDK; disabled rooms never call or download this. */
export function prepareAdProvider(publisherId: string): Promise<void> {
  if (!/^ca-pub-\d{16}$/.test(publisherId)) return Promise.reject(new Error('Ad provider unavailable'))
  if (sdk?.publisherId === publisherId) return sdk.ready
  if (sdk) return Promise.reject(new Error('Ad provider configuration changed; reload required'))
  const ready = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    let finished = false
    const timer = window.setTimeout(() => finish(false), 15_000)
    const finish = (success: boolean) => {
      if (finished) return
      finished = true
      window.clearTimeout(timer)
      if (success) resolve()
      else { script.remove(); reject(new Error('Ad provider unavailable')) }
    }
    const queue = window.adsbygoogle || [] as Record<string, unknown>[]
    window.adsbygoogle = queue
    queue.push({ sound: 'off', preloadAdBreaks: 'on', onReady: () => finish(true) })
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.adClient = publisherId
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(publisherId)}`
    script.onerror = () => finish(false)
    document.head.append(script)
  })
  sdk = { publisherId, ready }
  void ready.catch(() => { if (sdk?.ready === ready) sdk = null })
  return ready
}

export async function playStartAd(publisherId: string, onPlaying: (playing: boolean) => void, signal?: AbortSignal): Promise<AdOutcome> {
  if (activePlacement) return 'error'
  activePlacement = true
  try {
    await prepareAdProvider(publisherId)
    if (signal?.aborted) return 'unavailable'
    return await new Promise<AdOutcome>(resolve => {
      let shown = false
      let closed = false
      let finished = false
      let timer = window.setTimeout(() => finish('unavailable'), 30_000)
      const finish = (outcome: AdOutcome) => {
        if (finished) return
        finished = true
        window.clearTimeout(timer)
        onPlaying(false)
        resolve(outcome)
      }
      try {
        window.adsbygoogle?.push({
          type: 'start', name: 'table-before-game',
          beforeAd: () => {
            if (finished) return
            shown = true
            window.clearTimeout(timer)
            timer = window.setTimeout(() => finish('error'), 4 * 60_000)
            onPlaying(true)
          },
          afterAd: () => { closed = true },
          adBreakDone: (info: AdPlacementInfo) => finish(placementOutcome(info, shown, closed)),
        })
      } catch { finish('error') }
    })
  } catch { return 'unavailable' }
  finally { activePlacement = false; onPlaying(false) }
}
