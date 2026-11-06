import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../../src/08_ai.js', import.meta.url), 'utf8');
const war3Source = fs.readFileSync(new URL('../../src/08k_war3.js', import.meta.url), 'utf8');
const campaignSource = fs.readFileSync(new URL('../../src/08g_campaign.js', import.meta.url), 'utf8');
function invokeFrom(source, name, context, ...args) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  const end = source.indexOf('\nfunction ', start + 10);
  const body = source.slice(start, end < 0 ? source.length : end);
  return new Function(...Object.keys(context), body + '\nreturn ' + name + ';')(...Object.values(context))(...args);
}
function invoke(name, context, ...args) { return invokeFrom(source, name, context, ...args); }
function garrison(hosted = true) {
  let paid = false, spawns = 0;
  const entities = new Map([[1, { alive: true }]]);
  const keep = { realm: 0, site: { yaw: 0, y: 0 }, lord: 1, guards: new Set(), slots: { lord: [0, 0, 0], walls: [], court: [[0, 0, 0]] } };
  const context = {
    realmPublicWorksHosted: () => hosted, realmPublicWorksRecruiting: () => paid,
    warUnitLevel: () => 1, getEnt: id => entities.get(id), siteWorld: () => ({ x: 0, y: 0, z: 0 }),
    spawnRealmUnit: () => { const e = { id: ++spawns + 1, alive: true, ai: {} }; entities.set(e.id, e); return e; },
    castleRoute: () => null, setupStats: () => {}, loopsLord: () => assert.fail('no unpaid lord should be needed'),
  };
  return { keep, context, pay: () => { paid = true; }, count: () => spawns };
}
test('hosted garrison needs a funded grant and does not duplicate its occupied slot', () => {
  const f = garrison();
  invoke('fillGarrison', f.context, f.keep, false); assert.equal(f.count(), 0);
  invoke('fillGarrison', f.context, f.keep, true); assert.equal(f.count(), 0);
  f.pay(); invoke('fillGarrison', f.context, f.keep, false); assert.equal(f.count(), 1);
  invoke('fillGarrison', f.context, f.keep, false); assert.equal(f.count(), 1);
});
test('solo garrison behavior remains available', () => {
  const f = garrison(false); invoke('fillGarrison', f.context, f.keep, false); assert.equal(f.count(), 1);
});
function war(funded, alive) {
  let tick = 0, refill = 0, rebuilt = 0;
  const door = { alive, hp: alive ? 50 : 0, maxHp: 100, lastHitAt: 0, deadAt: 0 };
  const keep = { id: 0, realm: 0, orig: 0, site: { x: 0, z: 0, name: 'Keep' }, door, lastEnemyNear: 0, nextGuardAt: 0, underSiegeUntil: 0 };
  const context = {
    GAME: { t: 100, player: { faction: 0 } }, WAR: { commanders: [], warbands: [], keeps: [keep], temples: [] }, CAMPS: [],
    realmPublicWorksKeepTick: () => { tick++; return funded; }, forNear: () => {}, isActor: () => true, war4Allied: () => false,
    news: () => {}, sndKeepAlarm: () => {}, war4GateMends: () => false,
    setDoorState: d => { rebuilt++; d.alive = true; }, loopsTrickleOk: () => true, war4Trickle: () => refill++,
    updateRelics: () => {}, updateWar2: () => {}, updateWar3: () => {}, updateWar4: () => {}, updateCampaign: () => {},
  };
  invoke('updateWar', context, 1); return { door, tick, refill, rebuilt };
}
test('hosted upkeep cannot heal, rebuild, or replenish for free', () => {
  const live = war(true, true), dead = war(true, false);
  assert.equal(live.tick, 1); assert.equal(live.door.hp, 50); assert.equal(live.refill, 0);
  assert.equal(dead.door.alive, false); assert.equal(dead.rebuilt, 0); assert.equal(dead.refill, 0);
});
test('solo keep repairs and replenishment retain their original behavior', () => {
  const live = war(false, true), dead = war(false, false);
  assert.equal(live.door.hp, 51.5); assert.equal(live.refill, 1);
  assert.equal(dead.door.alive, true); assert.equal(dead.rebuilt, 1); assert.equal(dead.refill, 1);
});
test('paid-asset projection runs before actor AI and reset clears runtime projection first', () => {
  const order = [];
  invoke('updateNPCs', { GAME: { player: null }, ENT: [{ role: 'remote' }],
    realmPublicWorksFrame: dt => order.push('frame:' + dt), netRemoteStep: () => order.push('AI') }, 0.1);
  assert.deepEqual(order, ['frame:0', 'AI']);
  order.length = 0;
  invoke('initWar', { REALMS: [], realmPublicWorksReset: () => order.push('reset'),
    updateRelicBonuses: () => order.push('bootstrap') });
  assert.deepEqual(order, ['reset', 'bootstrap']);
});

function wallReset(hosted) {
  let repairs = 0, uploads = 0;
  const walls = [{state:'broken',wreck:{visible:true}}, {state:'burnt',wreck:{visible:true}}];
  const context = {
    realmPublicWorksHosted: () => hosted, war4Reset: () => {},
    SIEGE: {engines:[]}, CASTLES: [{sections:walls}], WAR: {keeps:[],warbands:[]}, W3: {},
    castleRepairDone: wall => { wall.state='whole';repairs++; }, castleCutUpload: () => uploads++,
  };
  invokeFrom(war3Source, 'war3Reset', context);
  return {walls,repairs,uploads};
}
test('hosted short campaign reset preserves damaged walls without another paid grant', () => {
  const state=wallReset(true);
  assert.equal(state.repairs,0);assert.equal(state.uploads,0);
  assert.deepEqual(state.walls.map(w=>w.state),['broken','burnt']);
  assert.ok(state.walls.every(w=>w.wreck.visible));
});
test('solo short campaign reset still restores castle walls', () => {
  const state=wallReset(false);
  assert.equal(state.repairs,2);assert.equal(state.uploads,1);
  assert.ok(state.walls.every(w=>w.state==='whole'&&!w.wreck.visible));
});
function restoreFixture(hosted, stays=false) {
  const actors=new Map([[3,{id:3,alive:true,x:0,y:0,z:0}],[4,{id:4,alive:true,x:0,y:0,z:0}]]);
  const keep={realm:1,orig:0,lord:4,guards:new Set([3]),site:{x:0,y:0,z:0},
    door:{alive:true,hp:17,maxHp:100},underSiegeUntil:88,lastOwnerChange:44};
  let fills=0,removed=0,reads=0;
  const context={realmPublicWorksHosted:()=>hosted,seasonKeepStays:()=>{reads++;return stays;},
    getEnt:id=>actors.get(id),removeEnt:e=>{removed++;actors.delete(e.id);},FX:{burst:()=>{}},
    setSiteBanners:()=>{},fillGarrison:()=>fills++,REALMS:[{rgb:[1,1,1]},{rgb:[1,1,1]}],
    later:()=>{},GAME:{t:100},setDoorState:(d,on,ratio)=>{d.alive=on;d.hp=d.maxHp*ratio;}};
  return {keep,context,count:()=>({fills,removed,reads})};
}
test('hosted restore preserves live conquest, troops and gate damage despite an older cached owner', () => {
  const f=restoreFixture(true), before=JSON.parse(JSON.stringify({...f.keep,guards:[...f.keep.guards]}));
  invokeFrom(campaignSource,'restoreKeep',f.context,f.keep);
  assert.deepEqual(JSON.parse(JSON.stringify({...f.keep,guards:[...f.keep.guards]})),before);
  assert.deepEqual(f.count(),{fills:0,removed:0,reads:0});
});
test('solo restore retains both original-owner and season-held keep behavior', () => {
  for(const stays of [false,true]){
    const f=restoreFixture(false,stays);invokeFrom(campaignSource,'restoreKeep',f.context,f.keep);
    assert.equal(f.keep.realm,stays?1:0);assert.equal(f.keep.door.hp,100);assert.equal(f.count().fills,1);
    assert.equal(f.count().removed,stays?0:2);
  }
});
test('a short campaign does not erase the already spent public-work ledger', () => {
  let resets=0;const ledger={spent:[{keep:0,owner:1,kind:'gate',units:1}],armies:[{id:'7',spent:1}]};
  const before=JSON.stringify(ledger);
  const context={realmPublicWorksReset:()=>{resets++;ledger.spent=[];ledger.armies=[];},
    war3Reset:()=>{},WAR:{keeps:[],relics:[],temples:[],warbands:[]},seasonAfterReset:()=>{},
    CAMPAIGN:{n:1,claims:[]},GAME:{t:100},updateRelicBonuses:()=>{},newStory:()=>({}),
    news:()=>{},ordinalWord:String,seasonKeepsHeld:()=>true,sfx:()=>{},saveSoon:()=>{}};
  invokeFrom(campaignSource,'resetMarch',context);
  assert.equal(resets,0);assert.equal(JSON.stringify(ledger),before);
});
