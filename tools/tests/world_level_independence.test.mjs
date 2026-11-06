import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {parse} from 'acorn';
const read=file=>readFileSync(new URL('../../src/'+file,import.meta.url),'utf8');
function declaration(source,name){
  const node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>
    n.type==='FunctionDeclaration'&&n.id.name===name||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name));
  assert.ok(node,name);return source.slice(node.start,node.end);
}

test('wall strength is structural and independent of world unlock development',()=>{
  const c=vm.createContext({stage:1});
  vm.runInContext('const warLevel=()=>stage,baseDmg=L=>6+3*L;'+declaration(read('04g_castles.js'),'sectionMaxHp'),c);
  const before=vm.runInContext('sectionMaxHp()',c);c.stage=50;
  assert.equal(vm.runInContext('sectionMaxHp()',c),before);
  assert.equal(before,1056);
});

test('a soldier taking a guard post retains its own combat experience and level',()=>{
  const data=read('06_data.js'),c=vm.createContext({Math});
  vm.runInContext(`const LEVEL_CAP=50;const GAME={t:0},W3={stats:{garrisoned:0}};
    const w3SlotSpec=()=>({pos:[0,0,0],post:'court',wall:false}),siteWorld=()=>({x:1,y:0,z:2});
    const dismount=()=>{},setupStats=()=>{};
    const soldier={id:1,kind:'humanoid',role:'soldier',faction:0,level:7,alive:true,ai:{},growth:{v:1,base:1,xp:0,kills:20}};
    const keep={site:{},guards:new Set()},band={members:[1]};`+
    ['xpToNext','worldActorGrowthRead','worldActorCanDevelop','worldActorGrowthLevel','worldActorDevelop'].map(n=>declaration(data,n)).join('\n')+
    '\n'+declaration(read('08k_war3.js'),'war3MakeGuard')+
    '\nfor(let level=1;level<7;level++)soldier.growth.xp+=xpToNext(level);',c);
  assert.equal(vm.runInContext('war3MakeGuard(soldier,keep,0,band)',c),true);
  assert.equal(vm.runInContext('soldier.level',c),7);
  assert.equal(vm.runInContext('soldier.growth.kills',c),20);
  assert.equal(vm.runInContext('soldier.role',c),'guard');
  assert.equal(vm.runInContext('band.members.length',c),0);
});

test('a winter field retains its removed caster strength and checks the actual warned footprint',()=>{
  const c=vm.createContext({Math:Object.assign(Object.create(Math),{random:()=>.5})});
  vm.runInContext(`const GAME={t:2},REALM_BONUS=[1,1,1],hits=[],buffs=[];
    const player={id:2,level:17,faction:0,alive:true,kind:'humanoid',x:4.49,z:0};
    const outside={...player,id:3,x:4.51},actors=[player,outside];
    const getEnt=()=>null,isActor=()=>true,isEnemy=(a,b)=>a.faction!==b.faction;
    const forNear=(x,z,r,run)=>{for(const a of actors)if(Math.hypot(a.x-x,a.z-z)<=r)run(a)};
    const dist=(x,z,a,b)=>Math.hypot(x-a,z-b),clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),buffSum=()=>0;
    const baseDmg=L=>6+3*L,warLevel=()=>50;
    const dealDamage=(src,dst,n,opts)=>hits.push({src,dst,n,opts}),addBuff=(...args)=>buffs.push(args);
    const NATURE={fire:new Set()},natTreesNear=()=>{};
    const source={id:1,name:'Winter mage',kind:'humanoid',role:'soldier',level:17,faction:2,dmgMult:2.3,cls:'mage'};`+
    ['netEntitySourceStamp','netEntitySourceRead','netEntityAreaAccept'].map(n=>declaration(read('14x_netentities.js'),n)).join('\n')+
    '\n'+declaration(read('07_entities.js'),'computeDamage')+'\n'+declaration(read('06c_gifts.js'),'stepWinter')+
    '\nconst field={src:1,sourceActor:netEntitySourceStamp(source),level:17,dmgMult:2.3,realm:2,x:0,z:0,r:4.5,until:10,tick:0,k:1};stepWinter(field,1);',c);
  assert.equal(vm.runInContext('hits.length',c),1);
  assert.ok(Math.abs(vm.runInContext('hits[0].n',c)-65.55)<1e-8);
  assert.equal(vm.runInContext('hits[0].src.name',c),'Winter mage');
  assert.equal(vm.runInContext('hits[0].src.level',c),17);
  assert.equal(vm.runInContext('buffs[0][5].area.r',c),4.5);
  vm.runInContext('player.x=5',c);
  assert.equal(vm.runInContext('netEntityAreaAccept(hits[0].opts.area,player)',c),false);
});
