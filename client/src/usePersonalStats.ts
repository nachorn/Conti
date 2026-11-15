import { useCallback, useEffect, useRef, useState } from 'react'
import type { PersonalStats } from '@shared/personalStats'
import { isPersonalStats } from './lib/personalStats'

const API_URL = import.meta.env.VITE_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:3001' : '')
export function usePersonalStats(token: string | null, enabled = true) {
  const [result, setResult] = useState<{ token: string; data: PersonalStats } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<'expired' | 'unavailable' | null>(null)
  const sequence = useRef(0)
  const active = useRef<AbortController | null>(null)
  const refresh = useCallback(async () => {
    active.current?.abort()
    const requestId = ++sequence.current
    if (!token) { setResult(null); setError(null); setLoading(false); return }
    if (!enabled) { setLoading(false); return }
    const controller = new AbortController()
    active.current = controller
    const timer = window.setTimeout(() => controller.abort(), 15_000)
    setLoading(true); setError(null)
    try {
      const response = await fetch(`${API_URL}/api/membership/stats`, {
        headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal,
      })
      if (requestId !== sequence.current) return
      if (response.status === 401) { setResult(null); setError('expired'); return }
      if (!response.ok) throw new Error('Statistics unavailable')
      const value: unknown = await response.json()
      if (!isPersonalStats(value)) throw new Error('Invalid statistics response')
      if (requestId === sequence.current) setResult({ token, data: value })
    } catch {
      if (requestId === sequence.current) setError('unavailable')
    } finally {
      window.clearTimeout(timer)
      if (requestId === sequence.current) setLoading(false)
    }
  }, [token, enabled])
  useEffect(() => {
    void refresh()
    return () => { ++sequence.current; active.current?.abort() }
  }, [refresh])
  return { data: result?.token === token ? result.data : null, loading, error, refresh }
}
