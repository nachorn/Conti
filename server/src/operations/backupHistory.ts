export const BACKUP_HISTORY_DAYS = 14
export const BACKUP_HISTORY_BYTES = 64 * 1024 * 1024

interface BackupHistoryEntry {
  day: string
  bytes: number
}

function isUtcDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const timestamp = Date.parse(`${day}T00:00:00.000Z`)
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day
}

/** Keep the first complete copy of each UTC day. Commit the whole plan atomically. */
export function planDailyBackupHistory(existing: readonly BackupHistoryEntry[], capturedAtMs: number, pairBytes: number) {
  if (!Number.isSafeInteger(capturedAtMs) || capturedAtMs < 0 || capturedAtMs > 8.64e15 ||
    !Number.isSafeInteger(pairBytes) || pairBytes < 1) throw new Error('Invalid backup capture metadata')

  const day = new Date(capturedAtMs).toISOString().slice(0, 10)
  const days = new Set(existing.map(entry => entry.day))
  if (!isUtcDay(day) || days.size !== existing.length || existing.some(entry =>
    !isUtcDay(entry.day) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > BACKUP_HISTORY_BYTES)) {
    throw new Error('Invalid backup history metadata')
  }
  // An older clock or an oversized capture must preserve every verified copy.
  if (pairBytes > BACKUP_HISTORY_BYTES || existing.some(entry => entry.day >= day)) {
    return { day, insert: false, deleteDays: [] as string[] }
  }

  const ordered = [...existing].sort((a, b) => a.day.localeCompare(b.day))
  let total = pairBytes + ordered.reduce((sum, entry) => sum + entry.bytes, 0)
  const deleteDays: string[] = []
  let keepFrom = 0
  while (ordered.length - keepFrom + 1 > BACKUP_HISTORY_DAYS || total > BACKUP_HISTORY_BYTES) {
    const removed = ordered[keepFrom++]
    total -= removed.bytes
    deleteDays.push(removed.day)
  }
  return { day, insert: true, deleteDays }
}
