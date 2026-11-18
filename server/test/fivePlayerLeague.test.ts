import assert from 'node:assert/strict'
import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import test from 'node:test'
import { io, type Socket } from 'socket.io-client'
import { drivePochaGame } from './audit/pochaFivePlayerDriver.js'
import { driveContiGame } from './audit/contiFivePlayerDriver.js'
import { initialLeagueRating, updateLeagueRatings, leagueRatingPoints } from '../src/leagueRating.js'
import type { GameState } from '../src/types.js'

test('five human accounts play three real league games per game through Socket.IO, persist and replay ratings', { timeout: 180_000 }, async () => {
  const started = performance.now()
  const directory = await mkdtemp(join(tmpdir(), 'nrn-five-human-'))
  const games = join(directory, 'games.json'), accounts = join(directory, 'accounts.json')
  let child: ChildProcess, requestId = 0, base = '', now = Date.now()
  const dealSeed = 0x20261117
  let dealState = dealSeed
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()
  const sockets: Socket[] = []
  const request = (command: string, payload: unknown = {}) => new Promise<any>((resolve, reject) => {
    const id = ++requestId
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Audit child timed out: ${command}`)) }, 15_000)
    pending.set(id, { resolve, reject, timer }); child.send({ id, command, payload })
  })
  const start = async () => {
    child = fork(fileURLToPath(new URL('./audit/fivePlayerServer.ts', import.meta.url)), {
      execArgv: ['--import', new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'comspec', 'pathext', 'tz'].includes(key.toLowerCase()))),
    })
    const runningChild = child
    child.on('message', (message: any) => {
      const item = pending.get(message.id); if (!item) return
      clearTimeout(item.timer); pending.delete(message.id)
      if (message.error) item.reject(new Error(message.error)); else item.resolve(message.value)
    })
    child.stderr?.on('data', () => { /* Private fixture diagnostics are never copied into the receipt. */ })
    child.on('exit', (code) => { if (child !== runningChild) return; for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error(`Audit child exited (${code})`)) }; pending.clear() })
    const ready = await request('start', { games, accounts, now, dealState })
    base = `http://127.0.0.1:${ready.port}`
  }
  const stop = async () => {
    const exited = once(child, 'exit')
    const result = await request('stop')
    now = result.now
    dealState = result.dealState
    await exited
  }
  const api = async (path: string, token?: string, body?: unknown) => {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    const result: any = await response.json()
    assert(response.ok, `Local HTTP ${path} rejected: ${result.error ?? response.status}`)
    return result
  }
  const waitEvent = (socket: Socket, event: string) => new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, done); reject(new Error(`Socket ${event} timed out`)) }, 10_000)
    const done = (value: any) => { clearTimeout(timer); resolve(value) }; socket.once(event, done)
  })
  const connect = async (token: string, resume?: any) => {
    const socket = io(base, { autoConnect: false, transports: ['websocket'], reconnection: false,
      auth: { membershipToken: token, ...(resume ? { resume } : {}) } })
    sockets.push(socket)
    const ready = waitEvent(socket, resume ? 'joined' : 'connect'); socket.connect(); const joined = await ready
    return { socket, joined }
  }
  const receipt: any = { syntheticHumans: 5, dealSeed, protocol: 'HTTP membership/leagues + Socket.IO legal actions',
    actualBots: 0, injectedResults: 0, games: {}, checks: {} }
  const receiptDirectory = fileURLToPath(new URL('../../output/nrn-five-player-audit/', import.meta.url))
  const saveReceipt = async (completed = false) => {
    await mkdir(receiptDirectory, { recursive: true })
    // A failed/random partial audit must never replace the latest fully passed receipt.
    await writeFile(join(receiptDirectory, completed ? 'five-human-leagues.json' : 'five-human-leagues.progress.json'), JSON.stringify({ completed, ...receipt }, null, 2) + '\n')
  }
  try {
    await start()
    const humans: any[] = []
    for (let i = 0; i < 5; i++) {
      const email = `human${i + 1}@example.test`
      const registration = await api('/api/membership/register', undefined, { name: `Humano ${i + 1}`, email,
        password: 'Synthetic audit password phrase 2026!', lang: 'es' })
      const code = await request('code', { email })
      humans.push(await api('/api/membership/verify', undefined, { email, code, purpose: 'register', registrationToken: registration.registrationToken }))
    }
    assert.equal(new Set(humans.map(h => h.account.id)).size, 5)
    const leagues: any[] = []
    const allCredentials: any[] = []
    for (const gameType of ['pocha', 'continental'] as const) {
      const league = await api('/api/leagues', humans[0].token, { name: `Cinco humanos ${gameType}`, gameType, minGames: 3 }); leagues.push(league)
      for (const h of humans.slice(1)) await api('/api/leagues/join', h.token, { code: league.inviteCode, expectedGameType: gameType })
      const peers: { socket: Socket; credential: any }[] = []
      for (let i = 0; i < 5; i++) {
        const { socket } = await connect(humans[i].token)
        const joined = waitEvent(socket, 'joined')
        socket.emit(i === 0 ? 'create' : 'join', i === 0
          ? { name: humans[i].account.name, gameType, secondsPerTurn: 0, discardOptionDelaySeconds: 0 }
          : { name: humans[i].account.name, roomId: peers[0].credential.roomId })
        const seat = await joined
        peers.push({ socket, credential: { roomId: seat.roomId, playerId: seat.playerId, token: seat.resumeToken } })
      }
      allCredentials.push(peers.map((p, i) => ({ ...p.credential, membershipToken: humans[i].token })))
      const roomId = peers[0].credential.roomId, playerIds = peers.map(p => p.credential.playerId)
      let views: Record<string, GameState> = {}, lastAudit: any
      const sync = async (advanceMs = 0) => {
        const result = await request('sync', { roomId, playerIds, advanceMs }); views = result.views; now = result.now; lastAudit = result.audit
      }
      const action = async (id: string, event: string, payload: unknown = {}) => {
        const peer = peers.find(p => p.credential.playerId === id)!
        const ack = await new Promise<any>((resolve, reject) => peer.socket.timeout(10_000).emit(event, payload, (error: Error | null, value: any) => error ? reject(error) : resolve(value)))
        await sync(150); return ack
      }
      assert.equal((await action(playerIds[0], 'set_league', { leagueId: league.id })).ok, true)
      const matches: any[] = []
      let midgameRestart = false
      for (let match = 0; match < 3; match++) {
        const settings = { mode: 'normal', maxCards: match === 2 ? 4 : 3, oneCardRounds: 1, oneCardRoundsEnd: 1, peakRounds: 1 }
        if (gameType === 'pocha' || match === 0) {
          const startedGame = await action(playerIds[0], 'start', gameType === 'pocha' ? { pochaSettings: settings } : {})
          assert.equal(startedGame.ok, true, startedGame.error)
        }
        assert.equal(lastAudit.bots, 0); assert.equal(lastAudit.eligible, true); assert.equal(lastAudit.distinctAccounts, 5); assert.equal(lastAudit.connected, 5)
        const result = gameType === 'pocha'
          ? await drivePochaGame({ playerIds, view: id => views[id], action, advance: sync })
          : await driveContiGame({ playerIds, view: id => views[id], action, afterAction: async step => {
            if (midgameRestart || match !== 0 || step.event !== 'draw') return
            const before = JSON.parse(await readFile(games, 'utf8')).rooms.find((r: any) => r.room.roomId === roomId)
            assert.equal(before.room.currentPlayerHasDrawn, true)
            await stop()
            for (const socket of sockets) socket.disconnect()
            await start()
            for (let i = 0; i < peers.length; i++) {
              const resumed = await connect(humans[i].token, peers[i].credential); peers[i].socket = resumed.socket
              assert.equal(resumed.joined.playerId, playerIds[i])
            }
            await sync()
            const after = JSON.parse(await readFile(games, 'utf8')).rooms.find((r: any) => r.room.roomId === roomId)
            assert(isDeepStrictEqual(after.room, before.room), 'Complete private room state survives real child restart after drawing')
            assert(isDeepStrictEqual(after.match, before.match), 'Account bindings and eligible match identity survive restart')
            assert(isDeepStrictEqual(after.sessions, before.sessions), 'All five recovery hashes survive restart')
            assert.equal(lastAudit.connected, 5); assert.equal(lastAudit.eligible, true)
            receipt.checks.continentalMidgameRestart = { exactPrivateState: true, currentTurnAndDrawn: true, stockOrderAndHands: true, matchIdentity: true, fiveHumanSeats: true }
            midgameRestart = true
          } })
        assert.equal(views[playerIds[0]].phase, 'game_end')
        assert.equal(lastAudit.eligible, true)
        const table = await api(`/api/leagues/${league.id}`, humans[0].token)
        assert.equal(table.gameCount, match + 1); assert.equal(table.memberCount, 5)
        assert(table.standings.every((r: any) => r.played === match + 1))
        const recent = table.recentGames[0]
        assert.equal(recent.playerCount, 5)
        for (const final of result.finalScores) {
          const recorded = recent.players.find((p: any) => p.name === final.name)
          const position = 1 + result.finalScores.filter(other => gameType === 'pocha' ? other.score > final.score : other.score < final.score).length
          assert.equal(recorded.score, final.score, 'HTTP league score equals the played engine result')
          assert.equal(recorded.position, position, 'Ties and final places follow the rules of this game')
        }
        for (const human of humans) {
          const stats = await api(`/api/membership/stats?gameType=${gameType}`, human.token)
          assert.equal(stats.byGame[gameType].played, match + 1)
        }
        matches.push({ actions: result.actions, rounds: Array.isArray(result.rounds) ? result.rounds.length : result.rounds,
          eventCounts: result.eventCounts, privateViewChecks: result.privateViewChecks,
          finalScores: result.finalScores.map(({ name, score }) => ({ name, score })) })
        receipt.games[gameType] = { completed: match + 1, matches, standings: table.standings.map(({ name, rank, rating, played, wins, draws, losses, provisional }: any) => ({ name, rank, rating, played, wins, draws, losses, provisional })) }
        await saveReceipt()
        console.log(`${gameType}: ${match + 1}/3 real five-human matches complete (${result.actions} legal socket actions)`)
        if (match < 2) {
          if (gameType === 'pocha') await sync(4001)
          const rematch = await action(playerIds[0], 'rematch')
          assert.equal(rematch.ok, true, rematch.error)
          assert.equal((await api(`/api/leagues/${league.id}`, humans[0].token)).gameCount, match + 1, 'Rematch does not duplicate completed result')
        }
      }
      const stored = JSON.parse(await readFile(games, 'utf8'))
      const ratings = new Map(humans.map(h => [h.account.id, initialLeagueRating()]))
      const results = stored.results.filter((r: any) => r.leagueId === league.id).sort((a: any, b: any) => a.finishedAt - b.finishedAt || a.id.localeCompare(b.id))
      assert.equal(results.length, 3)
      for (const result of results) {
        assert.equal(new Set(result.players.map((p: any) => p.accountId)).size, 5)
        for (const [key, value] of updateLeagueRatings(result.players.map((p: any) => ({ id: p.accountId, ...ratings.get(p.accountId)!, position: p.position })))) ratings.set(key, value)
      }
      const table = await api(`/api/leagues/${league.id}`, humans[0].token)
      for (const row of table.standings) {
        const member = stored.leagues.find((l: any) => l.id === league.id).members.find((m: any) => m.id === row.memberId)
        assert.equal(row.rating, leagueRatingPoints(ratings.get(member.accountId)!))
        assert.equal(row.provisional, false); assert.notEqual(row.rank, null)
      }
      receipt.checks[gameType] = { exactTrueSkillReplay: true, individualStatsForAllFive: true, rematchDeduplication: true, privateHands: true, humanEligibleThroughout: true }
      await saveReceipt()
    }
    const before = await Promise.all(leagues.map(l => api(`/api/leagues/${l.id}`, humans[0].token)))
    await stop()
    for (const socket of sockets) socket.disconnect()
    await start()
    for (let i = 0; i < 5; i++) {
      assert.equal((await api('/api/membership/me', humans[i].token)).account.id, humans[i].account.id)
      const stats = await api('/api/membership/stats', humans[i].token)
      assert.equal(stats.byGame.pocha.played, 3); assert.equal(stats.byGame.continental.played, 3)
      assert.equal(stats.overall.played, 6)
    }
    for (let i = 0; i < leagues.length; i++) assert(isDeepStrictEqual(await api(`/api/leagues/${leagues[i].id}`, humans[0].token), before[i]), 'Private league table survives restart')
    for (const group of allCredentials) for (const credential of group) {
      const { joined } = await connect(credential.membershipToken, credential)
      assert.equal(joined.playerId, credential.playerId); assert.equal(joined.state.phase, 'game_end')
    }
    receipt.checks.restart = { durableTablesUnchanged: true, fiveAccountSessionsPreserved: true, allPersonalStatsPreserved: true, tenHumanSeatsResumed: true }
    receipt.elapsedSeconds = Math.round((performance.now() - started) / 100) / 10
    await saveReceipt(true)
  } finally {
    if (child!?.connected) {
      try { await stop() } catch {
        if (child!.exitCode === null && child!.signalCode === null) { const exited = once(child!, 'exit'); child!.kill(); await exited }
      }
    }
    for (const socket of sockets) socket.disconnect()
    for (const item of pending.values()) clearTimeout(item.timer)
    const absolute = resolve(directory)
    assert(dirname(absolute) === resolve(tmpdir()) && basename(absolute).startsWith('nrn-five-human-'))
    await rm(absolute, { recursive: true, force: true })
  }
})
