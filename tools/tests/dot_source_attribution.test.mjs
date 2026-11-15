import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
function declaration(source, name) {
  const node = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body
    .find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name); return source.slice(node.start, node.end);
}
function fixture() {
  const nodes = new Map(['death', 'death-by', 'btn-release'].map(id => [id, { hidden: true, textContent: '', focus() {} }]));
  const c = vm.createContext({ Math: Object.create(Math), Map, Set, nodes });
  vm.runInContext(`
    const player={id:1,name:'Recruit',kind:'humanoid',role:'player',level:1,faction:0,alive:true,hp:100,maxHp:100,
      x:1000,y:0,z:0,drBase:.2,buffs:[],anim:{act:1}};
    const attacker={id:2,name:'Aldric',kind:'humanoid',role:'guard',cls:'priest',level:20,faction:2,alive:true,x:1001,y:0,z:0,netEntityId:'scene:guard:2'};
    const GAME={t:20,player,prog:{deaths:0}},ENT_BY_ID=new Map([[1,player],[2,attacker]]),UI={},INPUT={keys:new Set()},sources=[];
    const REALMS=[{name:'Logres',townName:'Caer'},{name:'Eriu'},{name:'Thule'}],R_RING=500;
    const NET_ENTITIES={rewards:new Set(),applying:false},NET_BUFFS={burn:[1,8],dot:[1,8]},BAL={};
    let treaty=false,legacyBlocked=false;
    const getEnt=id=>ENT_BY_ID.get(id)||null,netEntityFind=id=>[...ENT_BY_ID.values()].find(e=>e.netEntityId===id)||null;
    const netEntityFallResult=()=>false,netEntityOwnPet=()=>false,isEnemy=(a,b)=>a.faction!==b.faction;
    const realmManualHostileBuff=kind=>['burn','dot','bleed','stun','snare','root'].includes(kind);
    const realmManualCeasefire=(src,dst)=>treaty&&src?.role!=='bot'&&src?.faction===2,realmManualLegacyDotBlocked=()=>legacyBlocked;
    const giftBuffAdjust=(e,k,value,dur)=>({value,dur}),ccAdjust=(e,k,dur)=>dur,ladderOnStun=()=>{};
    const $=id=>nodes.get(id),inDungeon=()=>false,buildBedSpot=()=>null,uiFloatAt=()=>{},uiLog=()=>{},capFirst=s=>s.charAt(0).toUpperCase()+s.slice(1),flashScreen=()=>{};
    const sfx=()=>{},activityRecord=()=>{},netSheetToggle=()=>{},netChatClose=()=>{},buffMax=()=>0;
    const giftHarmMult=()=>1,gearLateHarm=()=>1,late2HarmMult=()=>1,loopsHarmMult=()=>1,survivalHarmMult=()=>1,towerSightBlocked=()=>false;
    function classHarm(src,dst,amount){sources.push({name:src?.name,level:src?.level,faction:src?.faction,id:src?.id});return amount}
    const sndShieldBroke=()=>{},setAct=()=>{},onImpact=()=>{},wearOnHit=()=>{},brandOnHit=()=>{},classOnHit=()=>{},ladderOnHit=()=>{};
    const activityEntityEvent=()=>{},deathEffects=()=>{},burnFlames=()=>{},baseDmg=L=>6+3*L;
    Math.random=()=>.9;
  ` + ['netEntitySourceStamp', 'netEntitySourceRead', 'netEntityAreaAccept', 'netEntityResult'].map(n => declaration(read('14x_netentities.js'), n)).join('\n')
    + '\n' + ['addBuff', 'tickBuffs', 'dealDamage', 'killEnt'].map(n => declaration(read('07_entities.js'), n)).join('\n')
    + '\n' + ['theName', 'onDamageFeedback', 'uiDeathDamage', 'uiDeath'].map(n => declaration(read('10_ui.js'), n)).join('\n')
    + '\n' + declaration(read('09_player.js'), 'onPlayerDeath')
    + '\n' + declaration(read('08_ai.js'), 'onEntityKilled'), c);
  return { run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)), nodes };
}

test('an accepted local burn retains the removed caster identity and faction for its fatal tick', () => {
  const f = fixture();
  f.run(`addBuff(player,'burn',180,3,attacker.id,{area:{v:1,shape:'disc',x:0,z:0,r:1}});const buff=player.buffs[0];ENT_BY_ID.delete(2);GAME.t=21;tickBuffs(player,.05)`);
  assert.equal(f.run('buff.sourceFaction'), 2);
  assert.equal(f.run('buff.sourceActor.name'), 'Aldric');
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by Aldric (level 20) of Thule. Final hit: 144 damage over time.');
  assert.equal(f.run('sources.length'), 1, 'the accepted tick receives mitigation exactly once');
});

test('the actual removed-caster buff receipt passes bounded identity and enemy faction to later ticks', () => {
  const f = fixture();
  f.run(`const stamp=netEntitySourceStamp(attacker);ENT_BY_ID.delete(2);
    netEntityResult({id:'burn-receipt',kind:'buff',source:'scene:guard:2',sourceActor:stamp,buff:'burn',amount:180,dur:3});
    const buff=player.buffs[0];GAME.t=21;tickBuffs(player,.05)`);
  assert.equal(f.run('buff.src'), null);
  assert.equal(f.run('buff.sourceFaction'), 2, 'the null live entity ID must not infer the victim realm');
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by Aldric (level 20) of Thule. Final hit: 144 damage over time.');
});

test('a live caster wins over remembered metadata when its faction and identity change', () => {
  const f = fixture();
  f.run(`addBuff(player,'burn',180,3,2);attacker.name='Bran';attacker.level=5;attacker.faction=1;treaty=true;GAME.t=21;tickBuffs(player,.05)`);
  assert.equal(f.nodes.get('death-by').textContent, 'Slain by Bran (level 5) of Eriu. Final hit: 144 damage over time.');
});

test('a new treaty still suppresses accepted damage from a removed remembered caster', () => {
  const f = fixture();
  f.run(`addBuff(player,'burn',20,4,2);ENT_BY_ID.delete(2);treaty=true;GAME.t=21;tickBuffs(player,.05)`);
  assert.equal(f.run('player.hp'), 100);
  f.run('treaty=false;GAME.t=22;tickBuffs(player,.05)');
  assert.equal(f.run('player.hp'), 84);
  assert.equal(f.run('sources.length'), 1, 'the suppressed tick is consumed without a later catch-up hit');
});

test('malformed remembered identity and faction cannot forge a later damage source', () => {
  const f = fixture();
  f.run(`addBuff(player,'burn',20,3,999,{sourceActor:{name:'Forged',level:20,faction:999,kind:'humanoid',role:'guard'},sourceFaction:999});
    const buff=player.buffs[0];GAME.t=21;tickBuffs(player,.05)`);
  assert.equal(f.run('Object.hasOwn(buff,"sourceActor")'), false);
  assert.equal(f.run('buff.sourceFaction'), -1);
  assert.deepEqual(f.json('sources'), [{ name: 'Recruit', level: 1, faction: 0, id: 1 }]);
});

test('unattributed legacy damage still fails closed during its existing treaty recovery guard', () => {
  const f = fixture();
  f.run(`player.buffs.push({kind:'burn',value:20,until:24,src:999,tick:20,sourceActor:{bad:true}});legacyBlocked=true;GAME.t=21;tickBuffs(player,.05)`);
  assert.equal(f.run('player.hp'), 100);
  assert.equal(f.run('sources.length'), 0);
});

test('a removed arena bot keeps its existing treaty exclusion together with its remembered identity', () => {
  const f = fixture();
  f.run(`attacker.role='bot';addBuff(player,'burn',20,3,2);const buff=player.buffs[0];ENT_BY_ID.delete(2);treaty=true;GAME.t=21;tickBuffs(player,.05)`);
  assert.equal(f.run('buff.sourceFaction'), -2);
  assert.equal(f.run('player.hp'), 84);
});
