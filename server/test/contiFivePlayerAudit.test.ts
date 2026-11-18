import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { Room } from '../src/room.js'
import { authenticate, cloneRecord, GameRepository, issueCredential, resumeRoom, type RoomRecord } from '../src/recovery.js'
import { beginPersonalMatch } from '../src/personalStats.js'
import type { SnapshotStore } from '../src/storage.js'
import type { Card, MeldType } from '../src/types.js'
import { driveContiGame } from './audit/contiFivePlayerDriver.js'
import { mockLeagueDeals } from './audit/leagueDeals.js'

class AuditMemoryStore implements SnapshotStore {
  value: unknown = null
  saves = 0
  async load() { return structuredClone(this.value) }
  async save(value: unknown) { this.value = structuredClone(value); this.saves++ }
  async close() {}
}
const wild = (card: Card) => card.rank === 0 || card.suit === 'joker'
function independentlyValidMeld(type: MeldType, cards: Card[]): boolean {
  const natural = cards.filter(card => !wild(card)), jokers = cards.length - natural.length
  if (natural.length <= jokers) return false
  if (type === 'trio') return cards.length >= 3 && natural.every(card => card.rank === natural[0].rank)
  if (cards.length < 4 || cards.length > 13 || !natural.every(card => card.suit === natural[0].suit)) return false
  for (const lowAce of [false, true]) {
    const ranks = natural.map(card => lowAce && card.rank === 14 ? 1 : card.rank)
    if (new Set(ranks).size !== ranks.length) continue
    for (let start = 1; start + cards.length - 1 <= 14; start++) {
      const window = Array.from({ length: cards.length }, (_, index) => start + index)
      const gaps = window.filter(rank => !ranks.includes(rank))
      if (ranks.every(rank => window.includes(rank)) && gaps.length === jokers && !gaps.some((rank, index) => index > 0 && rank === gaps[index - 1] + 1)) return true
    }
  }
  return false
}

test('three full seven-round Conti matches with five synthetic human accounts preserve cards, scores and league history across recovery', { timeout: 180_000 }, async t => {
  const deals = mockLeagueDeals(t.mock, 0x10f1e5)
  t.after(() => deals.restore())
  const store = new AuditMemoryStore()
  let repository = new GameRepository(store)
  await repository.load()
  const accounts = Array.from({ length: 5 }, (_, i) => ({ id: `synthetic-conti-account-${i + 1}`, name: `Synthetic ${i + 1}` }))
  const league = await repository.createLeague(accounts[0], { name: 'Five-player Conti audit', gameType: 'continental', minGames: 3 })
  for (const account of accounts.slice(1)) await repository.joinLeague(account, league.inviteCode, 'continental')
  const games: any[] = []
  let conservationChecks = 0, restorationChecks = 0, duplicateChecks = 0

  for (let game = 1; game <= 3; game++) {
    const roomId = String(1600 + game), room = new Room({ roomId, gameType: 'continental', maxPlayers: 5, deckCount: 2, discardOptionDelaySeconds: 0, secondsPerTurn: 0 })
    const credentials = Array.from({ length: 5 }, () => issueCredential(roomId))
    for (let i = 0; i < 5; i++) assert.equal(room.addPlayer(credentials[i].credential.playerId, accounts[i].name), true)
    assert.equal(room.startGame(), true)
    const record: RoomRecord = { room, sessions: credentials.map(item => item.session), updatedAt: Date.now(), paused: null, chat: [], leagueId: league.id }
    assert.ok(record.sessions.every(session => session.bot === undefined))
    beginPersonalMatch(record, Object.fromEntries(credentials.map((item, index) => [item.credential.playerId, accounts[index].id])))
    assert.equal(record.match?.eligible, true)
    await repository.commit(roomId, record)
    let physicalRound = 0, physicalCards = new Map<string, string>(), restarted = false
    const inspectCards = () => {
      const current = repository.get(roomId)!.room
      const cards = [...current.stock, ...current.discardPile, ...current.players.flatMap(player => player.hand), ...current.melds.flatMap(meld => meld.cards)]
      assert.equal(cards.length, 110); assert.equal(new Set(cards.map(card => card.id)).size, 110)
      if (physicalRound !== current.round) { physicalRound = current.round; physicalCards = new Map(cards.map(card => [card.id, JSON.stringify(card)])) }
      for (const card of cards) assert.equal(JSON.stringify(card), physicalCards.get(card.id), 'physical values survive every legal move and restore')
      for (const meld of current.melds) assert.equal(independentlyValidMeld(meld.type, meld.cards), true)
      assert.deepEqual(current.topDiscard, current.discardPile.at(-1) ?? null)
      conservationChecks++
    }
    inspectCards()
    const result = await driveContiGame({
      playerIds: credentials.map(item => item.credential.playerId),
      view: id => repository.get(roomId)!.room.getState(id),
      action: async (id, event, payload) => {
        const next = cloneRecord(repository.get(roomId)!), data = payload as any
        let result: { ok: boolean; error?: string }
        switch (event) {
          case 'draw': result = next.room.draw(id, data.fromDiscard); break
          case 'play_melds': result = next.room.playMelds(id, data.melds); break
          case 'add_to_meld': result = next.room.addToMeld(id, data.meldId, data.cards); break
          case 'discard': result = next.room.discard(id, data.cardId); break
          case 'take_discard': result = next.room.takeDiscard(id); break
          case 'pass_discard': result = next.room.passDiscard(id); break
          case 'swap_joker': result = next.room.swapJoker(id, data.meldId, data.cardId, data.jokerCardId); break
          case 'next_round': assert.equal(id, next.room.players[0].id); result = { ok: next.room.nextRound() }; break
          default: throw new Error('Unexpected audit action')
        }
        if (result.ok) await repository.commit(roomId, next)
        return result
      },
      afterAction: async step => {
        inspectCards()
        if (game === 1 && !restarted && step.actions >= 80 && repository.get(roomId)!.room.phase === 'playing') {
          const before = cloneRecord(repository.get(roomId)!)
          repository = new GameRepository(store); await repository.load()
          const restored = repository.get(roomId)!
          assert.deepEqual(restored.room.players.map(player => player.hand), before.room.players.map(player => player.hand))
          assert.deepEqual(restored.room.roundHistory, before.room.roundHistory)
          assert.deepEqual(restored.room.players.map(player => player.score), before.room.players.map(player => player.score))
          assert.deepEqual(restored.room.stock, before.room.stock)
          assert.deepEqual(restored.room.discardPile, before.room.discardPile)
          assert.deepEqual(restored.room.melds, before.room.melds)
          assert.equal(restored.room.currentPlayerIndex, before.room.currentPlayerIndex)
          assert.equal(restored.room.currentPlayerHasDrawn, before.room.currentPlayerHasDrawn)
          assert.equal(restored.room.discardOptionPlayerIndex, before.room.discardOptionPlayerIndex)
          assert.equal(restored.room.swappedJokerCardId, before.room.swappedJokerCardId)
          assert.equal(restored.room.swappedJokerPlayerId, before.room.swappedJokerPlayerId)
          for (const issued of credentials) {
            assert.equal(authenticate(restored, issued.credential), true)
            restored.room.setConnected(issued.credential.playerId, true)
          }
          resumeRoom(restored); await repository.commit(roomId, restored)
          assert.equal(restored.match?.id, before.match?.id); assert.equal(restored.match?.eligible, true)
          inspectCards(); restorationChecks++; restarted = true
        }
      },
    })
    const complete = repository.get(roomId)!
    assert.equal(complete.room.phase, 'game_end'); assert.equal(complete.room.roundHistory.length, 7)
    const detail = repository.getLeagueDetail(league.id, accounts[0].id)
    assert.ok(detail)
    assert.equal(detail.gameCount, game); assert.equal(detail.memberCount, 5)
    assert.equal(new Set(detail.standings.map(row => row.memberId)).size, 5)
    assert.equal(new Set(detail.recentGames.map(item => item.id)).size, game)
    assert.ok(detail.standings.every(row => row.played === game && row.provisional === (game < 3)))
    for (const account of accounts) assert.equal(repository.getPersonalStats(account.id, 50, 'continental').overall.played, game)
    const finished = detail.recentGames.find(item => item.id === complete.match!.id)!
    assert.equal(finished.players.length, 5)
    for (const player of finished.players) {
      const score = result.finalScores.find(item => item.name === player.name)!.score
      assert.equal(player.score, score)
      assert.equal(player.position, 1 + result.finalScores.filter(other => other.score < score).length)
    }
    await repository.commit(roomId, cloneRecord(complete))
    assert.equal(repository.getLeagueDetail(league.id, accounts[0].id)!.gameCount, game)
    duplicateChecks++
    games.push({ game, rounds: result.rounds.map(round => ({ round: round.round, winner: complete.room.players.find(player => player.id === round.winnerId)?.name ?? null,
      sameTurnWin: round.sameTurnWin, scores: Object.fromEntries(complete.room.players.map(player => [player.name, round.scores[player.id]])) })),
      actions: result.actions, eventCounts: result.eventCounts, repeatedHands: result.repeatedHands, privateViewChecks: result.privateViewChecks,
      scores: result.finalScores.map(({ name, score }) => ({ name, score })), engineRestore: restarted })
  }
  repository = new GameRepository(store); await repository.load()
  const final = repository.getLeagueDetail(league.id, accounts[0].id)
  assert.ok(final)
  assert.equal(final.gameCount, 3); assert.ok(final.standings.every(player => player.played === 3 && !player.provisional && player.rank !== null))
  assert.equal(final.recentGames.length, 3)
  const output = fileURLToPath(new URL('../../output/nrn-five-player-audit/', import.meta.url))
  await mkdir(output, { recursive: true })
  await writeFile(new URL('../../output/nrn-five-player-audit/conti-engine.json', import.meta.url), JSON.stringify({
    synthetic: true, scope: 'real Room and GameRepository; socket/auth coverage is separate', games,
    conservationChecks, restorationChecks, duplicateChecks, saves: store.saves,
    standings: final.standings.map(({ name, rank, rating, played, wins, draws, losses }) => ({ name, rank, rating, played, wins, draws, losses })),
  }, null, 2))
  console.log(JSON.stringify({ scope: 'conti-engine', games: games.length, rounds: games.reduce((sum, game) => sum + game.rounds.length, 0),
    actions: games.reduce((sum, game) => sum + game.actions, 0), conservationChecks, restorationChecks, duplicateChecks, output }))
})
