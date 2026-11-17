import type { ConnectionStatus } from '../useSocket'

/** Ownership, rejected recovery and saving failures bypass normal handshakes. */
export function criticalConnectionState(status: ConnectionStatus, recoveryRoomId: string | null, storageAvailable: boolean, recoveryRejected = false): boolean {
  return status === 'paused' || status === 'replaced' ||
    (recoveryRoomId !== null && (recoveryRejected || (status === 'connected' && !storageAvailable)))
}

export interface NoticeClock {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}
const clock: NoticeClock = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** A failure must stay continuous; recovery cancels even an already queued tick. */
export function createConnectionWarningDelay(onChange: (visible: boolean) => void, delayMs = 2500, timers: NoticeClock = clock) {
  let failed = false, visible = false, disposed = false, generation = 0, pending: unknown
  const publish = (next: boolean) => { if (visible !== next) { visible = next; onChange(next) } }
  const clear = () => { if (pending !== undefined) timers.clearTimeout(pending); pending = undefined }
  return {
    update(nextFailed: boolean | null) {
      // Unknown/trying again neither invents a first failure nor clears one.
      if (disposed || nextFailed === null || nextFailed === failed) return
      failed = nextFailed
      const current = ++generation
      clear()
      if (!failed) { publish(false); return }
      pending = timers.setTimeout(() => {
        if (disposed || generation !== current || !failed) return
        pending = undefined; publish(true)
      }, delayMs)
    },
    dispose() { disposed = true; generation++; clear() },
  }
}
