import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
const cache=new Map();
function selected(file,names){let value=cache.get(file);if(!value){const source=readFileSync(new URL('../../src/'+file,import.meta.url),'utf8');value={source,ast:parse(source,{ecmaVersion:'latest',sourceType:'module'})};cache.set(file,value);}return names.map(name=>{const node=value.ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert.ok(node,file+':'+name);return value.source.slice(node.start,node.end);}).join('\n');}
function proximityPage(mine=false) {
 const c={mine,GAME:{t:100,player:{id:1,role:'player',alive:true,x:-1000,y:0,z:0},prog:{level:50}},
  NET:{self:'a',peers:new Map()},ENT:[],calls:{public:0,spawn:0,deepSpawn:0,reset:0,vet:0,notes:0},
  INDOOR:{on:false,outdoor:{visible:true}},UI:{travelling:false},CAM:{yaw:0,pitch:0},
  BARROW:{x:0,z:0,yaw:0,out:{x:0,z:20}},BARROW_PW:1.15,
  BARROW_STATE:{king:50,wardenDead:false,kingDead:false,adds:new Set(),flowAt:0,entered:0},
  BARROW_PACKS:[],DUN:{built:true,root:{visible:false},chests:[],spots:{arrive:{x:1000,z:0},well:{x:2000,z:0,y:0},throne:{x:1200,z:0}}},
  DEEP:{built:true,root:{visible:false},seal:{open:0,target:1,mesh:{position:{x:1200,z:50}}},marks:[],chests:[],taken:{},slabs:[],cells:[],near:{},step:0,lordDead:false,throne:{x:1200,z:100},inDeep:false,lastDeep:-99},
  DEEP_PACKS:[],DEEP_SEAL:{u:180,v:50},DEEP_Y:-18,DUN_ROOM:{ashhall:{id:'ashhall'},cistern:{id:'cistern'}},TAU:Math.PI*2
 };
 c.netEntityShared=()=>true;c.netEntityMine=()=>c.mine;c.netEntityCanSimulateWorld=()=>c.mine;c.netWorldPartsCanSimulate=()=>c.mine;
 c.dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2;c.dist=(x,z,a,b)=>Math.hypot(x-a,z-b);c.clamp=(v,a,b)=>Math.max(a,Math.min(b,v));c.smooth=v=>v;c.lerp=(a,b,t)=>a+(b-a)*t;
 c.inDungeon=p=>p.x>=900;c.dunU=x=>x-1000;c.dunWX=x=>1000+x;c.dunWZ=z=>z;c.late3Room=(x,z)=>z===75?c.DUN_ROOM.cistern:z>50?c.DUN_ROOM.ashhall:null;
 c.late3InDeep=p=>c.inDungeon(p)&&!!c.late3Room(p.x,p.z);c.barrowLocal=(x,z)=>({lx:x,lz:z});c.getEnt=id=>c.ENT.find(e=>e.id===id);
 c.dunFloorAt=()=>-6;c.heightAt=()=>0;c.isWalkable=()=>true;c.travel=fn=>fn();c.resetKing=()=>c.calls.reset++;c.loreNote=()=>c.calls.notes++;c.late3VetStep=()=>c.calls.vet++;
 c.fxAdd={emit(){}};
 for(const k of ['updateFlow','updateVents','updateChests','updateBarrowMotion','deepFallStep','deepSlabStep','deepPitchStep','deepFloodStep'])c[k]=()=>c.calls.public++;
 c.spawnBarrowMob=()=>({id:++c.calls.spawn});c.spawnWarden=c.spawnKing=()=>c.calls.spawn++;c.deepSpawn=()=>({id:++c.calls.deepSpawn});c.deepSpawnLord=()=>c.calls.deepSpawn++;
 for(const k of ['sfx','sfxAt','cameraShake','uiLog','uiToast','uiError','dismount','saveSoon','setTimeout','sndAround','deepSealPose',
 'rebuildGrid','runLater','updatePlayer','updateNPCs','updateWar','updateProjectiles','updateWalls','updateDragonWorld','updateLoot','updateGates','updateCastles','updateHouses','updateWear','updateNature','updateBrand','updateLand','updateGifts','updateWater','updateHall','updateBuild','updateClasses','updateSurvival','updateFarming','updateAnimals','updateSeasons','updateDepth','updateLate2','updateLate4','updateWeather2','updateLoops','updateSeason','netPump'])c[k]=()=>{};
 const sets=[['14x_netentities.js',['netEntityLivePlayers','netEntityHumanDistance']],['04d_barrow.js',['checkBarrowDoor','enterBarrow','leaveBarrow','setIndoor']],
 ['08e_barrow.js',['onEnterBarrow','onLeaveBarrow','updateBarrow','updateBarrowLocal']],['10m_deep.js',['late3Update','late3LocalUpdate']],['13_main.js',['simStep']]];
 const names=sets.flatMap(([,names])=>names),code=sets.map(([file,names])=>selected(file,names)).join('\n');
 Object.assign(c,new Function('ctx','with(ctx){'+code+'\nreturn {'+names.join(',')+'};}')(c));
 return c;
}
function install(c,file,names){Object.assign(c,new Function('ctx','with(ctx){'+selected(file,names)+'\nreturn {'+names.join(',')+'};}')(c));}

test('a follower automatically enters and exits the Barrow without advancing public encounters',()=>{
 const c=proximityPage(),owner=c.GAME.player;c.GAME.player.x=0;c.GAME.player.z=3;c.ENT.push({id:50,alive:true,ai:{awake:true}});c.simStep(.1);
 assert.equal(c.INDOOR.on,true);assert.equal(c.GAME.player.x,1000);assert.equal(c.BARROW_STATE.entered,1);c.GAME.player.x=990;c.simStep(.1);
 assert.equal(c.INDOOR.on,false);assert.ok(c.GAME.player.x<10);assert.equal(c.GAME.player,owner);assert.equal(c.calls.reset,0);assert.equal(c.calls.public,0);assert.equal(c.DEEP.seal.open,0);
});
test('each character retains its own Deep Barrow visibility and private notes',()=>{
 const a=proximityPage(true),b=proximityPage(),owner=b.GAME.player;a.NET.peers.set('b',{slow:{on:1},ghost:{id:2,alive:true,x:1200,z:100}});a.simStep(.1);
 Object.assign(b.GAME.player,{x:1200,z:100});b.INDOOR.on=true;b.simStep(.1);assert.equal(a.DEEP.root.visible,false);assert.equal(b.DEEP.root.visible,true);assert.equal(b.DEEP.inDeep,true);assert.equal(b.calls.notes,1);
 b.simStep(.1);assert.equal(b.calls.notes,1);assert.equal(b.calls.vet,2);assert.equal(b.GAME.player,owner);Object.assign(b.GAME.player,{x:0,z:20});b.INDOOR.on=false;b.simStep(.1);assert.equal(b.DEEP.root.visible,false);assert.equal(b.DEEP.inDeep,false);
});
test('public dungeon clocks and respawns advance once only on the keeper',()=>{
 const c=proximityPage();c.BARROW_PACKS.push({respawn:[{at:0,spec:['skeleton',15,20,0]}],members:new Set()});c.DEEP_PACKS.push({respawn:[{at:0,spec:['draugr',20,180,100]}],members:new Set()});c.simStep(.1);
 assert.equal(c.calls.public+c.calls.spawn+c.calls.deepSpawn,0);assert.equal(c.BARROW_PACKS[0].respawn.length,1);c.mine=true;c.simStep(.1);assert.equal(c.calls.spawn,1);assert.equal(c.calls.deepSpawn,1);assert.equal(c.calls.public,7);assert.ok(c.DEEP.seal.open>0);assert.equal(c.calls.vet,2);
});
test('a distant live follower activates the Barrow mobs and both bosses without replacing the keeper',()=>{
 const c=proximityPage(true),owner=c.GAME.player,remote={id:2,alive:true,x:1180,y:0,z:0};c.NET.peers.set('b',{slow:{on:1},ghost:remote});
 Object.assign(c,{MOBS:{skeleton:{aggro:10}},isEnemy:()=>true,topThreat:()=>null,segmentClear:()=>true,packAggro:()=>{},fightTarget:(e,t)=>e.fought=t.id,wakeKing:e=>e.ai.awake=true,isStunned:()=>false,deepLordWake:e=>e.ai.awake=true});
 install(c,'08e_barrow.js',['thinkBarrowMob','thinkHollowKing']);install(c,'10m_deep.js',['late3LordThink']);
 const mob={id:3,alive:true,x:1181,y:0,z:0,ai:{},mobType:'skeleton',home:{x:1181,z:0,r:2}};c.thinkBarrowMob(mob,.1);assert.equal(mob.fought,2);
 const king={id:4,alive:true,x:1180,y:0,z:0,hp:90,maxHp:100,ai:{awake:false}};c.thinkHollowKing(king,.1);assert.equal(king.ai.awake,true);
 remote.z=100;const lord={id:5,alive:true,x:1180,y:0,z:100,hp:90,maxHp:100,ai:{awake:false}};c.late3LordThink(lord,.1);assert.equal(lord.ai.awake,true);assert.equal(c.GAME.player,owner);assert.equal(owner.x,-1000);
 c.NET.peers.get('b').slow.on=0;lord.ai.awake=false;c.late3LordThink(lord,.1);assert.equal(lord.ai.awake,false);
});
test('a roaming host cannot spawn or coarsely relocate in view of a distant follower',()=>{
 const c=proximityPage(true);Object.assign(c,{LATE4:{hosts:[],stats:{}},LATE4_HOST_BACK:900,late4HostOn:()=>true,late4HostInit:()=>{},late4Route:()=>{},warLevel:()=>50,late4Slot:H=>({x:H.px+5,z:H.pz,yawX:H.px+5,yawZ:H.pz+1}),groundY:()=>0,removeEnt:()=>{}});
 install(c,'10o_late4.js',['late4HostSpawn','late4HostStep']);c.NET.peers.set('b',{slow:{on:1},ghost:{id:2,alive:true,x:1000,z:0}});
 const body={id:10,alive:true,x:1000,z:0,hp:100,maxHp:100,ai:{}};c.ENT.push(body);const H={D:{},up:true,ids:[10],lead:10,px:1000,pz:0,route:[{x:1000,z:0},{x:1100,z:0}],ri:1,home:{x:1000,z:0},fight:0,stuck:0};c.LATE4.hosts.push(H);
 assert.equal(c.late4HostSpawn(H),false);c.late4HostStep(1);assert.equal(body.x,1000);c.NET.peers.get('b').slow.on=0;c.late4HostStep(1);assert.ok(body.x>1000);
});
test('stray caravan people and horses remain present near a distant live follower',()=>{
 const c=proximityPage(true);Object.assign(c,{REALMS:[{town:{x:1000,z:0}}],HOUSES:[],pickTarget:()=>null,moveToward:()=>{},houseIntact:()=>true});
 install(c,'08m_loops.js',['loopsSeenBy','loopsStrayThink','loopsHorseThink']);c.NET.peers.set('b',{slow:{on:1},ghost:{id:2,alive:true,x:1000,z:0}});
 const carter={id:4,alive:true,x:1002,z:0,faction:0,role:'carter'},horse={id:5,alive:true,x:1002,z:0};c.loopsStrayThink(carter,.1);c.loopsHorseThink(horse,.1);assert.equal(carter.alive&&horse.alive,true);
 c.NET.peers.get('b').ghost.alive=false;c.loopsStrayThink(carter,.1);c.loopsHorseThink(horse,.1);assert.equal(carter.alive||horse.alive,false);
});
test('a distant follower attending a house prevents its automatic door shut',()=>{
 const c=proximityPage(true);Object.assign(c,{HOUSE_CLOCK:{},tod:{p:0},todSample:()=>[0],HOUSES:[],houseTowns:()=>[],houseIntact:()=>true,houseTended:()=>false,houseWantsShut:()=>true,setHouseShutters:()=>{},houseRubbleSync:()=>{},houseHarm:()=>{}});
 install(c,'04e_houses.js',['updateHouses']);c.NET.peers.set('b',{slow:{on:1},ghost:{id:2,alive:true,x:1000,z:0}});
 const H={x:1000,z:0,state:'whole',door:{leaf:{open:1,target:1},coll:{},collLeaf:{}},furnColl:[],wins:[]};c.HOUSES.push(H);c.updateHouses(.1);assert.equal(H.door.leaf.target,1);assert.equal(H.door.leaf.open,1);
 c.NET.peers.get('b').slow.on=0;c.updateHouses(.1);assert.equal(H.door.leaf.target,0);
});
test('a distant follower activates the cistern flood and its clock advances once',()=>{
 const c=proximityPage(true);Object.assign(c,{DEEP_FLOOD:{base:-18,high:-14,trigU:170,rise:10,hold:10,drain:20,again:30},deepX:x=>1000+x,deepZ:z=>z,splashAt:()=>{},uiBanner:()=>{}});
 Object.assign(c.DEEP,{flood:{st:0,t:0,next:0,drowned:[]},stats:{floods:0},adds:new Set(),water:{position:{y:-18}}});install(c,'10m_deep.js',['deepFloodStep']);
 c.NET.peers.set('b',{slow:{on:1},ghost:{id:2,alive:true,x:1160,z:75}});c.deepFloodStep(.1);assert.equal(c.DEEP.flood.st,1);assert.equal(c.DEEP.stats.floods,1);assert.equal(c.DEEP.flood.drowned.length,2);
 c.deepFloodStep(.1);assert.equal(c.DEEP.flood.t,.1);assert.equal(c.DEEP.stats.floods,1);assert.equal(c.GAME.player.x,-1000);
});
