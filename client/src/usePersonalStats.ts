import { useCallback, useEffect, useRef, useState } from 'react'
import type { PersonalStats } from '@shared/personalStats'
import { isPersonalStats } from './lib/personalStats'
import { accountHeaders, isCookieAccountKey } from './lib/accountTransport'

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : 'https://api.nrnplay.com')
export function usePersonalStats(token: string | null, enabled: boolean, gameType: 'pocha' | 'continental') {
  const [result, setResult] = useState<{ token: string | null; gameType: 'pocha' | 'continental'; data: PersonalStats | null; loading: boolean; error: 'expired' | 'unavailable' | null } | null>(null)
  const sequence = useRef(0)
  const active = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    active.current?.abort()
    const requestId = ++sequence.current
    const contextData = (current: typeof result) => current?.token === token && current.gameType === gameType ? current.data : null
    if (!token) { setResult(null); return }
    if (!enabled) { setResult(current => ({ token, gameType, data: contextData(current), loading: false, error: null })); return }
    const controller = new AbortController()
    active.current = controller
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    setResult(current => ({ token, gameType, data: contextData(current), loading: true, error: null }))
    try {
      const portal = isCookieAccountKey(token)
      const response = await fetch(`${portal ? '' : API_URL}/api/membership/stats?gameType=${gameType}`, {
        headers: accountHeaders(token, portal), credentials: portal ? 'same-origin' : 'omit', cache: 'no-store', signal: controller.signal,
      })
      if (requestId !== sequence.current) return
      if (response.status === 401) { setResult({ token, gameType, data: null, loading: false, error: 'expired' }); return }
      if (!response.ok) throw new Error('Statistics unavailable')
      const value: unknown = await response.json()
      if (controller.signal.aborted) throw new Error('Statistics request aborted')
      if (!isPersonalStats(value)) throw new Error('Invalid statistics response')
      if (requestId === sequence.current && !controller.signal.aborted) setResult({ token, gameType, data: value, loading: false, error: null })
    } catch {
      if (requestId === sequence.current) setResult(current => ({ token, gameType, data: contextData(current), loading: false, error: 'unavailable' }))
    } finally {
      window.clearTimeout(timer)
      if (active.current === controller) active.current = null
    }
  }, [token, enabled, gameType])
  useEffect(() => {
    void refresh()
    return () => { ++sequence.current; active.current?.abort() }
  }, [refresh])
  const sameContext = result?.token === token && result?.gameType === gameType
  return { data: sameContext ? result.data : null, loading: enabled && !!token && (!sameContext || result.loading), error: sameContext ? result.error : null, refresh }
}
