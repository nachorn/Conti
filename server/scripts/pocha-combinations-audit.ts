import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Room } from '../src/room.js'
import { createPochaHandState, applyPochaAction, publicPochaState } from '../src/game/pocha/pochaEngine.js'
import { isPochaAuctionRound, roundSchedule } from '../src/game/pocha/pochaRules.js'
import { parsePochaSnapshot } from '../src/game/pocha/pochaSnapshot.js'
import { isPochaAuctionRound as clientAuction, roundSchedule as clientSchedule } from '../../shared/pochaRules.js'
import type { PochaAction, PochaCard, PochaDeckSize, PochaGameState, PochaSettings, SpanishSuit } from '../src/game/pocha/pochaTypes.js'

// Reproducible local audit: no network access or real player data.
const output = resolve(process.argv[2] ?? '../review-evidence/pocha-combinations-10')
mkdirSync(output, { recursive: true })
const startedAt = new Date().toISOString()
mock.timers.enable({ apis: ['Date'], now: Date.now() })
let seed = 10092026
mock.method(Math, 'random', () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 })
const suits: SpanishSuit[] = ['oros', 'copas', 'espadas', 'bastos']
const ranks = [2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 3, 1]
const members = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: `Bot ${i + 1}`, seatIndex: i, score: 0, connected: true }))
const ids = (cards: PochaCard[]) => cards.map(c => c.id).sort()
const expectedSchedule = (s: PochaSettings) => {
  if (s.maxCards === 1) return Array(s.oneCardRounds).fill(1)
  const list = Array(s.oneCardRounds).fill(1)
  for (let n = 2; n < s.maxCards; n++) list.push(n)
  for (let n = 0; n < s.peakRounds; n++) list.push(s.maxCards)
  for (let n = s.maxCards - 1; n >= 2; n--) list.push(n)
  return [...list, ...Array(s.oneCardRounds).fill(1)]
}
const expectedAuction = (s: PochaSettings, cards: number) =>
  s.mode === 'subastada' && cards === s.maxCards
const strength = (c: PochaCard, led: SpanishSuit, trump: SpanishSuit) =>
  (c.suit === trump ? 100 : c.suit === led ? 50 : 0) + ranks.indexOf(c.rank)
const winner = (trick: PochaGameState['currentTrick'], trump: SpanishSuit) =>
  trick.reduce((a, b) => strength(a.card, trick[0].card.suit, trump) >= strength(b.card, trick[0].card.suit, trump) ? a : b)
const estimate = (hand: PochaCard[], trump: SpanishSuit) => Math.min(hand.length, Math.round(hand.reduce((sum, c) =>
  sum + (c.suit === trump ? ({ 1: .95, 3: .85, 12: .7, 11: .6, 10: .5 }[c.rank] ?? .3) : ({ 1: .7, 3: .45, 12: .2 }[c.rank] ?? .04)), 0)))
const bestSuit = (hand: PochaCard[]) => [...suits].sort((a, b) => estimate(hand, b) - estimate(hand, a))[0]

const matrix = { configurations: 0, current: 0, legacy: 0, scheduleRounds: 0, deals: 0, restoredDeals: 0, auctionPaths: 0 }
const totals = { rounds: 0, tricks: 0, cards: 0, auctions: 0, auctionsWithRemainder: 0, forbiddenCards: 0, invalidActions: 0, blockedBids: 0, reviewBlocks: 0, mustBeat: 0, overtrump: 0, followSuit: 0, mustTrump: 0, snapshots: 0, privateViews: 0 }
const auctionSuits = Object.fromEntries(suits.map(s => [s, 0]))
const games: any[] = []
let context: any = {}

function inspectDeal(s: PochaGameState) {
  const n = s.players.length, auction = expectedAuction(s.settings, s.cardsPerHand)
  assert.equal(s.phase, auction ? 'auction' : 'bidding')
  assert.equal(s.trumpCard === null, auction)
  assert.equal(s.trump === null, auction)
  const all = s.players.flatMap(p => p.hand)
  assert.equal(all.length, n * s.cardsPerHand)
  assert.equal(new Set(ids(all)).size, all.length)
  assert.equal(new Set(all.map(c => c.suit + c.rank)).size, all.length)
  for (const p of s.players) assert.equal(p.hand.length, s.cardsPerHand)
  if (s.deckSize === 40) assert.ok(all.every(c => c.rank !== 8 && c.rank !== 9))
  if (!auction) {
    assert.equal(s.trump, s.trumpCard!.suit)
    if (all.length === s.deckSize) assert.equal(s.trumpCard!.id, s.players[s.dealerIndex].hand.at(-1)!.id)
    else assert.ok(!all.some(c => c.id === s.trumpCard!.id || (c.suit === s.trumpCard!.suit && c.rank === s.trumpCard!.rank)))
  }
}

try {
  // Every allowed setup, plus compatibility with both values of the retired flag.
  for (const deck of [40, 48] as const) for (let n = 2; n <= 10; n++) {
    const ps = members(n)
    for (const mode of ['normal', 'subastada'] as const) for (const flag of [undefined, false, true])
      for (let maxCards = 1; maxCards <= Math.floor(deck / n); maxCards++)
        for (let oneCardRounds = 1; oneCardRounds <= n; oneCardRounds++) for (let peakRounds = 1; peakRounds <= n; peakRounds++) {
          const settings: PochaSettings = { mode, maxCards, oneCardRounds, peakRounds, ...(flag === undefined ? {} : { auctionWithRemainder: flag }) }
          context = { stage: 'configuration', deck, players: n, settings }
          const expected = expectedSchedule(settings)
          assert.deepEqual(roundSchedule(settings, n, deck), expected)
          assert.deepEqual(clientSchedule(settings, n, deck), expected)
          for (const cards of expected) {
            const auction = expectedAuction(settings, cards)
            assert.equal(isPochaAuctionRound(settings, cards), auction)
            assert.equal(clientAuction(settings, cards), auction)
            matrix.scheduleRounds++
          }
          for (const round of new Set([1, expected.indexOf(maxCards) + 1])) {
            const state = createPochaHandState('matrix', ps, round, n - 1, deck, settings)
            inspectDeal(state); matrix.deals++
            assert.deepEqual(parsePochaSnapshot(structuredClone(state), 'matrix', ps), state)
            matrix.restoredDeals++
          }
          matrix.configurations++
          if (flag === undefined) matrix.current++; else matrix.legacy++
        }
    console.log(`Configuraciones: baraja ${deck}, ${n} jugadores comprobados (${matrix.configurations} acumuladas).`)
  }

  // Exercise every winner seat, four trump suits and zero/one/maximum offers at representative peaks.
  for (const deck of [40, 48] as const) for (let n = 2; n <= 10; n++) {
    const cap = Math.floor(deck / n)
    for (const maxCards of new Set([1, Math.max(2, Math.floor(cap / 2)), cap])) {
      const settings: PochaSettings = { mode: 'subastada', auctionWithRemainder: true, maxCards, oneCardRounds: 1, peakRounds: 1 }
      for (let seat = 0; seat < n; seat++) for (const offer of new Set([0, 1, maxCards])) {
        if (offer === 0 && seat !== 0) continue // Zero can win only when the opening player keeps the auction.
        for (const suit of suits) {
          context = { stage: 'auction paths', deck, players: n, maxCards, seat, offer, suit }
          const s = createPochaHandState('paths', members(n), maxCards, n - 1, deck, settings)
          const act = (action: PochaAction) => assert.deepEqual(applyPochaAction(s, s.players[s.currentPlayerIndex].id, action), { ok: true })
          assert.equal(applyPochaAction(s, 'b0', { type: 'auction', value: null }).ok, false)
          for (let i = 0; i < n; i++) act({ type: 'auction', value: i === seat ? offer : i === 0 ? 0 : null })
          assert.equal(s.auctionWinnerId, `b${seat}`)
          assert.equal(s.currentPlayerIndex, seat)
          assert.equal(s.bids[`b${seat}`], offer)
          assert.equal(s.originalLeadPlayerIndex, 0)
          assert.equal(applyPochaAction(s, `b${seat}`, { type: 'auction', value: maxCards }).ok, false)
          act({ type: 'trump', suit })
          assert.equal(s.trumpCard, null)
          while (s.phase === 'bidding') {
            const view = publicPochaState(s, s.players[s.currentPlayerIndex].id)
            act({ type: 'bid', value: view.blockedBid === 0 ? 1 : 0 })
          }
          assert.equal(s.currentPlayerIndex, seat)
          assert.equal(s.trump, suit)
          matrix.auctionPaths++
        }
      }
    }
  }
  console.log(`Matriz completada: ${matrix.configurations} configuraciones y ${matrix.auctionPaths} variantes de subasta.`)

  const cases: { players: number; deck: PochaDeckSize; settings: PochaSettings }[] = [
    { players: 2, deck: 48, settings: { mode: 'normal', auctionWithRemainder: true, maxCards: 24, oneCardRounds: 1, peakRounds: 2 } },
    { players: 3, deck: 40, settings: { mode: 'subastada', auctionWithRemainder: false, maxCards: 13, oneCardRounds: 3, peakRounds: 2 } },
    { players: 4, deck: 48, settings: { mode: 'subastada', auctionWithRemainder: true, maxCards: 12, oneCardRounds: 2, peakRounds: 4 } },
    { players: 5, deck: 40, settings: { mode: 'subastada', maxCards: 6, oneCardRounds: 3, peakRounds: 3 } },
    { players: 6, deck: 48, settings: { mode: 'subastada', auctionWithRemainder: true, maxCards: 5, oneCardRounds: 2, peakRounds: 4 } },
    { players: 7, deck: 40, settings: { mode: 'subastada', auctionWithRemainder: true, maxCards: 5, oneCardRounds: 1, peakRounds: 7 } },
    { players: 8, deck: 48, settings: { mode: 'subastada', auctionWithRemainder: false, maxCards: 6, oneCardRounds: 8, peakRounds: 2 } },
    { players: 9, deck: 48, settings: { mode: 'subastada', auctionWithRemainder: true, maxCards: 1, oneCardRounds: 9, peakRounds: 9 } },
    { players: 10, deck: 40, settings: { mode: 'normal', auctionWithRemainder: false, maxCards: 4, oneCardRounds: 2, peakRounds: 10 } },
    { players: 5, deck: 40, settings: { mode: 'subastada', maxCards: 8, oneCardRounds: 1, peakRounds: 1 } },
  ]
  for (const [g, setup] of cases.entries()) {
    const n = setup.players, gameSeed = 10092026 + g * 7919; seed = gameSeed
    let room = new Room({ roomId: `audit-${g + 1}`, gameType: 'pocha', pochaDeckSize: setup.deck })
    for (let seat = 0; seat < n; seat++) { const id = (seat + g) % n; room.addPlayer(`b${id}`, `Bot ${id + 1}`) }
    assert.deepEqual(room.startPochaGame(setup.settings), { ok: true })
    const beforeTotals = { ...totals }
    let steps = 0, observedRound = 0, dealtIds: string[] = [], playedIds: string[] = []
    const reject = (id: string, action: PochaAction, category: keyof typeof totals = 'invalidActions') => {
      const before = room.toSnapshot()
      assert.equal(room.pochaAction(id, action).ok, false)
      assert.deepEqual(room.toSnapshot(), before); totals[category]++
    }
    while (room.pocha!.phase !== 'game_end') {
      assert.ok(++steps < 12000, 'Game did not finish')
      mock.timers.tick(4100)
      const s = room.pocha!, p = s.players[s.currentPlayerIndex]
      context = { stage: 'complete game', game: g + 1, setup, round: s.handNumber, phase: s.phase, player: p.id }
      if (s.handNumber !== observedRound) {
        inspectDeal(s); observedRound = s.handNumber
        dealtIds = ids(s.players.flatMap(p => p.hand)); playedIds = []
      }
      if (s.phase === 'hand_end') {
        assert.deepEqual([...playedIds].sort(), dealtIds)
        const original = s.originalLeadPlayerIndex
        assert.ok(room.nextRound())
        assert.equal(room.pocha!.originalLeadPlayerIndex, (original + 1) % n)
      } else {
        const view = room.getState(p.id).pocha!
        for (const visible of view.players) {
          assert.equal(visible.handCount, s.players.find(x => x.id === visible.id)!.hand.length)
          assert.deepEqual(visible.hand, visible.id === p.id ? p.hand : []); totals.privateViews++
        }
        assert.ok(room.getState('spectator').pocha!.players.every(p => p.hand.length === 0))
        reject(s.players[(s.currentPlayerIndex + 1) % n].id, { type: 'bid', value: 0 })
        let action: PochaAction
        if (s.phase === 'auction') {
          const best = Math.max(-1, ...s.auction.map(a => a.value ?? -1)), index = s.auction.length
          if (!index) reject(p.id, { type: 'auction', value: null })
          else reject(p.id, { type: 'auction', value: best })
          reject(p.id, { type: 'auction', value: s.cardsPerHand + 1 })
          const pattern = (totals.auctions + g) % 4
          let offer: number | null
          if (pattern === 1) offer = index === 0 ? 0 : null
          else if (pattern === 2) offer = index === 0 ? s.cardsPerHand : null
          else if (pattern === 3) offer = index === 0 ? 0 : index === n - 1 ? 1 : null
          else { const guess = estimate(p.hand, bestSuit(p.hand)); offer = !index || guess > best ? guess : null }
          action = { type: 'auction', value: offer }
        } else if (s.phase === 'choosing_trump') {
          assert.equal(s.auction.length, n); assert.equal(new Set(s.auction.map(a => a.playerId)).size, n)
          const offers = s.auction.filter(a => a.value !== null)
          for (let i = 1; i < offers.length; i++) assert.ok(offers[i].value! > offers[i - 1].value!)
          assert.equal(p.id, s.auctionWinnerId); assert.equal(p.bid, offers.at(-1)!.value)
          reject(p.id, { type: 'auction', value: s.cardsPerHand })
          const suit = suits[(totals.auctions + g) % 4]
          action = { type: 'trump', suit }; auctionSuits[suit]++; totals.auctions++
          if (s.cardsPerHand * n < setup.deck) totals.auctionsWithRemainder++
        } else if (s.phase === 'bidding') {
          const last = Object.keys(s.bids).length === n - 1
          const remaining = s.cardsPerHand - Object.values(s.bids).reduce((a, b) => a + b, 0)
          const blocked = last && remaining >= 0 && remaining <= s.cardsPerHand ? remaining : null
          assert.equal(view.blockedBid, blocked)
          if (blocked !== null) reject(p.id, { type: 'bid', value: blocked }, 'blockedBids')
          let value = estimate(p.hand, s.trump!)
          if (value === blocked) value = value === s.cardsPerHand ? value - 1 : value + 1
          action = { type: 'bid', value }
        } else {
          assert.equal(s.phase, 'playing')
          const led = s.currentTrick[0]?.card.suit, trump = s.trump!
          const follows = p.hand.filter(c => c.suit === led), trumps = p.hand.filter(c => c.suit === trump)
          const mandatory = !led ? p.hand : follows.length ? follows : trumps.length ? trumps : p.hand
          const best = led ? winner(s.currentTrick, trump) : null
          const beating = best ? mandatory.filter(c => (c.suit === trump || c.suit === led) && strength(c, led!, trump) > strength(best.card, led!, trump)) : []
          const legal = beating.length ? beating : mandatory
          assert.deepEqual([...view.legalCardIds!].sort(), ids(legal))
          if (led && follows.length && follows.length < p.hand.length) totals.followSuit++
          if (led && !follows.length && trumps.length) totals.mustTrump++
          if (beating.length && beating.length < mandatory.length) { totals.mustBeat++; if (!follows.length && trumps.length) totals.overtrump++ }
          for (const c of p.hand.filter(c => !legal.includes(c))) reject(p.id, { type: 'play', cardId: c.id }, 'forbiddenCards')
          const ordered = [...legal].sort((a, b) => ranks.indexOf(a.rank) - ranks.indexOf(b.rank))
          const need = p.bid! > p.tricksWon
          const losing = best ? ordered.filter(c => strength(c, led!, trump) <= strength(best.card, led!, trump)) : []
          const choice = steps % 5 === 0 ? legal[Math.floor(Math.random() * legal.length)] : need ? (beating.length ? ordered[0] : ordered.at(-1)!) : losing[0] ?? ordered[0]
          const expectedWinner = s.currentTrick.length === n - 1 ? winner([...s.currentTrick, { playerId: p.id, card: choice }], trump).playerId : null
          assert.deepEqual(room.pochaAction(p.id, { type: 'play', cardId: choice.id }), { ok: true })
          playedIds.push(choice.id); totals.cards++
          assert.deepEqual([...ids(s.players.flatMap(p => p.hand)), ...playedIds].sort(), dealtIds)
          if (expectedWinner) {
            assert.equal(s.lastTrick!.winnerId, expectedWinner)
            assert.equal(s.players[s.currentPlayerIndex].id, expectedWinner); totals.tricks++
            reject(expectedWinner, { type: 'play', cardId: s.players[s.currentPlayerIndex].hand[0]?.id ?? 'finished' }, 'reviewBlocks')
            if (s.phase as string === 'hand_end') assert.equal(room.nextRound(), false)
          }
          action = null as any // Card already played, with its expected winner checked above.
        }
        if (action) {
          const beforePhase = s.phase
          assert.deepEqual(room.pochaAction(p.id, action), { ok: true })
          if (beforePhase === 'bidding' && s.phase as string === 'playing') {
            assert.notEqual(Object.values(s.bids).reduce((a, b) => a + b, 0), s.cardsPerHand)
            assert.equal(s.players[s.currentPlayerIndex].id, s.auctionWinnerId ?? s.players[s.originalLeadPlayerIndex].id)
          }
        }
      }
      const snapshot = room.toSnapshot()
      room = Room.fromSnapshot(snapshot, { disconnectPlayers: false })
      assert.deepEqual(room.toSnapshot(), snapshot)
      assert.deepEqual(room.pocha!.settings, setup.settings); totals.snapshots++
    }
    assert.deepEqual([...playedIds].sort(), dealtIds)
    const s = room.pocha!
    assert.equal(s.history.length, expectedSchedule(setup.settings).length)
    const expectedAuctions = s.schedule.filter(c => expectedAuction(setup.settings, c)).length
    assert.equal(totals.auctions - beforeTotals.auctions, expectedAuctions)
    for (const h of s.history) {
      assert.equal(h.players.reduce((sum, p) => sum + p.tricksWon, 0), h.cardsPerHand)
      assert.notEqual(h.players.reduce((sum, p) => sum + p.bid, 0), h.cardsPerHand)
      for (const p of h.players) assert.equal(p.points, p.bid === p.tricksWon ? 5 + 2 * p.tricksWon : -2 * Math.abs(p.bid - p.tricksWon))
    }
    totals.rounds += s.history.length
    const highest = Math.max(...s.players.map(p => p.score))
    const results = s.players.map(p => {
      const rows = s.history.map(h => h.players.find(x => x.id === p.id)!)
      let running = 0; for (const r of rows) { running += r.points; assert.equal(r.total, running) }
      assert.equal(p.score, running)
      return { name: p.name, score: p.score, winner: p.score === highest, exact: rows.filter(r => r.bid === r.tricksWon).length, tricks: rows.reduce((sum, r) => sum + r.tricksWon, 0) }
    }).sort((a, b) => b.score - a.score)
    games.push({ game: g + 1, seed: gameSeed, ...setup, remainderAtPeak: setup.deck - setup.settings.maxCards * n, results, history: s.history, checks: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value - beforeTotals[key as keyof typeof totals]])) })
    console.log(`Partida ${g + 1}: ${n} jugadores, ${setup.deck} cartas, ${s.history.length} rondas, ${expectedAuctions} subastas. ${results.filter(r => r.winner).map(r => r.name + ': ' + r.score).join(', ')}.`)
  }
  for (const suit of suits) assert.ok(auctionSuits[suit] > 0)
} catch (error) {
  writeFileSync(resolve(output, 'failure.json'), JSON.stringify({ context, error: String(error), stack: (error as Error).stack, matrix, totals, games }, null, 2))
  throw error
} finally { mock.restoreAll(); mock.timers.reset() }

const report = { startedAt, errors: 0, scope: 'Local real-engine simulations; configuration/deal matrix plus ten complete games. No network, UI or exhaustive card permutations.', matrix, totals, auctionSuits, games }
writeFileSync(resolve(output, 'results.json'), JSON.stringify(report, null, 2))
const modeLabel = (g: any) => g.settings.mode === 'normal' ? 'Normal' : 'Subastada'
const rows = games.map(g => `| ${g.game} | ${g.players} | ${g.deck} | ${modeLabel(g)} | ${g.settings.maxCards} | ${g.checks.rounds} | ${g.checks.auctions} | ${g.results.filter((r: any) => r.winner).map((r: any) => r.name + ' (' + r.score + ')').join(', ')} |`).join('\n')
const md = `# Pocha · diez partidas y matriz de configuraciones\n\n**Errores detectados: 0.** Simulación local del motor real, barajado reproducible, bots que solo usan su mano e información pública y reloj acelerado. Esta tanda no prueba red ni interfaz.\n\n## Cobertura\n\n- ${matrix.current.toLocaleString('es-ES')} configuraciones actuales y ${matrix.legacy.toLocaleString('es-ES')} configuraciones antiguas con el ajuste retirado: de 2 a 10 jugadores, barajas de 40 y 48, ambas modalidades, todos los máximos y todas las repeticiones permitidas.\n- ${matrix.scheduleRounds.toLocaleString('es-ES')} posiciones de calendario verificadas en cliente y servidor. ${matrix.deals.toLocaleString('es-ES')} repartos iniciales o máximos comprobados y restaurados.\n- ${matrix.auctionPaths.toLocaleString('es-ES')} variantes de subasta con todos los asientos ganadores, los cuatro palos y ofertas de 0, 1 o el máximo donde son válidas.\n- Diez partidas completas: ${totals.rounds} rondas, ${totals.tricks} bazas y ${totals.cards} cartas. ${totals.auctions} subastas, ${totals.auctionsWithRemainder} con cartas sobrantes.\n- ${totals.forbiddenCards} intentos de jugar cartas prohibidas y ${totals.invalidActions} acciones inválidas rechazados sin cambiar la mesa. ${totals.mustBeat} ocasiones de superar obligatoriamente, ${totals.overtrump} de sobretriunfar.\n- ${totals.snapshots} restauraciones durante las partidas; ganadores, puntuaciones, predicciones, cartas privadas y conservación de cartas verificados.\n\nLa matriz comprueba configuraciones y repartos; las diez partidas comprueban el desarrollo completo. No se han agotado todas las posibles permutaciones de cartas y decisiones.\n\n## Resultados\n\n| # | Jugadores | Baraja | Modalidad | Máximo | Rondas | Subastas | Ganador y puntos |\n|---|---:|---:|---|---:|---:|---:|---|\n${rows}\n\nLos puntos no son comparables entre partidas de distinta duración y número de jugadores. Los empates cuentan como victorias compartidas.\n\n${games.map(g => `### Partida ${g.game}\n\n${g.results.map((r: any) => `- ${r.name}: ${r.score} puntos; ${r.exact}/${g.checks.rounds} predicciones exactas; ${r.tricks} bazas.`).join('\n')}`).join('\n\n')}\n\nTodos los resultados por ronda y semillas están en results.json. Ejecución: ${startedAt}.\n`
writeFileSync(resolve(output, 'report.md'), md)
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocha · 10 partidas y combinaciones</title><style>body{margin:0;background:#f6f3eb;color:#183c30;font:16px/1.5 system-ui}main{max-width:1120px;margin:auto;padding:30px 20px}h1{font-size:clamp(30px,5vw,48px);line-height:1.1}h2{margin-top:32px}.muted{color:#5a6e62}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{background:#174734;color:white;padding:20px;border-radius:14px}.metric strong{display:block;font-size:30px}.metric span{font-size:13px}.panel{background:white;border:1px solid #d8e0d7;border-radius:14px;padding:18px;margin:15px 0}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:14px;white-space:nowrap}th,td{text-align:left;border-bottom:1px solid #e5eae2;padding:12px}th{color:#597163;font-size:12px}.win{font-weight:750;color:#1c6340}summary{cursor:pointer;font-weight:700;min-height:32px}.small{font-size:13px}a{color:#266245}@media(max-width:700px){.metrics{grid-template-columns:1fr 1fr}.panel{padding:12px}main{padding:22px 14px}}</style><main><p class="muted">LA POCHA · REVISIÓN DE SUBASTAS</p><h1>Diez partidas.<br>Todas las configuraciones.</h1><p class="muted">De 2 a 10 jugadores · Barajas de 40 y 48 · Subastas con y sin cartas sobrantes.</p><section class="metrics"><div class="metric"><strong>0</strong><span>Errores detectados</span></div><div class="metric"><strong>${matrix.configurations.toLocaleString('es-ES')}</strong><span>Configuraciones comprobadas*</span></div><div class="metric"><strong>${totals.tricks.toLocaleString('es-ES')}</strong><span>Bazas jugadas y verificadas</span></div><div class="metric"><strong>${totals.auctionsWithRemainder}</strong><span>Subastas con sobrantes</span></div></section><p class="small muted">*${matrix.current.toLocaleString('es-ES')} configuraciones actuales y ${matrix.legacy.toLocaleString('es-ES')} antiguas. La matriz comprueba calendarios, repartos iniciales y máximos, y recuperación. Las diez partidas comprueban el desarrollo completo.</p><h2>Resultados de las diez partidas</h2><div class="panel scroll"><table><thead><tr><th>#</th><th>Jugadores / baraja</th><th>Modalidad</th><th>Máximo</th><th>Rondas</th><th>Subastas</th><th>Ganador · puntos</th></tr></thead><tbody>${games.map(g => `<tr><td>${g.game}</td><td>${g.players} / ${g.deck}</td><td>${modeLabel(g)}</td><td>${g.settings.maxCards}</td><td>${g.checks.rounds}</td><td>${g.checks.auctions}</td><td class="win">${g.results.filter((r: any) => r.winner).map((r: any) => r.name + ' · ' + r.score).join(', ')}</td></tr>`).join('')}</tbody></table></div><p class="small muted">Los puntos no son comparables entre partidas de distinta duración y número de jugadores.</p><h2>Qué se ha comprobado</h2><div class="panel"><p><b>${matrix.auctionPaths.toLocaleString('es-ES')} variantes de subasta:</b> distintos ganadores, los cuatro palos, apertura a cero, ofertas máximas y última persona ganadora.</p><p><b>${totals.cards.toLocaleString('es-ES')} cartas jugadas:</b> ganador independiente, obligación de asistir, triunfar y superar, sin cartas perdidas ni duplicadas.</p><p><b>${totals.forbiddenCards.toLocaleString('es-ES')} cartas prohibidas intentadas:</b> todas rechazadas sin cambiar la mesa. ${totals.mustBeat} decisiones con obligación de superar; ${totals.overtrump} de sobretriunfar.</p><p><b>${totals.snapshots.toLocaleString('es-ES')} restauraciones:</b> se conserva la opción de subasta, manos, turnos, resultados y orden original de la mano.</p><p>Además: predicción del último jugador, puntuación exacta y penalizaciones, privacidad de cartas y pausa para leer el ganador de cada baza.</p></div><h2>Puntuaciones por jugador</h2>${games.map(g => `<details class="panel"><summary>Partida ${g.game} · ${g.players} jugadores · ${g.checks.rounds} rondas</summary><p class="small muted">Máximo ${g.settings.maxCards} · Repeticiones de 1 carta ${g.settings.oneCardRounds} · Repeticiones del máximo ${g.settings.peakRounds}${g.settings.maxCards === 1 ? ' (ignoradas: un solo bloque de 1 carta)' : ''} · ${g.remainderAtPeak} cartas sobrantes en el máximo.</p><div class="scroll"><table><thead><tr><th>Bot</th><th>Puntos</th><th>Aciertos</th><th>Bazas ganadas</th></tr></thead><tbody>${g.results.map((r: any) => `<tr class="${r.winner ? 'win' : ''}"><td>${r.name}${r.winner ? ' ★' : ''}</td><td>${r.score}</td><td>${r.exact}/${g.checks.rounds}</td><td>${r.tricks}</td></tr>`).join('')}</tbody></table></div></details>`).join('')}<p class="small muted">Simulación local del motor real, con reloj acelerado y bots que usan solo su mano e información pública. No es una prueba de red, navegador ni de todas las permutaciones posibles de cartas y jugadas.</p><p><a href="report.md">Informe completo</a> · <a href="results.json" download>Datos de todas las rondas (JSON)</a></p><p class="small muted">Ejecución: ${startedAt}</p></main></html>`
writeFileSync(resolve(output, 'index.html'), html)
console.log(JSON.stringify({ errors: 0, matrix, totals, auctionSuits, output }, null, 2))
