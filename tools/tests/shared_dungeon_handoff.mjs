import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
const source=readFileSync(new URL('../../src/14x_netentities.js',import.meta.url),'utf8');
const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});
const names=['netEntityPlain','netEntityReference','netEntityDungeonTimers','netEntityDungeonMeta','netEntityApplyDungeon','netEntityLivePlayers'];
const SELECTED=names.map(name=>{const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,name);return source.slice(node.start,node.end);}).join('\n');
function dungeonPage(self='a', time=100, actorId=10) {
 const local={id:self==='a'?1:2,role:'player',alive:true,x:-1000,z:0},other={id:self==='a'?2:1,role:'remote',netPeer:self==='a'?'b':'a',alive:true,x:1200,z:0};
 const boss={id:actorId,role:'dungeonBoss',netEntityId:'scene:king:1',alive:true,hp:40,maxHp:100,x:1200,z:0,
  ai:{awake:true,enraged:true,nextCleave:103,stepOff:{t0:99,x0:1200,z0:0,x1:1201,z1:0},word:{t0:98}},
  target:other.id,threat:new Map([[other.id,50]]),combatUntil:110,swingAt:103,casting:{id:'chill',t:.2,total:1,targetId:other.id}};
 const ctx={GAME:{t:time,player:local},NET:{self,peers:new Map([[other.netPeer,{slow:{on:1},ghost:other}]])},ENT:[local,other,boss],
  BARROW_STATE:{king:actorId,warden:actorId,kingDead:false,kingAt:150,wardenDead:false,wardenAt:160,adds:new Set([actorId])},
  BARROW_PACKS:[{members:new Set([actorId]),respawn:[{at:150,spec:['skeleton',15,20,0]}]}],
  DUN:{built:true,gates:{well:{open:.8,target:1,fy:-6,h:2,kind:'bars',mesh:{position:{}},coll:{active:true}}},tombs:[]},
  DEEP:{built:true,kills:self==='a'?3:99,lord:actorId,lordDead:false,lordAt:170,adds:new Set([actorId]),wy:-17,
   flood:{st:1,t:3,next:180,drowned:[actorId]},slabs:[{i:0,st:2,t:.4,load:0,dur:1,down:.25,tilt:[.1,.2],by:other.id,x:1200,z:0,mesh:{position:{set(){}},rotation:{set(){}}}}],
   cells:Array.from({length:96},(_,i)=>({i,st:i?0:1,t:2,heat:i?0:.8,ch:.2,catchAt:0,rearm:190,spread:!i})),heat:new Uint8Array(384),heatTex:{}},
  DEEP_PACKS:[{members:new Set([actorId]),respawn:[{at:160,spec:['cinder',20,180,100]}]}],
  NET_DUNGEON_CLOCKS:new Set(['giveUpAt','lostAt','nextAggro','nextChill','nextCleave','nextLance','nextStamp','nextWord','riseUntil','wanderUntil','t0']),
  netEntityShared:()=>true,netEntityMine:()=>true,netEntityR:v=>Math.round((Number.isFinite(v)?v:0)*100)/100,
  netEntityOwned:e=>!!e&&e.role!=='player'&&e.role!=='remote',smooth:v=>v,lerp:(a,b,t)=>a+(b-a)*t,dunV:z=>z,
  DEEP_SLAB:{fall:.8,rise:2.2},DEEP_Y:-18,DEEP_PIT:-24,collisions:[],deepHeatUpload(){this.uploaded=true;}
 };
 ctx.getEnt=id=>ctx.ENT.find(e=>e.id===id);
 ctx.netEntityFind=id=>id==='peer:'+self?local:id?.startsWith('peer:')?other:ctx.ENT.find(e=>e.netEntityId===id)||null;
 ctx.deepSlabCells=(slab,on)=>ctx.collisions.push(on);
 const api=new Function('ctx','with(ctx){'+SELECTED+'\nreturn {capture:netEntityDungeonMeta,apply:netEntityApplyDungeon,players:netEntityLivePlayers};}')(ctx);
 return {ctx,api,boss};
}
test('dungeon handoff retains actor identity, awake phases, translated clocks, targets and private character isolation',()=>{
const a=dungeonPage(),b=dungeonPage('b',2000,20),image=a.api.capture();b.api.apply(image);
assert.equal(b.boss.ai.awake,true);assert.equal(b.boss.ai.enraged,true);assert.equal(b.boss.ai.nextCleave,2003);assert.equal(b.boss.ai.stepOff.t0,1999);assert.equal(b.boss.ai.word.t0,1998);assert.equal(b.boss.hp,40);assert.equal(b.boss.target,2);assert.equal(b.boss.casting.targetId,2);assert.equal(b.ctx.GAME.player.id,2);assert.equal(b.ctx.BARROW_PACKS[0].members.has(20),true);assert.equal(b.ctx.BARROW_PACKS[0].respawn[0].at,2050);assert.equal(b.ctx.DEEP.flood.drowned[0],20);assert.equal(b.ctx.DEEP.kills,99);assert.equal(Object.hasOwn(image.deep,'kills'),false);
});
test('the complete bounded pitch field, flood water, slab collision and Barrow gate pose rehydrate on another keeper',()=>{
const a=dungeonPage(),b=dungeonPage('b',2000,20),image=a.api.capture();assert.equal(image.deep.pitch.length,96);b.api.apply(image);assert.equal(b.ctx.DEEP.wy,-17);assert.equal(b.ctx.DEEP.cells[0].heat,.8);assert.equal(b.ctx.DEEP.cells[95].ch,.2);assert.equal(b.ctx.DEEP.cells[1].catchAt,0);assert.equal(b.ctx.DUN.gates.well.coll.active,false);assert.equal(b.ctx.collisions[0],false);assert.equal(b.ctx.DEEP.slabs[0].st,2);
});

test('static dungeon traps damage the remote owner once through the canonical combat result',()=>{
 const a=dungeonPage(),b=dungeonPage('b',2000,20);
 const trapNames=['netEntityFind','netEntityReference','netEntityPlain','netEntityDamage','netEntityResult'];
 const trapCode=trapNames.map(name=>{const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return source.slice(node.start,node.end);}).join('\n');
 function prepare(page,mine){
  const c=page.ctx;c.NET_ENTITIES={authority:'token',commands:0,rewards:new Set(),bodies:new Map(),stats:{}};
  c.netEntityMine=()=>mine;c.netEntityCanSimulateWorld=()=>mine;c.netEntityTown=()=>false;c.netEntityOwnPet=()=>false;
  c.VENT_SRC={id:-77,role:'trap',level:18,faction:3};c.DEEP_FIRE_SRC={id:-79,role:'trap',level:45,faction:3};
  c.packets=[];c.netEntitySend=(op,args)=>{c.packets.push({op,...args});return true};c.isEnemy=()=>true;c.baseDmg=()=>10;
  c.GAME.player.hp=100;c.dealDamage=(src,dst,n)=>{dst.hp-=n;return n};
  return new Function('ctx','with(ctx){'+trapCode+'\nreturn {damage:netEntityDamage,result:netEntityResult};}')(c);
 }
 const host=prepare(a,true),owner=prepare(b,false),remote=a.ctx.NET.peers.get('b').ghost;
 host.damage(a.ctx.VENT_SRC,remote,7.5,{kind:'fire',trap:true});
 assert.equal(a.ctx.packets[0].result.source,'hazard:barrow-vents');
 owner.result(a.ctx.packets[0].result);owner.result(a.ctx.packets[0].result);assert.equal(b.ctx.GAME.player.hp,92.5);
 host.damage(a.ctx.DEEP_FIRE_SRC,remote,3,{kind:'fire',trap:true});
 assert.equal(a.ctx.packets[1].result.source,'hazard:deep-pitch');owner.result(a.ctx.packets[1].result);assert.equal(b.ctx.GAME.player.hp,89.5);
});
