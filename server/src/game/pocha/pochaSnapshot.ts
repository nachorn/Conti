import type { PochaCard, PochaGameState, PochaSettings, SpanishSuit, TrickCard } from './pochaTypes.js'
import { roundSchedule } from './pochaRules.js'

/** Allowlisted save parser. Private hands remain private; unknown saved fields are discarded. */
export function parsePochaSnapshot(raw: unknown, roomId: string, members: { id: string; name: string; seatIndex: number; score: number; connected: boolean }[]): PochaGameState {
  const fail = (): never => { throw new Error('Invalid Pocha snapshot') }
  const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : fail()
  const list = (v: unknown, max: number): any[] => Array.isArray(v) && v.length <= max ? v : fail()
  const num = (v: unknown, min = 0, max = 10000): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : fail()
  const str = (v: unknown, max = 128): string => typeof v === 'string' && v.length > 0 && v.length <= max ? v : fail()
  const ids = new Set(members.map(p => p.id))
  const id = (v: unknown): string => typeof v === 'string' && ids.has(v) ? v : fail()
  const suit = (v: unknown): SpanishSuit => ['oros', 'copas', 'espadas', 'bastos'].includes(v as string) ? v as SpanishSuit : fail()
  const s = obj(raw)
  if (s.roomId !== roomId || ![40, 48].includes(s.deckSize)) fail()
  const card = (v: unknown): PochaCard => {
    const c = obj(v); const rank = num(c.rank, 1, 12)
    if (s.deckSize === 40 && [8, 9].includes(rank)) fail()
    return { id: str(c.id), suit: suit(c.suit), rank }
  }
  const trick = (v: unknown): TrickCard[] => list(v, members.length).map(v => ({ playerId: id(obj(v).playerId), card: card(obj(v).card) }))
  const settingsRaw = obj(s.settings)
  if (!['normal', 'subastada'].includes(settingsRaw.mode)) fail()
  const settings: PochaSettings = { mode: settingsRaw.mode, maxCards: num(settingsRaw.maxCards, 1, 24),
    oneCardRounds: num(settingsRaw.oneCardRounds, 1, 10), peakRounds: num(settingsRaw.peakRounds, 1, 10) }
  const expected = roundSchedule(settings, Math.max(2, members.length), s.deckSize)
  if (!['lobby', 'auction', 'choosing_trump', 'bidding', 'playing', 'hand_end', 'game_end'].includes(s.phase)) fail()
  const schedule = list(s.schedule, 80).map(n => num(n, 1, 24))
  if (s.phase !== 'lobby' && JSON.stringify(schedule) !== JSON.stringify(expected)) fail()
  const players = list(s.players, 10).map(v => {
    const p = obj(v); const member = members.find(m => m.id === id(p.id))!
    if (p.name !== member.name || p.seatIndex !== member.seatIndex || p.score !== member.score || p.connected !== member.connected) fail()
    return { ...member, hand: list(p.hand, 24).map(card), bid: p.bid === null ? null : num(p.bid, 0, 24), tricksWon: num(p.tricksWon, 0, 24) }
  })
  if (players.length !== members.length || new Set(players.map(p => p.id)).size !== members.length) fail()
  const maxIndex = Math.max(0, members.length - 1)
  const bids: Record<string, number> = {}
  for (const [key, value] of Object.entries(obj(s.bids))) bids[id(key)] = num(value, 0, 24)
  const history = list(s.history, 80).map(v => {
    const h = obj(v)
    return { handNumber: num(h.handNumber, 1, 80), cardsPerHand: num(h.cardsPerHand, 1, 24), trump: suit(h.trump),
      players: list(h.players, 10).map(v => {
        const p = obj(v)
        return { id: id(p.id), name: str(p.name, 24), bid: num(p.bid, 0, 24), tricksWon: num(p.tricksWon, 0, 24),
          points: num(p.points, -48, 53), total: num(p.total, -10000, 10000) }
      }) }
  })
  const result: PochaGameState = {
    roomId, deckSize: s.deckSize, phase: s.phase, settings, schedule, hostId: members.length ? id(s.hostId) : '',
    players, handNumber: num(s.handNumber, 0, 80), cardsPerHand: num(s.cardsPerHand, 0, 24),
    dealerIndex: num(s.dealerIndex, 0, maxIndex), originalLeadPlayerIndex: num(s.originalLeadPlayerIndex, 0, maxIndex),
    leadPlayerIndex: num(s.leadPlayerIndex, 0, maxIndex), currentPlayerIndex: num(s.currentPlayerIndex, 0, maxIndex),
    trump: s.trump === null ? null : suit(s.trump), trumpCard: s.trumpCard === null ? null : card(s.trumpCard),
    currentTrick: trick(s.currentTrick), bids,
    auction: list(s.auction, members.length).map(v => ({ playerId: id(obj(v).playerId), value: v.value === null ? null : num(v.value, 0, 24) })),
    auctionWinnerId: s.auctionWinnerId === null ? null : id(s.auctionWinnerId),
    lastTrick: s.lastTrick === null ? null : { cards: trick(obj(s.lastTrick).cards), winnerId: id(s.lastTrick.winnerId) },
    trickReviewUntil: s.trickReviewUntil == null ? null : num(s.trickReviewUntil, 0, Number.MAX_SAFE_INTEGER),
    history,
  }
  if (result.phase !== 'lobby' && (members.length < 2 || result.cardsPerHand !== schedule[result.handNumber - 1])) fail()
  const activeCards = [...players.flatMap(p => p.hand), ...result.currentTrick.map(t => t.card)]
  if (new Set(activeCards.map(c => c.id)).size !== activeCards.length ||
      new Set(activeCards.map(c => c.suit + c.rank)).size !== activeCards.length) fail()
  if (['bidding', 'playing', 'hand_end', 'game_end'].includes(result.phase) && !result.trump) fail()
  return result
}
