import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
const files=new Map();
function select(file,names){let value=files.get(file);if(!value){const source=readFileSync(new URL('../../src/'+file,import.meta.url),'utf8');value={source,ast:parse(source,{ecmaVersion:'latest',sourceType:'module'})};files.set(file,value);}return names.map(name=>{const node=value.ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,file+':'+name);return value.source.slice(node.start,node.end);}).join('\n');}
function fallPage(mine) {
 const player={id:mine?1:2,role:'player',kind:'humanoid',alive:true,x:mine?-1000:1200,y:-18,z:0,hp:100,maxHp:100,radius:.4,anim:{flash:0},onGround:true,vy:0};
 const remote={id:mine?2:1,role:'remote',netPeer:mine?'b':'a',kind:'humanoid',alive:true,x:mine?1200:-1000,y:-18,z:0,hp:100,maxHp:100,radius:.4,anim:{flash:0}};
 const slab={i:0,hall:'crack',x:1200,z:0,u0:199,u1:201,v0:-1,v1:1,st:1,t:0,load:0,dur:1,down:0,tilt:[0,0],by:null};
 const c={mine,GAME:{t:100,player},NET:{self:mine?'a':'b',peers:new Map([[remote.netPeer,{slow:{on:1},ghost:remote}]])},ENT:[player,remote],
  NET_ENTITIES:{authority:'token',commands:0,rewards:new Set(),applying:false,stats:{}},packets:[],
  DUN:{built:true},BARROW_STATE:{flowAt:0},DEEP:{built:true,seal:null,slabs:[slab],marks:[],chests:[],taken:{},cells:[],adds:new Set(),flood:{},stats:{slabsBroken:0,falls:0},root:{visible:false},near:{},step:10},
  DEEP_PACKS:[],DEEP_SLAB:{climbOut:1.6,climbT:1,pitHarm:.03},DEEP_Y:-18,DEEP_PIT:-24,
  DEEP_FIRE_SRC:{id:-79,level:45,role:'trap',faction:3},INDOOR:{on:false},DUN_ROOM:{ashhall:{}},DEEP_SEAL:{u:180,v:0},TAU:Math.PI*2
 };
 c.netEntityShared=()=>true;c.netEntityMine=()=>c.mine;c.netEntityCanSimulateWorld=()=>c.mine;c.netEntityPersonal=e=>!!e?.netEntityOwner||e?.role==='pet';c.netEntityOwnPet=()=>false;
 c.netEntityOwned=e=>!!e&&e.role!=='player'&&e.role!=='remote';c.netEntityTown=()=>false;
 c.getEnt=id=>c.ENT.find(e=>e.id===id);c.netEntityFind=id=>id==='hazard:deep-pitch'?c.DEEP_FIRE_SRC:id==='peer:'+c.NET.self?player:id==='peer:'+remote.netPeer?remote:null;
 c.netEntitySend=(op,args)=>{c.packets.push({op,...args});return true};
 c.netEntityLivePlayers=()=>[player,remote].filter(e=>e.alive);
 c.inDungeon=e=>e.x>=900;c.inSlab=(s,x,z,m=0)=>x>1199-m&&x<1201+m&&z>-1-m&&z<1+m;
 c.dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2;c.clamp=(v,a,b)=>Math.max(a,Math.min(b,v));c.smooth=v=>v;c.lerp=(a,b,t)=>a+(b-a)*t;c.dunU=x=>x-1000;c.dunWX=x=>1000+x;c.dunWZ=z=>z;
 c.deepEdgeOut=()=>({x:1203,z:0});c.look6SlabTop=()=>-23.65;c.dunFloorAt=()=>-18;c.deepSlabCells=()=>{};
 c.late3InDeep=e=>c.inDungeon(e);c.late3Room=()=>c.DUN_ROOM.ashhall;c.late3VetStep=()=>{};
 c.baseDmg=()=>10;c.isEnemy=()=>true;
 c.dealDamage=(src,dst,n,opts)=>{const diverted=c.netEntityDamage(src,dst,n,opts);if(diverted!==null)return diverted;dst.hp-=n;return n;};
 c.FX={dust(){},burst(){}};c.fxAdd={emit(){}};
 for(const name of ['sfxAt','cameraShake','setAct','sfxAtE','uiFloatAt','flashScreen','uiLog','killEnt','deepSealPose','deepSlabStep','deepPitchStep','deepFloodStep'])c[name]=()=>{};
 const names=['netEntityPlain','netEntityReference','netEntityDamage','netEntityRemoteFall','netEntityFallResult','netEntityPrivateFallStep','netEntityResult'];
 const deepNames=['deepSlabFall','deepFall','deepFallStep','late3Update','late3LocalUpdate'];
 const selected=select('14x_netentities.js',names)+'\n'+select('10m_deep.js',deepNames);
 Object.assign(c,new Function('ctx','with(ctx){'+selected+'\nreturn {'+[...names,...deepNames].join(',')+'};}')(c));
 return {c,player,remote,slab};
}

test('a shared slab sends one bounded fall intent while the keeper leaves remote motion and HP private',()=>{
 const {c,remote,slab}=fallPage(true),position={x:remote.x,y:remote.y,z:remote.z};
 c.deepSlabFall(slab);assert.equal(slab.st,2);assert.equal(c.packets.length,1);assert.equal(c.packets[0].to,'b');
 assert.equal(c.packets[0].result.kind,'dungeon-fall');assert.equal(c.packets[0].result.slab,0);
 assert.equal(remote.l3fall,undefined);assert.equal(remote.hp,100);assert.equal(remote.x,position.x);assert.equal(remote.y,position.y);
 remote.l3fall={t:.2};c.late3Update(.6);assert.equal(remote.l3fall.t,.2);assert.equal(remote.hp,100);
 assert.equal(remote.x,position.x);assert.equal(remote.y,position.y);
});
test('the owner runs actual fall impact and climb once, and repeated results cannot restart either phase',()=>{
 const host=fallPage(true),owner=fallPage(false);host.c.deepSlabFall(host.slab);const result=host.c.packets[0].result;
 owner.c.netEntityResult(result);assert.ok(owner.player.l3fall);assert.equal(owner.c.DEEP.stats.falls,1);
 owner.c.late3LocalUpdate(.6);const state=owner.player.l3fall,hp=owner.player.hp;assert.ok(owner.player.y<-18);assert.ok(hp<70);assert.equal(state.landed,true);
 owner.c.netEntityResult(result);assert.equal(owner.player.l3fall,state);assert.equal(owner.c.DEEP.stats.falls,1);assert.equal(owner.player.hp,hp);assert.equal(owner.player.l3fall.t,.6);
 owner.c.late3LocalUpdate(1.2);assert.ok(owner.player.x>1200);assert.equal(owner.player.l3fall.climb,true);
 owner.c.late3LocalUpdate(.9);assert.equal(owner.player.l3fall,null);assert.equal(owner.player.x,1203);assert.equal(owner.player.y,-18);assert.equal(owner.player.onGround,true);
 owner.c.netEntityResult(result);assert.equal(owner.player.l3fall,null);assert.equal(owner.player.x,1203);assert.equal(owner.c.DEEP.stats.falls,1);
 assert.equal(host.remote.hp,100);assert.equal(host.remote.l3fall,undefined);
});
test('late or malformed fall intents cannot pull the owner onto an invalid or distant slab',()=>{
 const owner=fallPage(false),base={kind:'dungeon-fall',slab:0,x:1200,z:0};
 for(const [i,change]of [{slab:-1},{slab:128},{x:Infinity},{x:4001},{x:1000}].entries()){
  owner.c.netEntityResult({...base,...change,id:'bad-'+i});assert.equal(owner.player.l3fall,undefined);
 }
 owner.player.x=1210;owner.c.netEntityResult({...base,id:'left-slab'});assert.equal(owner.player.l3fall,undefined);assert.equal(owner.player.hp,100);
});
