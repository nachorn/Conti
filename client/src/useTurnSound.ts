import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameState } from './types'
import { getTurnCue, TurnCueTracker } from './lib/turnCue'
import { playTurnPing } from './lib/turnSound'

const SOUND_KEY = 'conti-turn-sound-v1'

export function useTurnSound(state: GameState | null, playerId: string | null, connected: boolean) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) !== 'off' } catch { return true }
  })
  const [ready, setReady] = useState(0)
  const context = useRef<AudioContext | null>(null)
  const tracker = useRef(new TurnCueTracker())
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const unlock = () => {
    if (!enabledRef.current) return
    try {
      const Audio = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Audio) return
      const created = !context.current
      const audio = context.current ?? (context.current = new Audio())
      if (audio.state === 'running') { if (created) setReady(n => n + 1); return }
      void audio.resume().then(() => { if (context.current === audio && audio.state === 'running') setReady(n => n + 1) }).catch(() => {})
    } catch { /* A blocked audio device must never affect the game. */ }
  }

  useEffect(() => {
    // Unlock during a real tap/key press, before a later server turn arrives.
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      const audio = context.current
      context.current = null
      if (audio) void audio.close().catch(() => {})
    }
  }, [])

  const cue = useMemo(() => {
    const decision = getTurnCue(state, playerId)
    return decision ? { ...decision, dueAt: Date.now() + decision.delayMs } : null
  }, [state, playerId])

  useEffect(() => {
    if (!tracker.current.observe(cue, connected) || !cue) return
    const timer = window.setTimeout(() => {
      if (!enabled) { tracker.current.notified(cue); return }
      try {
        if (context.current && playTurnPing(context.current)) tracker.current.notified(cue)
      } catch { /* Keep the visual turn indicator usable without sound. */ }
    }, Math.max(0, cue.dueAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [cue, connected, enabled, ready])

  const toggle = () => {
    const next = !enabled
    enabledRef.current = next
    setEnabled(next)
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off') } catch { /* Session-only preference. */ }
    if (next) {
      if (cue && connected && cue.dueAt <= Date.now()) tracker.current.notified(cue)
      unlock()
      const audio = context.current
      if (audio) void audio.resume().then(() => { if (enabledRef.current) playTurnPing(audio) }).catch(() => {})
    }
  }
  return { enabled, toggle }
}
