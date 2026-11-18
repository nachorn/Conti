import assert from 'node:assert/strict'
import test from 'node:test'
import { BACKUP_HISTORY_BYTES, BACKUP_HISTORY_DAYS, planDailyBackupHistory } from '../src/operations/backupHistory.js'

const date = (day: string) => Date.parse(`${day}T00:00:00.000Z`)

test('daily history keeps the first complete pair and uses the UTC calendar', () => {
  assert.deepEqual(planDailyBackupHistory([], Date.parse('2026-10-31T21:30:00-04:00'), 800),
    { day: '2026-11-01', insert: true, deleteDays: [] })
  assert.deepEqual(planDailyBackupHistory([{ day: '2026-11-01', bytes: 800 }], date('2026-11-01') + 23 * 3600_000, 900),
    { day: '2026-11-01', insert: false, deleteDays: [] })
})

test('daily history prunes oldest dates by count and by total bytes, independent of query order', () => {
  const days = Array.from({ length: BACKUP_HISTORY_DAYS }, (_, i) => ({
    day: `2026-11-${String(i + 1).padStart(2, '0')}`, bytes: 1_000,
  })).reverse()
  assert.deepEqual(planDailyBackupHistory(days, date('2026-11-15'), 1_000).deleteDays, ['2026-11-01'])
  const half = BACKUP_HISTORY_BYTES / 2
  assert.deepEqual(planDailyBackupHistory([{ day: '2026-11-02', bytes: half }, { day: '2026-11-01', bytes: half }],
    date('2026-11-03'), half + 1).deleteDays, ['2026-11-01', '2026-11-02'])
})

test('the retention policy preserves verified history on a backward clock or oversized capture', () => {
  const existing = [{ day: '2026-11-03', bytes: 500 }]
  assert.deepEqual(planDailyBackupHistory(existing, date('2026-11-01'), 600),
    { day: '2026-11-01', insert: false, deleteDays: [] })
  assert.deepEqual(planDailyBackupHistory(existing, date('2026-11-04'), BACKUP_HISTORY_BYTES + 1),
    { day: '2026-11-04', insert: false, deleteDays: [] })
  assert.throws(() => planDailyBackupHistory([{ day: '2026-02-30', bytes: 5 }], date('2026-11-04'), 6), /metadata/)
  assert.throws(() => planDailyBackupHistory([...existing, ...existing], date('2026-11-04'), 6), /metadata/)
})
