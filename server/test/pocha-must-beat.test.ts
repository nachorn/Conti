import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import { createPochaHandState, applyPochaAction, publicPochaState } from '../src/game/pocha/pochaEngine.js'
import type { PochaCard, SpanishSuit } from '../src/game/pocha/pochaTypes.js'

const card = (rank: number, suit: SpanishSuit = 'oros'): PochaCard => ({ id: suit + rank, suit, rank })
const players = Array.from({length: 5}, (_, i) => ({id: 'p' + i, name: 'Bot ' + (i + 1), score: 0, connected: true, seatIndex: i}))

test('five players: 10 of coins forces 11, rejects 4 without changing the table', () => {
  for (const trump of ['oros', 'copas'] as const) {
    const s = createPochaHandState('beat', players, 2, 4, 40, {mode:'normal',maxCards:2,oneCardRounds:1,peakRounds:1})
    s.phase = 'playing'; s.trump = trump
    s.players[0].hand = [card(10), card(2, 'bastos')]
    s.players[1].hand = [card(11), card(4)]
    assert.equal(applyPochaAction(s, 'p0', {type:'play',cardId:'oros10'}).ok, true)
    assert.deepEqual(publicPochaState(s, 'p1').legalCardIds, ['oros11'])
    const before = structuredClone(s)
    assert.equal(applyPochaAction(s, 'p1', {type:'play',cardId:'oros4'}).ok, false)
    assert.deepEqual(s, before)
    assert.equal(applyPochaAction(s, 'p1', {type:'play',cardId:'oros11'}).ok, true)
  }
})

test('five players: overtrump is required; an unbeatable higher coin permits either lower coin', () => {
  const s = createPochaHandState('beat', players, 2, 4, 40, {mode:'normal',maxCards:2,oneCardRounds:1,peakRounds:1})
  s.phase = 'playing'; s.trump = 'oros'; s.currentPlayerIndex = 2
  s.players[2].hand = [card(11), card(4)]
  s.currentTrick = [{playerId:'p0',card:card(10,'espadas')},{playerId:'p1',card:card(10)}]
  assert.deepEqual(publicPochaState(s,'p2').legalCardIds,['oros11'])
  assert.equal(applyPochaAction(s,'p2',{type:'play',cardId:'oros4'}).ok,false)
  s.currentTrick[1].card = card(12)
  assert.deepEqual(publicPochaState(s,'p2').legalCardIds,['oros11','oros4'])
})

test('two complete five-bot games: independently audit and attempt every forbidden card', t => {
  t.mock.timers.enable({apis:['Date'],now:Date.now()})
  // Seed the shuffle so the audit and its totals are repeatable.
  let seed = 19092026
  t.mock.method(Math, 'random', () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296 })
  // Independent oracle: rank list and winner search, without importing legalCards.
  const order = [2,4,5,6,7,8,9,10,11,12,3,1]
  let turns = 0, rejected = 0, mustBeat = 0, tricks = 0
  for (const mode of ['normal','subastada'] as const) {
    const room = new Room({roomId:'bots',gameType:'pocha'})
    players.forEach(p => room.addPlayer(p.id,p.name))
    assert.equal(room.startPochaGame({mode,maxCards:8,oneCardRounds:1,peakRounds:1}).ok,true)
    while(room.pocha!.phase !== 'game_end') {
      t.mock.timers.tick(4100)
      const s = room.pocha!, p = s.players[s.currentPlayerIndex]
      if(s.phase==='hand_end'){assert.equal(room.nextRound(),true);continue}
      if(s.phase==='auction'){assert.equal(room.pochaAction(p.id,{type:'auction',value:s.auction.length===0?1:s.auction.length===2?3:null}).ok,true);continue}
      if(s.phase==='choosing_trump'){assert.equal(room.pochaAction(p.id,{type:'trump',suit:'oros'}).ok,true);continue}
      if(s.phase==='bidding'){const value=publicPochaState(s,p.id).blockedBid===0?1:0;assert.equal(room.pochaAction(p.id,{type:'bid',value}).ok,true);continue}
      const led = s.currentTrick[0]?.card.suit
      const strength = (c:PochaCard) => (c.suit===s.trump?100:c.suit===led?50:0) + order.indexOf(c.rank)
      const follow = p.hand.filter(c=>c.suit===led), trump = p.hand.filter(c=>c.suit===s.trump)
      const mandatory = !led?p.hand:follow.length?follow:trump.length?trump:p.hand
      const best = Math.max(...s.currentTrick.map(tc=>strength(tc.card)))
      const beat = mandatory.filter(c=>(c.suit===s.trump||c.suit===led)&&strength(c)>best)
      const expected = !led?mandatory:beat.length?beat:mandatory
      assert.deepEqual([...publicPochaState(s,p.id).legalCardIds!].sort(),expected.map(c=>c.id).sort())
      if(led&&beat.length&&beat.length<mandatory.length)mustBeat++
      for(const c of p.hand.filter(c=>!expected.includes(c))) {
        const before=room.toSnapshot()
        assert.equal(room.pochaAction(p.id,{type:'play',cardId:c.id}).ok,false)
        assert.deepEqual(room.toSnapshot(),before);rejected++
      }
      const choice=expected[Math.floor(Math.random()*expected.length)]
      assert.equal(room.pochaAction(p.id,{type:'play',cardId:choice.id}).ok,true);turns++
    }
    tricks+=room.pocha!.history.reduce((sum,h)=>sum+h.cardsPerHand,0)
    assert.equal(room.pocha!.history.length,15)
  }
  assert.ok(mustBeat>0);assert.ok(rejected>0)
  t.diagnostic(JSON.stringify({games:2,players:5,rounds:30,tricks,turns,mustBeat,rejected}))
})
