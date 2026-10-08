import assert from 'node:assert/strict'
import test from 'node:test'
import { Room } from '../src/room.js'
import { createPochaHandState, applyPochaAction, dealerBidsBlocked, publicPochaState, startPocha, nextPochaRound } from '../src/game/pocha/pochaEngine.js'
import { legalCards, roundSchedule, scoreHand, winningCard, defaultPochaSettings } from '../src/game/pocha/pochaRules.js'
import type { PochaCard, PochaGameState, PochaAction, SpanishSuit } from '../src/game/pocha/pochaTypes.js'
const card=(suit:SpanishSuit,rank:number):PochaCard=>({id:suit+rank,suit,rank})
const trick=(...cards:PochaCard[])=>cards.map((card,i)=>({playerId:'p'+i,card}))
const players=(n:number)=>Array.from({length:n},(_,i)=>({id:'p'+i,name:'Jugador '+i,seatIndex:i,score:0,connected:true}))
const currentId=(s:PochaGameState)=>s.players[s.currentPlayerIndex].id
const act=(s:PochaGameState,a:PochaAction)=>assert.deepEqual(applyPochaAction(s,currentId(s),a),{ok:true})
const values=(cards:PochaCard[])=>cards.map(c=>c.id).sort()

test('exact predictions, zero and symmetric penalties',()=>{
  for(const [bid,won,score] of [[0,0,5],[3,3,11],[3,2,-2],[3,1,-4],[3,4,-2],[0,8,-16]]) assert.equal(scoreHand(bid,won),score)
})
test('default/custom pyramids, one-card block and invalid settings',()=>{
  const normal=roundSchedule(defaultPochaSettings(5,40),5,40)
  assert.equal(normal.length,27); assert.equal(normal.filter(n=>n===8).length,5)
  assert.deepEqual(roundSchedule({mode:'normal',maxCards:6,oneCardRounds:3,peakRounds:3},5,40),[1,1,1,2,3,4,5,6,6,6,5,4,3,2,1,1,1])
  assert.deepEqual(roundSchedule({mode:'normal',maxCards:1,oneCardRounds:3,peakRounds:5},5,40),[1,1,1])
  for(const patch of [{maxCards:9},{oneCardRounds:6},{peakRounds:0},{maxCards:NaN},{mode:'bad'}]) assert.throws(()=>roundSchedule({...defaultPochaSettings(5,40),...patch} as any,5,40))
})
test('follow suit and beat if possible, without forcing the highest card',()=>{
  const hand=[card('espadas',1),card('espadas',11),card('espadas',5),card('oros',8)]
  assert.deepEqual(values(legalCards(hand,trick(card('espadas',10)),'oros')),['espadas1','espadas11'])
  assert.deepEqual(values(legalCards(hand,trick(card('espadas',10),card('oros',2)),'oros')),['espadas1','espadas11','espadas5'])
})
test('may discard when unable to overtrump, but must overtrump when possible',()=>{
  const played=trick(card('espadas',10),card('oros',12))
  assert.deepEqual(values(legalCards([card('oros',5),card('oros',7),card('copas',1)],played,'oros')),['copas1','oros5','oros7'])
  assert.deepEqual(values(legalCards([card('oros',1),card('oros',3),card('oros',7),card('copas',1)],played,'oros')),['oros1','oros3'])
  assert.deepEqual(values(legalCards([card('copas',1),card('bastos',2)],played,'oros')),['bastos2','copas1'])
})
test('three of coins permits discarding a cup instead of an inferior ten of coins',()=>{
  const played=trick(card('bastos',7),card('oros',3))
  const hand=[card('oros',10),card('copas',1)]
  assert.deepEqual(values(legalCards(hand,played,'oros')),values(hand))
  assert.deepEqual(values(legalCards([...hand,card('oros',1)],played,'oros')),['oros1'])
})
test('discard exception never removes following suit, including a trump lead',()=>{
  const hand=[card('bastos',2),card('oros',10),card('copas',1)]
  assert.deepEqual(values(legalCards(hand,trick(card('bastos',7),card('oros',3)),'oros')),['bastos2'])
  assert.deepEqual(values(legalCards(hand,trick(card('oros',3)),'oros')),['oros10'])
})
test('without the led suit a player must trump while the winner is not a trump',()=>{
  const hand=[card('oros',2),card('oros',10),card('copas',1)]
  assert.deepEqual(values(legalCards(hand,trick(card('bastos',1),card('espadas',1)),'oros')),['oros10','oros2'])
})
test('unbeatable trump discard applies to every trump suit, including 48-card ranks',()=>{
  const suits:SpanishSuit[]=['oros','copas','espadas','bastos']
  for(let i=0;i<suits.length;i++){
    const trump=suits[i],led=suits[(i+1)%4],discard=suits[(i+2)%4]
    const hand=[card(trump,8),card(trump,9),card(discard,1)]
    const played=trick(card(led,12),card(trump,10))
    assert.deepEqual(values(legalCards(hand,played,trump)),values(hand))
    assert.deepEqual(values(legalCards([...hand,card(trump,11)],played,trump)),[trump+'11'])
  }
})

test('each seat can open a new game without moving seats or changing the host, then the lead rotates',()=>{
  for(const n of [2,3,5,10])for(const deck of [32,36,40,48] as const)for(const mode of ['normal','subastada'] as const){
    const settings={mode,maxCards:1,oneCardRounds:2,peakRounds:1}
    for(let dealer=0;dealer<n;dealer++){
      const s=createPochaHandState('random',players(n),1,n-1,deck,settings)
      s.players.reverse()
      s.hostId='p1'
      s.players.forEach(p=>{p.score=99})
      let randomCalls=0
      startPocha(s,settings,()=>{randomCalls++;return (dealer+.5)/n})
      const lead=(dealer+1)%n
      assert.equal(randomCalls,1)
      assert.equal(s.dealerIndex,dealer)
      assert.equal(s.originalLeadPlayerIndex,lead)
      assert.equal(s.leadPlayerIndex,lead)
      assert.equal(s.currentPlayerIndex,lead)
      assert.equal(s.phase,mode==='subastada'?'auction':'bidding')
      assert.equal(s.hostId,'p1')
      assert.deepEqual(s.players.map(p=>p.id),players(n).map(p=>p.id))
      assert.ok(s.players.every(p=>p.score===0))
      s.phase='hand_end'
      nextPochaRound(s)
      assert.equal(s.originalLeadPlayerIndex,(lead+1)%n)
      assert.equal(s.dealerIndex,(dealer+1)%n)
      assert.equal(s.hostId,'p1')
    }
  }
})

test('a rematch draws its opening lead again and restored games retain their existing lead',(t)=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()})
  let random=0
  t.mock.method(Math,'random',()=>random)
  const room=new Room({roomId:'rematch',gameType:'pocha'})
  players(2).forEach(p=>room.addPlayer(p.id,p.name))
  const settings={mode:'normal' as const,maxCards:1,oneCardRounds:1,peakRounds:1}
  assert.deepEqual(room.startPochaGame(settings),{ok:true})
  assert.equal(room.pocha!.currentPlayerIndex,1)
  let restored=Room.fromSnapshot(room.toSnapshot(),{disconnectPlayers:false})
  assert.equal(restored.pocha!.currentPlayerIndex,1)
  for(let i=0;i<2;i++)assert.deepEqual(restored.pochaAction(currentId(restored.pocha!),{type:'bid',value:0}),{ok:true})
  for(let i=0;i<2;i++){
    const id=currentId(restored.pocha!)
    assert.deepEqual(restored.pochaAction(id,{type:'play',cardId:publicPochaState(restored.pocha!,id).legalCardIds![0]}),{ok:true})
  }
  assert.equal(restored.pocha!.phase,'game_end')
  t.mock.timers.tick(4000)
  assert.equal(restored.rematch(),true)
  assert.equal(restored.pocha!.phase,'lobby')
  random=1-Number.EPSILON
  assert.deepEqual(restored.startPochaGame(settings),{ok:true})
  assert.equal(restored.pocha!.currentPlayerIndex,0)
  assert.equal(restored.pocha!.hostId,'p0')
  assert.deepEqual(restored.pocha!.history,[])
  restored=Room.fromSnapshot(restored.toSnapshot(),{disconnectPlayers:false})
  assert.equal(restored.pocha!.currentPlayerIndex,0)
})
test('trump beats led suit; other suits cannot win; 48-card order',()=>{
  assert.equal(winningCard(trick(card('espadas',1),card('oros',2)),'oros')!.card.id,'oros2')
  assert.equal(winningCard(trick(card('espadas',5),card('copas',1),card('espadas',7)),'oros')!.card.id,'espadas7')
  const order=[1,3,12,11,10,9,8,7,6,5,4,2]
  for(let i=0;i<order.length-1;i++) assert.equal(winningCard(trick(card('copas',order[i+1]),card('copas',order[i])),'oros')!.card.rank,order[i])
})
test('last prediction forbids zero when already exact; no restriction when over',()=>{
  assert.equal(dealerBidsBlocked(4,{a:4},'b'),0); assert.equal(dealerBidsBlocked(4,{a:3},'b'),1); assert.equal(dealerBidsBlocked(4,{a:5},'b'),null)
})
test('normal full deal exposes dealer last card; auction mode also auctions partial peaks',()=>{
  const settings={mode:'normal' as const,maxCards:8,oneCardRounds:1,peakRounds:1}
  const s=createPochaHandState('1234',players(5),8,4,40,settings)
  assert.equal(s.trumpCard!.id,s.players[4].hand.at(-1)!.id); assert.equal(new Set(s.players.flatMap(p=>p.hand.map(c=>c.id))).size,40)
  const a=createPochaHandState('1234',players(5),8,4,40,{...settings,mode:'subastada'})
  assert.equal(a.phase,'auction'); assert.equal(a.trumpCard,null)
  assert.equal(createPochaHandState('1234',players(5),6,4,40,{...settings,maxCards:6,mode:'subastada'}).phase,'auction')
})
test('single-pass auction binds winner and changes final prediction player',()=>{
  const s=createPochaHandState('1234',players(5),8,4,40,{mode:'subastada',maxCards:8,oneCardRounds:1,peakRounds:1})
  assert.equal(applyPochaAction(s,'p0',{type:'auction',value:null}).ok,false)
  act(s,{type:'auction',value:2});act(s,{type:'auction',value:null})
  assert.equal(applyPochaAction(s,'p2',{type:'auction',value:2}).ok,false)
  act(s,{type:'auction',value:4});act(s,{type:'auction',value:null});act(s,{type:'auction',value:null})
  assert.equal(s.phase,'choosing_trump');assert.equal(currentId(s),'p2');assert.equal(s.bids.p2,4)
  assert.equal(applyPochaAction(s,'p0',{type:'auction',value:5}).ok,false)
  act(s,{type:'trump',suit:'oros'});assert.equal(currentId(s),'p3')
  for(let i=0;i<3;i++)act(s,{type:'bid',value:0})
  assert.equal(currentId(s),'p1');assert.equal(applyPochaAction(s,'p1',{type:'bid',value:4}).ok,false)
  act(s,{type:'bid',value:0});assert.equal(currentId(s),'p2')
})
test('zero opening offer wins if everyone passes',()=>{
  const s=createPochaHandState('1234',players(5),8,4,40,{mode:'subastada',maxCards:8,oneCardRounds:1,peakRounds:1})
  act(s,{type:'auction',value:0});for(let i=1;i<5;i++)act(s,{type:'auction',value:null})
  assert.equal(s.auctionWinnerId,'p0');assert.equal(s.bids.p0,0)
})
test('public state has own cards and opponent counts without private cards',()=>{
  const s=createPochaHandState('1234',players(5),2,4)
  const visible=publicPochaState(s,'p0')
  assert.equal(visible.players[0].hand.length,1);assert.equal(visible.players[1].hand.length,0);assert.equal(visible.players[1].handCount,1)
  assert.ok(!JSON.stringify(visible).includes(s.players[1].hand[0].id))
  visible.players[0].hand.length=0;assert.equal(s.players[0].hand.length,1)
})
test('72 complete games: four decks, both modes, every player count 2–10, snapshot every move and correct totals',(t)=>{
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  for(const deckSize of [32,36,40,48] as const)for(const n of [2,3,4,5,6,7,8,9,10])for(const mode of ['normal','subastada'] as const){
    let room=new Room({roomId:'1234',gameType:'pocha',pochaDeckSize:deckSize});players(n).forEach(p=>room.addPlayer(p.id,p.name))
    assert.ok(room.startPochaGame({mode,maxCards:Math.floor(deckSize/n),oneCardRounds:1,peakRounds:1}).ok)
    let actions=0,observedRound=0
    const allowedRanks=deckSize===48?[1,2,3,4,5,6,7,8,9,10,11,12]:deckSize===40?[1,2,3,4,5,6,7,10,11,12]:deckSize===36?[1,2,3,5,6,7,10,11,12]:[1,3,5,6,7,10,11,12]
    while(room.phase!=='game_end'&&actions++<4000){
      t.mock.timers.tick(4000)
      const s=room.pocha!,id=currentId(s)
      assert.equal(s.deckSize,deckSize)
      if(s.handNumber!==observedRound){
        observedRound=s.handNumber
        const all=s.players.flatMap(p=>p.hand)
        assert.equal(all.length,n*s.cardsPerHand)
        assert.equal(new Set(all.map(c=>c.suit+':'+c.rank)).size,all.length)
        assert.ok(all.every(c=>allowedRanks.includes(c.rank)))
        assert.ok(s.cardsPerHand<=Math.floor(deckSize/n))
        if(s.trumpCard){
          assert.ok(allowedRanks.includes(s.trumpCard.rank))
          if(all.length===deckSize)assert.equal(s.trumpCard.id,s.players[s.dealerIndex].hand.at(-1)!.id)
          else assert.ok(!all.some(c=>c.id===s.trumpCard!.id))
        }
      }
      if(s.phase==='hand_end'){const original=s.originalLeadPlayerIndex;assert.ok(room.nextRound());assert.equal(room.pocha!.originalLeadPlayerIndex,(original+1)%n)}
      else{
        let action:PochaAction
        if(s.phase==='auction')action={type:'auction',value:s.auction.length===0?0:s.auction.length===2?2:null}
        else if(s.phase==='choosing_trump')action={type:'trump',suit:'oros'}
        else if(s.phase==='bidding')action={type:'bid',value:publicPochaState(s,id).blockedBid===0?1:0}
        else action={type:'play',cardId:publicPochaState(s,id).legalCardIds![0]}
        assert.equal(room.pochaAction(id,action).ok,true)
      }
      room=Room.fromSnapshot(room.toSnapshot(),{disconnectPlayers:false})
    }
    assert.equal(room.phase,'game_end');assert.equal(room.pocha!.history.length,room.pocha!.schedule.length)
    for(const h of room.pocha!.history){
      assert.equal(h.players.reduce((sum,p)=>sum+p.tricksWon,0),h.cardsPerHand)
      for(const p of h.players)assert.equal(p.points,p.bid===p.tricksWon?5+2*p.tricksWon:-2*Math.abs(p.bid-p.tricksWon))
    }
    for(const p of room.pocha!.players)assert.equal(p.score,room.pocha!.history.reduce((sum,h)=>sum+h.players.find(q=>q.id===p.id)!.points,0))
    const settingsBeforeRematch=structuredClone(room.pocha!.settings)
    t.mock.timers.tick(4000);assert.ok(room.rematch());assert.equal(room.pocha!.phase,'lobby')
    assert.equal(room.pocha!.deckSize,deckSize)
    assert.equal(room.pocha!.lobbyConfigured,true)
    assert.deepEqual(room.pocha!.settings,settingsBeforeRematch)
  }
})
test('reject invalid moves without mutation, strip junk saves, reset to lobby on leaving',()=>{
  const room=new Room({roomId:'1234',gameType:'pocha'});players(3).forEach(p=>room.addPlayer(p.id,p.name))
  room.startPochaGame({mode:'normal',maxCards:2,oneCardRounds:1,peakRounds:1});const before=room.toSnapshot()
  const id=currentId(room.pocha!),other=room.pocha!.players.find(p=>p.id!==id)!.id
  assert.equal(room.pochaAction(other,{type:'bid',value:1}).ok,false);assert.equal(room.pochaAction(id,{type:'bid',value:NaN}).ok,false);assert.deepEqual(room.toSnapshot(),before)
  const raw=room.toSnapshot();(raw.pocha as any).secret='never publish';assert.equal((Room.fromSnapshot(raw).pocha as any).secret,undefined)
  raw.pocha!.players[0].hand[0].suit='bad' as any;assert.throws(()=>Room.fromSnapshot(raw))
  room.removePlayer('p0');assert.equal(room.pocha!.phase,'lobby');assert.equal(room.pocha!.hostId,'p1');assert.doesNotThrow(()=>Room.fromSnapshot(room.toSnapshot()))
})

test('completed trick is readable for four seconds, rejects early moves, then lets its winner lead',()=>{
  const s=createPochaHandState('1234',players(2),2,1,40,{mode:'normal',maxCards:2,oneCardRounds:1,peakRounds:1})
  s.trump='oros'
  s.players[0].hand=[card('espadas',10),card('espadas',2)]
  s.players[1].hand=[card('espadas',11),card('espadas',4)]
  act(s,{type:'bid',value:0});act(s,{type:'bid',value:0})
  assert.ok(applyPochaAction(s,'p0',{type:'play',cardId:'espadas10'},1000).ok)
  assert.ok(applyPochaAction(s,'p1',{type:'play',cardId:'espadas11'},1000).ok)
  assert.equal(s.trickReviewUntil,5000)
  assert.equal(s.lastTrick!.cards.length,2)
  assert.equal(s.lastTrick!.winnerId,'p1')
  assert.equal(s.players[1].tricksWon,1)
  const before=structuredClone(s)
  assert.equal(applyPochaAction(s,'p1',{type:'play',cardId:'espadas4'},4999).ok,false)
  assert.deepEqual(s,before)
  assert.ok(applyPochaAction(s,'p1',{type:'play',cardId:'espadas4'},5000).ok)
  assert.equal(s.currentTrick[0].playerId,'p1')
  assert.deepEqual(s.lastTrick,before.lastTrick)
  assert.equal(s.players[1].tricksWon,1)
})

test('last trick review survives snapshots and blocks early next-round/rematch actions',(t)=>{
  t.mock.timers.enable({apis:['Date'],now:Date.now()})
  for(const single of [false,true]) {
    let room=new Room({roomId:'1234',gameType:'pocha'})
    players(2).forEach(p=>room.addPlayer(p.id,p.name))
    room.startPochaGame({mode:'normal',maxCards:single?1:2,oneCardRounds:1,peakRounds:1})
    for(let i=0;i<2;i++)assert.equal(room.pochaAction(currentId(room.pocha!),{type:'bid',value:0}).ok,true)
    for(let i=0;i<2;i++) {
      const id=currentId(room.pocha!)
      room.pochaAction(id,{type:'play',cardId:room.getState(id).pocha!.legalCardIds![0]})
    }
    const until=room.pocha!.trickReviewUntil
    room=Room.fromSnapshot(room.toSnapshot(),{disconnectPlayers:false})
    assert.equal(room.pocha!.trickReviewUntil,until)
    assert.equal(room.getState('p0').pocha!.lastTrick!.cards.length,2)
    assert.equal(single?room.rematch():room.nextRound(),false)
    t.mock.timers.tick(4000)
    assert.equal(single?room.rematch():room.nextRound(),true)
    assert.equal(room.pocha!.trickReviewUntil,null)
  }
})

test('old Pocha snapshots without review timing remain recoverable',()=>{
  const room=new Room({roomId:'1234',gameType:'pocha'})
  players(2).forEach(p=>room.addPlayer(p.id,p.name))
  const old=room.toSnapshot()
  delete old.pocha!.trickReviewUntil
  assert.equal(Room.fromSnapshot(old).pocha!.trickReviewUntil,null)
  old.pocha!.trickReviewUntil=-1
  assert.throws(()=>Room.fromSnapshot(old))
})
