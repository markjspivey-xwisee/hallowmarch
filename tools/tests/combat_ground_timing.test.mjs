import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';

const source=readFileSync(process.env.HM_COMBAT_SOURCE||new URL('../../src/07_entities.js',import.meta.url),'utf8');
const data=readFileSync(new URL('../../src/06_data.js',import.meta.url),'utf8');
function declaration(text,name){
  const node=parse(text,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name
    ||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name));
  if(!node&&['abilityGroundPoint','abilityAreaMark','aoeMarkAlive'].includes(name))return '';
  assert.ok(node,name);return text.slice(node.start,node.end);
}
function fixture(){
  const hits=[],heals=[],impacts=[];
  const player={id:2,role:'player',kind:'humanoid',faction:1,alive:true,x:0,y:0,z:0,radius:.45,scale:1,level:1,maxHp:137,buffs:[]};
  const caster={id:1,role:'soldier',kind:'humanoid',cls:'priest',faction:0,alive:true,x:-10,y:0,z:0,yaw:0,radius:.45,scale:1,level:30,power:1000,cds:{},buffs:[],combatUntil:0};
  const ctx=vm.createContext({GAME:{t:0,player},ENT:[caster,player],ENT_BY_ID:new Map([[1,caster],[2,player]]),
    SGRID:new Map(),SGRID_USED:[],SCELL:12,LATER:[],AOE_MARKS:[],PROJ:[],
    PROJ_SPEED:{holy:24,arrow:46},PROJ_COL:{holy:[1,1,0],arrow:null},ARROWLIKE:{arrow:true},BODKIN_PIERCE:.5,
    Math,TAU:Math.PI*2,dist2:(x,z,a,b)=>(x-a)**2+(z-b)**2,dist:(x,z,a,b)=>Math.hypot(x-a,z-b),
    getEnt:id=>ctx.ENT_BY_ID.get(id),isActor:e=>e.kind!=='door',isEnemy:(a,b)=>a.faction!==b.faction,
    canUse:()=>null,faceToward(){},steadyCast(){},sfxAtE(){},activityEntityEvent(){},resolveTarget:(e,A,t)=>t,
    classAbility:(e,A)=>A,rankMult:()=>1,setAct(){},heightAt:()=>0,priestSelf:()=>1,
    computeDamage:(a,b,m)=>({d:10*m,crit:false}),dealDamage:(a,b,n,opts)=>hits.push({id:b.id,n,opts,t:ctx.GAME.t}),
    healEnt:(a,b,n)=>heals.push({id:b.id,n}),addBuff(){},stunBreak(){},
    FX:new Proxy({},{get:()=>()=>{}}),spellPillar(){},spellDisc(){},lightFlash(){},spellEmitter(){},
    DISC_KIND:{holy:1,frost:2,shock:3,scorch:4,crack:5},natureImpact(){},fireLandsAt(){impacts.push('fire');},
    castleSiegeHit(){},houseBlowAt(){},sfxAt(){},cameraShake(){},
    wallsAimY:e=>e.y,wallsProj:()=>false,sndOnLoose(){},netOnShot(){},
    spellImpact(){impacts.push('impact');},spellRibbon(){},fxAlpha:{emit(){}},
    igniteTree(){},igniteGrass(){},crippleWound(){},
    clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),console,
  });
  vm.runInContext(declaration(data,'ABILITIES')+'\nfor(const [id,A]of Object.entries(ABILITIES))A.id=id;\n'+
    ['gkey','rebuildGrid','forNear','abilityGroundPoint','abilityAreaMark','useAbility','finishCast','executeAbility','areaDamage','later','runLater','aoeMarker','aoeMarkAlive','spawnProjectile','updateProjectiles'].map(n=>declaration(source,n)).join('\n')+'\nthis.abilities=ABILITIES;',ctx);
  ctx.rebuildGrid();
  return{ctx,caster,player,hits,heals,impacts,advance(to){while(ctx.GAME.t+1e-8<to){ctx.GAME.t=Math.min(to,ctx.GAME.t+.01);ctx.runLater();}}};
}

test('ground casting warns from the beginning and lands at the warned place after the target escapes',()=>{
  const f=fixture(),{ctx,caster,player}=f;
  ctx.useAbility(caster,'pillar',player);
  assert.equal(ctx.AOE_MARKS.length,1,'the wind-up has a visible warning');
  const warning=ctx.AOE_MARKS[0];assert.equal(warning.x,0);assert.equal(warning.r,4.5);
  assert.doesNotThrow(()=>JSON.stringify(caster.casting),'cast state remains serializable');
  player.x=10;ctx.GAME.t=ctx.abilities.pillar.cast;ctx.finishCast(caster);
  assert.equal(ctx.AOE_MARKS.length,1,'impact extends the original warning without duplicating it');
  assert.equal(ctx.AOE_MARKS[0].x,0,'the circle does not follow an escaped target');
  f.advance(ctx.GAME.t+.21);assert.equal(f.hits.length,0);
});

test('Pillar of Dawn damages only the exact visible disc, not the extra body-radius fringe',()=>{
  const f=fixture(),{ctx,caster,player}=f;
  player.x=4.51;
  ctx.executeAbility(caster,ctx.abilities.pillar,null,{gx:0,gz:0});f.advance(.21);
  assert.equal(f.hits.length,0,'standing outside the marked radius is safe');
  player.x=4.49;ctx.executeAbility(caster,ctx.abilities.pillar,null,{gx:0,gz:0});f.advance(.42);
  assert.equal(f.hits.length,1);assert.equal(f.hits[0].opts.area.r,4.5);
});

test('every volley wave lands while its original ground warning is still active',()=>{
  const f=fixture(),{ctx,caster,player}=f;
  ctx.executeAbility(caster,ctx.abilities.volley,player);
  const warning=ctx.AOE_MARKS[0];f.advance(3);
  assert.equal(f.hits.length,ctx.abilities.volley.waves);
  assert.ok(f.hits.every(hit=>hit.t<=warning.until),'the final wave cannot outlive its warning');
  assert.ok(f.hits.every(hit=>hit.opts.area.shape==='disc'));
});

test('interrupted and dead casts lose their warning; completed casts keep their impact warning',()=>{
  const f=fixture(),{ctx,caster,player}=f;
  ctx.useAbility(caster,'pillar',player);const cancelled=ctx.AOE_MARKS[0];caster.casting=null;
  assert.equal(ctx.aoeMarkAlive(cancelled),false);
  ctx.useAbility(caster,'pillar',player);const dead=ctx.AOE_MARKS[1];caster.alive=false;
  assert.equal(ctx.aoeMarkAlive(dead),false);
  caster.alive=true;caster.casting=null;ctx.useAbility(caster,'pillar',player);
  ctx.GAME.t=ctx.abilities.pillar.cast;ctx.finishCast(caster);
  assert.equal(ctx.aoeMarkAlive(ctx.AOE_MARKS[2]),true);
});

test('a pushed-back cast keeps its warning until the original cast actually completes',()=>{
  const f=fixture(),{ctx,caster,player}=f;
  ctx.useAbility(caster,'pillar',player);const mark=ctx.AOE_MARKS[0];
  ctx.GAME.t=ctx.abilities.pillar.cast+.6;caster.casting.t=1.3;
  assert.ok(mark.until<ctx.GAME.t,'the initial cast deadline has passed');
  assert.equal(ctx.aoeMarkAlive(mark),true,'the same active cast still warns at its committed point');
  ctx.finishCast(caster);assert.equal(ctx.aoeMarkAlive(mark),true);
  f.advance(ctx.GAME.t+.3);assert.equal(ctx.aoeMarkAlive(mark),false);
});

test('an expired homing projectile vanishes without hitting its distant target or igniting its ground',()=>{
  const f=fixture(),{ctx,caster,player}=f;player.x=100;
  ctx.spawnProjectile(caster,player,'holy',{mult:1},null,false,{x:0,y:0,z:0});
  ctx.PROJ[0].age=3.49;ctx.updateProjectiles(.05);
  assert.equal(ctx.PROJ.length,0);assert.equal(f.hits.length,0);assert.equal(f.impacts.length,0);
});

test('projectile travel is bounded by its remaining life, while an actual final impact still lands',()=>{
  for(const [distance,expected]of [[2,0],[.4,1]]){
    const f=fixture(),{ctx,caster,player}=f;player.x=distance;
    ctx.spawnProjectile(caster,player,'holy',{mult:1},null,false,{x:0,y:0,z:0});
    ctx.PROJ[0].age=3.49;ctx.updateProjectiles(1);
    assert.equal(f.hits.length,expected,'only a target actually reached within the remaining lifetime is hit');
    assert.equal(ctx.PROJ.length,0);
  }
});
