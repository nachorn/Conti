import { useEffect, useRef, useState } from 'react'
import { createConnectionWarningDelay } from './lib/connectionFeedback'

/** Presentation only; transport readiness and disabled actions stay unchanged. */
export function useConnectionWarning(confirmedFailure: boolean, recovered: boolean, delayMs = 2500): boolean {
  const [visible, setVisible] = useState(false)
  const current = useRef<ReturnType<typeof createConnectionWarningDelay> | null>(null)
  useEffect(() => {
    setVisible(false)
    const warning = createConnectionWarningDelay(setVisible, delayMs)
    current.current = warning
    return () => { warning.dispose(); if (current.current === warning) current.current = null }
  }, [delayMs])
  useEffect(() => {
    current.current?.update(recovered ? false : confirmedFailure ? true : null)
  }, [confirmedFailure, recovered, delayMs])
  return !recovered && visible
}
