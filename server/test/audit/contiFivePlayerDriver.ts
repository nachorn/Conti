import assert from 'node:assert/strict'
import { findContractMeldsInHand, isValidMeld, replaceJokerInStraight, replaceAndMoveJokerToStraightEnd } from '../../src/game/meld.js'
import type { Card, GameState, RoundContract, RoundResult } from '../../src/types.js'

export interface ContiDriverStep { actions: number; round: number; event: string; playerId: string }
export interface ContiDriverOptions {
  playerIds: string[]
  view(playerId: string): GameState
  action(playerId: string, event: string, payload: unknown): Promise<{ ok: boolean; error?: string }>
  afterAction?(step: ContiDriverStep): Promise<void> | void
  maxActions?: number
}
const penalty = (card: Card) => card.rank === 0 ? 50 : card.rank === 14 ? 20 : card.rank >= 11 ? 10 : card.rank
const joker = (card: Card) => card.rank === 0 || card.suit === 'joker'
function usefulness(card: Card, hand: Card[], contract: RoundContract): number {
  if (joker(card)) return 30
  const others = hand.filter(item => item.id !== card.id)
  const trios = contract.requirements.filter(item => item.type === 'trio').length, runs = contract.requirements.length - trios
  const same = others.filter(item => item.rank === card.rank).length
  let near = 0
  for (const item of others) if (item.suit === card.suit) {
    const distance = Math.abs(item.rank - card.rank)
    near += distance === 1 ? 3 : distance === 2 ? 1.7 : distance === 3 ? .5 : 0
  }
  return trios * Math.min(same, 2) * 4 + runs * near - penalty(card) * .07
}
export function contiWantsDiscard(card: Card | null, view: GameState, id: string, priority: boolean): boolean {
  if (!card) return false
  const hand = view.players.find(player => player.id === id)!.hand
  if (view.melds.some(meld => meld.ownerId === id)) return priority && view.melds.some(meld => isValidMeld(meld.type, [...meld.cards, card]))
  // Speculative purchases can circulate the same useful-looking discard
  // forever. Take it only when it enables an immediate, irreversible meld.
  return view.hasHadTurn.every(Boolean) && !!findContractMeldsInHand([...hand, card], view.contract)
}

/** Break a repeated hand's draw/discard cycle by considering another legal card. */
export class ContiDiscardPolicy {
  private round = 0
  private readonly visits = new Map<string, number>()
  repeatedHands = 0
  choose(id: string, round: number, hand: Card[], choices: Card[], contract: RoundContract, down: boolean): Card {
    assert.ok(choices.length > 0, 'a playing turn must still hold a card')
    if (round !== this.round) { this.round = round; this.visits.clear() }
    // Face values, not private credentials or opponents' hands. Duplicate
    // physical copies have the same strategic effect in a repeated position.
    const key = `${id}|${hand.map(card => `${card.suit}:${card.rank}`).sort().join(',')}`
    const count = this.visits.get(key) ?? 0
    this.visits.set(key, count + 1)
    if (count > 0) this.repeatedHands++
    const sorted = [...choices].sort((a, b) => down ? penalty(b) - penalty(a) : usefulness(a, hand, contract) - usefulness(b, hand, contract))
    return sorted[count % sorted.length]!
  }
}

/** Same modest strategy for five synthetic humans; decisions use only their own hand. */
export async function driveContiGame(h: ContiDriverOptions) {
  assert.equal(h.playerIds.length, 5)
  assert.equal(new Set(h.playerIds).size, 5)
  const first = h.view(h.playerIds[0])
  assert.equal(first.gameType, 'continental'); assert.equal(first.phase, 'playing'); assert.equal(first.round, 1)
  assert.deepEqual(first.players.map(player => player.id).sort(), [...h.playerIds].sort())
  assert.ok(first.players.every(player => player.score === 0), 'each real deal starts at zero')
  const hostId = first.players[0].id
  const rounds: RoundResult[] = [], eventCounts: Record<string, number> = {}
  const discardPolicy = new ContiDiscardPolicy()
  let actions = 0, privateViewChecks = 0

  const checkRound = () => {
    const state = h.view(hostId)
    if (state.phase === 'playing' || state.phase === 'lobby' || rounds.some(round => round.round === state.round)) return
    const round = state.roundHistory?.at(-1)
    assert.ok(round); assert.equal(round.round, rounds.length + 1); assert.equal(round.round, state.round)
    assert.deepEqual(Object.keys(round.scores).sort(), [...h.playerIds].sort())
    for (const id of h.playerIds) {
      const own = h.view(id).players.find(player => player.id === id)!
      const expected: number = id === round.winnerId ? round.sameTurnWin ? -10 * round.round : -10 : own.hand.reduce((sum, card) => sum + penalty(card), 0)
      assert.equal(round.scores[id], expected, 'round penalties and closing bonus follow physical remaining cards')
      if (id === round.winnerId) assert.equal(own.hand.length, 0)
      const total: number = rounds.reduce((sum: number, previous) => sum + previous.scores[id], 0) + expected
      assert.equal(own.score, total); assert.equal(round.totals[id], total)
    }
    assert.deepEqual(state.roundScores, round.scores)
    rounds.push(structuredClone(round))
  }
  const perform = async (id: string, event: string, payload: unknown = {}) => {
    const progress = h.view(id)
    assert.ok(++actions <= (h.maxActions ?? 30_000), `legal strategy exhausted its action budget: round=${progress.round}, phase=${progress.phase}, stock=${progress.stockCount}, handSizes=${progress.players.map(player => player.hand.length).join(',')}, repeatedHands=${discardPolicy.repeatedHands}, events=${JSON.stringify(eventCounts)}`)
    const result = await h.action(id, event, payload)
    assert.equal(result.ok, true, `${event} rejected: ${result.error ?? 'unknown error'}`)
    eventCounts[event] = (eventCounts[event] ?? 0) + 1
    for (const actor of h.playerIds) {
      const view = h.view(actor)
      assert.equal(view.discardPile.length, 0)
      for (const player of view.players) if (player.id !== actor) {
        assert.ok(player.hand.every(card => card.id === 'hidden' && card.rank === 0 && card.suit === 'joker'), 'a client cannot see another hand')
      }
      privateViewChecks++
    }
    await h.afterAction?.({ actions, event, playerId: id, round: h.view(id).round })
    checkRound()
  }

  while (h.view(hostId).phase !== 'game_end') {
    const publicView = h.view(hostId)
    if (publicView.phase === 'round_end') { checkRound(); await perform(hostId, 'next_round'); continue }
    assert.equal(publicView.phase, 'playing')
    const index = publicView.discardOptionPlayerIndex ?? publicView.currentPlayerIndex, id = publicView.players[index].id
    const view = h.view(id), me = view.players.find(player => player.id === id)!
    assert.ok(me.hand.every(card => card.id !== 'hidden'), 'the decision is based on this actor’s private view')
    const down = view.melds.some(meld => meld.ownerId === id)
    if (view.discardOptionPlayerIndex !== null) {
      const priorityIndex = view.discarderIndex === null ? view.dealerIndex : (view.discarderIndex + 1) % 5
      await perform(id, contiWantsDiscard(view.topDiscard, view, id, index === priorityIndex) ? 'take_discard' : 'pass_discard')
      continue
    }
    if (!view.currentPlayerHasDrawn) { await perform(id, 'draw', { fromDiscard: contiWantsDiscard(view.topDiscard, view, id, true) }); continue }
    const contract = findContractMeldsInHand(me.hand, view.contract, view.swappedJokerCardId ?? undefined)
    if (!down && contract && view.hasHadTurn.every(Boolean)) { await perform(id, 'play_melds', { melds: contract }); continue }
    let acted = false
    if (view.hasHadTurn.every(Boolean)) for (const meld of view.melds) {
      if (meld.type !== 'straight') continue
      for (const wild of meld.cards.filter(joker)) {
        for (const card of me.hand.filter(item => !joker(item))) {
          const replacement = replaceJokerInStraight(meld.cards, wild.id, card)
          const legal = down ? replaceAndMoveJokerToStraightEnd(meld.cards, wild.id, card)
            : replacement && findContractMeldsInHand(me.hand.filter(item => item.id !== card.id).concat(replacement.joker), view.contract, wild.id)
          if (!legal) continue
          await perform(id, 'swap_joker', { meldId: meld.id, cardId: card.id, jokerCardId: wild.id }); acted = true; break
        }
        if (acted) break
      }
      if (acted) break
    }
    if (acted) continue
    if (down) for (const meld of view.melds) {
      const candidate = [...me.hand].sort((a, b) => penalty(b) - penalty(a)).find(card => isValidMeld(meld.type, [...meld.cards, card]))
      if (candidate) { await perform(id, 'add_to_meld', { meldId: meld.id, cards: [candidate] }); acted = true; break }
    }
    if (acted) continue
    const unrestricted = me.hand.filter(card => down || !view.melds.some(meld => isValidMeld(meld.type, [...meld.cards, card])))
    // The all-addable escape is still a normal server-validated discard. Never
    // force a move or manufacture a finished round when no unrestricted card exists.
    const choices = unrestricted.length ? unrestricted : me.hand
    const selected = discardPolicy.choose(id, view.round, me.hand, choices, view.contract, down)
    await perform(id, 'discard', { cardId: selected.id })
  }
  checkRound()
  assert.equal(rounds.length, 7)
  const final = h.view(hostId)
  return { actions, rounds, eventCounts, repeatedHands: discardPolicy.repeatedHands, privateViewChecks, finalScores: final.players.map(player => ({ id: player.id, name: player.name, score: player.score })) }
}
