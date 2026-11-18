import assert from 'node:assert/strict'
import test from 'node:test'
import { readPostgresHistoryPair, writePostgresCheckpoint } from '../src/operations/localPersistence.js'
import { FakeLocalPg, fixtureSecret, snapshotFixture } from './localPersistenceFixtures.js'

class HistoryPg extends FakeLocalPg {
  history = new Map<string, { bytes: number; game: unknown; membership: unknown }>()
  pendingHistory: typeof this.history | null = null
  pendingSnapshots: typeof this.pair | null = null
  override async query(text: string, values: unknown[] = []) {
    const tag = /local:([a-z-]+)/.exec(text)?.[1] ?? text
    if (!tag.startsWith('history-')) {
      if (text.startsWith('BEGIN')) { this.pendingHistory = structuredClone(this.history); this.pendingSnapshots = structuredClone(this.pair) }
      if (tag === 'write-game') this.pendingSnapshots!.game = JSON.parse(values[0] as string)
      if (tag === 'write-membership') this.pendingSnapshots!.membership = JSON.parse(values[0] as string)
      const result = await super.query(text, values)
      if (text === 'COMMIT') { this.history = this.pendingHistory!; this.pendingHistory = null }
      if (text === 'ROLLBACK') this.pendingHistory = null
      return result
    }
    this.queries.push({ text, values })
    if (this.failOn === tag) throw new Error('private-database-details')
    const history = this.pendingHistory!
    if (tag === 'history-schema') return { rows: [], rowCount: 0 }
    if (tag === 'history-metadata') return { rows: [...history].map(([day, value]) => ({ day, bytes: value.bytes })), rowCount: history.size }
    if (tag === 'history-measure') return { rows: [{ bytes: Buffer.byteLength(JSON.stringify(this.pendingSnapshots!.game)) + Buffer.byteLength(JSON.stringify(this.pendingSnapshots!.membership)) }], rowCount: 1 }
    if (tag === 'history-insert') {
      const day = values[0] as string
      assert.equal(values.length, 3, 'history insert must not retransmit either snapshot payload')
      if (!history.has(day)) history.set(day, { bytes: values[2] as number, game: structuredClone(this.pendingSnapshots!.game), membership: structuredClone(this.pendingSnapshots!.membership) })
      return { rows: [], rowCount: 1 }
    }
    if (tag === 'history-prune') { for (const day of values[0] as string[]) history.delete(day); return { rows: [], rowCount: 1 } }
    throw new Error('Unexpected test statement')
  }
}
const day = (n: number) => Date.UTC(2026, 10, n, 1)

test('hourly current backup and first UTC daily pair commit together without hourly duplication', async () => {
  const { pair } = snapshotFixture(), pg = new HistoryPg(pair)
  assert.equal(await writePostgresCheckpoint(pg.asClient(), pair, { history: true, capturedAtMs: day(1) }), 'written')
  const first = structuredClone(pg.history.get('2026-11-01'))
  const updated = structuredClone(pair); updated.membership.accounts[0].name = 'Updated fixture'
  assert.equal(await writePostgresCheckpoint(pg.asClient(), updated, { history: true, capturedAtMs: day(1) + 3600000 }), 'written')
  assert.deepEqual(pg.pair, updated)
  assert.equal(pg.history.size, 1); assert.deepEqual(pg.history.get('2026-11-01'), first)
  assert.equal(pg.queries.filter(q => q.text.includes('local:history-insert')).length, 1)
  assert.equal(pg.queries.filter(q => q.text.includes('local:history-measure')).length, 1)
})

test('daily retention bounds dates and a history failure rolls back current pair and history', async () => {
  const { pair } = snapshotFixture(), pg = new HistoryPg(pair)
  for (let n = 1; n <= 15; n++) await writePostgresCheckpoint(pg.asClient(), pair, { history: true, capturedAtMs: day(n) })
  assert.equal(pg.history.size, 14); assert(!pg.history.has('2026-11-01'))
  const before = structuredClone(pg.history), prior = structuredClone(pg.pair)
  const changed = structuredClone(pair); changed.membership.accounts[0].name = 'Must roll back'
  pg.failOn = 'history-insert'
  await assert.rejects(writePostgresCheckpoint(pg.asClient(), changed, { history: true, capturedAtMs: day(16) }), /postgres_checkpoint_failed/)
  assert.deepEqual(pg.history, before); assert.deepEqual(pg.pair, prior)
})

test('writer exclusion prevents all history work and backwards clock preserves existing anchors', async () => {
  const { pair } = snapshotFixture(), pg = new HistoryPg(pair)
  pg.locksAvailable = false
  assert.equal(await writePostgresCheckpoint(pg.asClient(), pair, { history: true, capturedAtMs: day(1) }), 'skipped-writer-active')
  assert(!pg.queries.some(q => q.text.includes('history-')))
  pg.locksAvailable = true
  await writePostgresCheckpoint(pg.asClient(), pair, { history: true, capturedAtMs: day(5) })
  await writePostgresCheckpoint(pg.asClient(), pair, { history: true, capturedAtMs: day(4) })
  assert.deepEqual([...pg.history.keys()], ['2026-11-05'])
})

test('a dated pair can be selected and validated in one bounded READ ONLY query without locks', async () => {
  const { pair } = snapshotFixture(), queries: { text: string; values?: unknown[] }[] = []
  const client = { async query(text: string, values?: unknown[]) {
    queries.push({ text, values })
    return { rows: text.includes('local:history-read') ? [{ game: JSON.stringify(pair.game), membership: JSON.stringify(pair.membership) }] : [] }
  } }
  assert.deepEqual(await readPostgresHistoryPair(client as any, '2026-11-18', fixtureSecret), pair)
  assert.match(queries[0].text, /READ ONLY/)
  assert.equal(queries.filter(q => q.text.includes('SELECT')).length, 1)
  assert.equal(queries.at(-1)!.text, 'COMMIT')
  assert(!queries.some(q => /INSERT|DELETE|CREATE|advisory/i.test(q.text)))
  assert.equal(queries[1].values![0], '2026-11-18')
  await assert.rejects(readPostgresHistoryPair(client as any, '2026-02-30', fixtureSecret), /invalid_history_day/)
})
