import { useEffect, useState } from 'react'
import { LeagueRequestError, requestLeague, type LeagueError } from './lib/leagueApi'

export function useLeagueRead<T>(
  token: string | null,
  path: string | null,
  validate: (value: unknown) => value is T,
  body?: unknown,
) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{ token: string; path: string; body: unknown; attempt: number; data: T | null; error: LeagueError | null } | null>(null)
  useEffect(() => {
    if (!token || !path) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 15_000)
    let active = true
    void requestLeague(path, token, controller.signal, body).then(value => {
      if (!validate(value)) throw new LeagueRequestError('unavailable')
      if (active) setResult({ token, path, body, attempt, data: value, error: null })
    }).catch(failure => {
      if (!active) return
      const error = failure instanceof LeagueRequestError ? failure.code : 'unavailable'
      setResult({ token, path, body, attempt, data: null, error })
    }).finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [token, path, validate, body, attempt])
  const current = result?.token === token && result.path === path && result.body === body && result.attempt === attempt ? result : null
  return { data: current?.data ?? null, error: current?.error ?? null, loading: Boolean(token && path && !current), retry: () => setAttempt(value => value + 1) }
}
