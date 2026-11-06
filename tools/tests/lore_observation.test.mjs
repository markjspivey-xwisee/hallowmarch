import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,InputEvent} from './lore_observation.fixture.mjs';

for(const action of['Accept bounty','Farewell'])test('a real fast '+action+' retains the herald deed until the normal modal-closed update',()=>{
 const f=fixture();f.interact();assert.equal(f.c.LORE.ev.herald,true);assert.deepEqual(f.c.GAME.prog.lore.done,[]);assert.equal(f.c.INV.potions,3);assert.equal(f.events.length,0);
 f.click(action);assert.equal(f.c.UI.modal,null);assert.deepEqual(f.c.GAME.prog.lore.done,[]);
 f.advance(.25);assert.deepEqual(f.c.GAME.prog.lore.done,['herald']);assert.equal(f.c.INV.potions,5);
 assert.deepEqual(f.events.map(e=>[e[0],e[1]]),[['path.completed','herald']]);
 if(action==='Accept bounty')assert(f.c.GAME.prog.bounty);
 for(let n=0;n<20;n++)f.advance(.25);f.interact();f.click('Farewell');f.advance(.25);
 assert.equal(f.c.INV.potions,5);assert.equal(f.events.length,1);
});

test('slow conversation records evidence without awards while open and does not renew input from observation',()=>{
 const f=fixture();f.interact();const activity=f.c.human.activity,publishes=f.publishes;
 for(let n=0;n<4;n++)f.advance(.25);
 assert.equal(f.c.UI.modal,'dialog');assert.deepEqual(f.c.GAME.prog.lore.done,[]);assert.equal(f.c.INV.potions,3);assert.equal(f.events.length,0);
 assert.equal(f.c.human.activity,activity);assert.equal(f.publishes,publishes);
 f.click('Farewell');f.advance(.25);assert.equal(f.events.length,1);
});

test('fresh trusted interaction after idle consumes the ordinary input-sync result without fabricating a lease',()=>{
 const f=fixture();assert.equal(f.c.netHumanLive(),false);f.interact();
 assert.equal(f.c.human.activity,1);assert.equal(f.publishes,1);assert.equal(f.c.netHumanLive(),true);assert.equal(f.c.LORE.ev.herald,true);
 f.click('Farewell');f.advance(.25);assert.equal(f.events.length,1);
});

for(const id of['prompt','t-use'])test('the actual '+id+' handler forwards its original event to the selected conversation',()=>{
 const f=fixture();f.use(id);assert.equal(f.c.UI.modal,'dialog');assert.equal(f.c.LORE.ev.herald,true);
 assert.equal(f.events.length,0);f.click('Farewell');f.advance(.25);assert.equal(f.events.length,1);
});

test('a closer non-herald interaction retains its original callback and cannot latch the unselected conversation',()=>{
 const f=fixture();let called=0;
 f.c.houseOffers=(player,offer)=>offer(.1,4,'Another actual interaction',function(){called++;assert.equal(arguments.length,0);});
 f.interact();assert.equal(called,1);assert.equal(f.c.UI.modal,null);assert.notEqual(f.c.LORE.ev.herald,true);f.advance(.25);assert.equal(f.events.length,0);
});

test('programmatic, fake, untrusted, stale-dispatch, wrong-control and idle conversations cannot create evidence',()=>{
 for(const mode of['direct','fake','untrusted','stale','wrong-control','wrong-key','idle']){
  const f=fixture();
  if(mode==='direct'){f.dispatch(new InputEvent('keydown',{code:'KeyW'}),()=>{});f.c.openHerald();}
  else{
   let event=new InputEvent('keydown',{target:f.node('body')});
   if(mode==='fake')event={type:'keydown',code:'KeyE',isTrusted:true,eventPhase:3};
   if(mode==='untrusted')event.isTrusted=false;
   if(mode==='wrong-key')event.code='KeyR';
   if(mode==='wrong-control')event=new InputEvent('click',{target:f.node('unrelated')});
   if(mode==='stale'){f.dispatch(new InputEvent('keydown',{code:'KeyW'}),()=>{});f.c.playerInteract(event);f.microtasks();}
   else f.dispatch(event,e=>f.c.playerInteract(e),{input:mode!=='idle'});
  }
  assert.notEqual(f.c.LORE.ev.herald,true,mode);f.c.closeDialog();for(let n=0;n<4;n++)f.advance(.25);
  assert.deepEqual(f.c.GAME.prog.lore.done,[],mode);assert.equal(f.events.length,0,mode);assert.equal(f.c.INV.potions,3,mode);
 }
});

test('foreign NPC, out-of-range and replaced owner/player/profile/reference scopes cannot latch a conversation',()=>{
 for(const change of['npc','range','account','host','profile','ref','key','native','player','prog','realm','hidden','focus','switching','wiping','reload','dead','unready']){
  const f=fixture(),event=new InputEvent('keydown',{target:f.node('body')});
  f.dispatch(event,e=>{
   if(change==='npc'){assert.equal(f.c.loreObservationScope(e,'herald',{name:'Foreign herald',x:0,z:1}),null);return;}
   if(change==='range'){f.c.GAME.player.x=1000;assert.equal(f.c.loreObservationScope(e,'herald',f.c.REALMS[0].herald),null);return;}
   const it=f.c.currentInteraction(e);assert(it);it.act();
   if(change==='account')f.c.NETWS.acct={id:'other'};if(change==='host')f.c.NETWS.host='other';
   if(change==='profile')f.c.NATIVE_PLAYER.profile={};if(change==='ref')f.c.SAVE.ref={};if(change==='key')f.c.SAVE.lsKey='other';if(change==='native')f.c.SAVE.native=true;
   if(change==='player')f.c.GAME.player={...f.c.GAME.player};if(change==='prog')f.c.GAME.prog={...f.c.GAME.prog};
   if(change==='realm')f.c.GAME.player.faction=1;if(change==='hidden')f.c.document.hidden=true;if(change==='focus')f.c.document.hasFocus=()=>false;
   if(change==='switching')f.c.NATIVE_PLAYER.switching=true;if(change==='wiping')f.c.SAVE.wiping=true;if(change==='reload')f.c.NETWS.worldReloadRequired=true;
   if(change==='dead')f.c.GAME.player.alive=false;if(change==='unready')f.c.GAME.ready=false;
  });
  assert.notEqual(f.c.LORE.ev.herald,true,change);assert.equal(f.events.length,0,change);assert.equal(f.c.INV.potions,3,change);
 }
});

test('a receipt is one use and cannot be forged from an unrelated object',()=>{
 const f=fixture();let receipt;
 f.dispatch(new InputEvent('keydown',{target:f.node('body')}),e=>{
  receipt=f.c.loreObservationScope(e,'herald',f.c.REALMS[0].herald);f.c.openHerald();
  assert.equal(f.c.loreObserve(receipt),true);assert.equal(f.c.loreObserve(receipt),false);assert.equal(f.c.loreObserve({...receipt}),false);
 });
 assert.equal(f.c.loreObserve(receipt),false);f.click('Farewell');f.advance(.25);assert.equal(f.events.length,1);
});
