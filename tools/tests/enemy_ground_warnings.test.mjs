import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
const entities = read('07_entities.js'), late = read('10o_late4.js'), dragon = read('08d_dragon_ai.js');
function declaration(source, name) {
  const node = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body.find(n =>
    n.type === 'FunctionDeclaration' && n.id.name === name
    || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  assert.ok(node, name); return source.slice(node.start, node.end);
}
function fixture() {
  const c = vm.createContext({ Math, Set });
  vm.runInContext(`
    const GAME={t:0,player:null},LATE4={stats:{seconds:0,by:{}},rushes:[]},AOE_MARKS=[],LATER=[],actors=[],hits=[],buffs=[],discs=[];
    const DRAGON={state:'perch',stateT:0,perch:{x:0,z:0},halfDone:true,nextBreath:0,nextTail:Infinity,nextBite:Infinity,lastFoe:0};
    const FACTION_MONSTER=3,FACTION_NEUTRAL=4,DISC_KIND={holy:1};let clear=true,walkable=true;
    const MOBS={boar:{aggro:26}};let chases=0;
    const dist=(x,z,a,b)=>Math.hypot(x-a,z-b),dist2=(x,z,a,b)=>(x-a)**2+(z-b)**2,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),lerp=(a,b,t)=>a+(b-a)*t;
    const getEnt=id=>actors.find(e=>e.id===id)||null,isEnemy=(a,b)=>a.faction!==b.faction,isActor=e=>e.kind!=='door';
    const isStunned=e=>!!e.stunned,isWalkable=()=>walkable,segmentClear=()=>clear,heightAt=()=>0,groundY=()=>0;
    const setAct=()=>{},turnToward=()=>{},late2Snd=()=>{},uiFloatAt=()=>{},late4Shove=()=>{},sfxAtE=()=>{},addFire=()=>{};
    const dragonFeetY=()=>0,computeDamage=()=>({d:100,crit:false}),FX={dust:()=>{}},fireConeAt=()=>{},flashScreen=()=>{};
    const angDiff=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
    const dashReach=(e,x,z,ux,uz,d)=>({x:x+ux*d,z:z+uz*d,d});
    const topThreat=()=>null,bandGateShotStep=()=>false,castleClimbToward=()=>false,fightChase=()=>{};
    function moveToward(e,x,z,dt){chases++;const d=Math.hypot(x-e.x,z-e.z);e.x+=(x-e.x)/d*6*dt;e.z+=(z-e.z)/d*6*dt}
    function spellDisc(x,z,r,kind,dur){discs.push({x,z,r,dur})}
    function forNear(x,z,r,run){for(const e of actors)if(dist(x,z,e.x,e.z)<=r)run(e)}
    function dealDamage(src,dst,d,opts){hits.push({id:dst.id,d,opts,x:dst.x,z:dst.z,at:GAME.t})}
    function addBuff(dst,kind,value,dur,src,extra){buffs.push({id:dst.id,kind,extra})}
  ` + ['aoeMarker', 'later', 'runLater', 'leapPlan', 'updateMotion'].map(n => declaration(entities, n)).join('\n')
    + '\n' + ['LATE4_HOST_AT', 'LATE4_SECOND', 'LATE4_SECOND_NAME', 'late4Second', 'late4RushStep'].map(n => declaration(late, n)).join('\n')
    + '\n' + ['LATE2_RISE_AT', 'late2ChampThink'].map(n => declaration(read('10l_late.js'), n)).join('\n')
    + '\n' + ['thinkMob', 'fightTarget'].map(n => declaration(read('08_ai.js'), n)).join('\n')
    + '\n' + ['DRAGON_ACT', 'DRAGON_SKILLS', 'dragonFoes', 'dragonBurn', 'setDragonState', 'thinkDragon'].map(n => declaration(dragon, n)).join('\n')
    + '\n' + declaration(read('14x_netentities.js'), 'netEntityAreaAccept'), c);
  return { run: s => vm.runInContext(s, c), json: s => JSON.parse(vm.runInContext(`JSON.stringify(${s})`, c)) };
}
const beast = type => `const beast={id:1,mobType:'${type}',kind:'beast',level:40,alive:true,x:0,y:0,z:0,scale:1,radius:.5,faction:3,yaw:0};
  const player={id:2,role:'player',kind:'humanoid',alive:true,x:10,y:0,z:0,radius:.45,faction:0};actors.push(beast,player);`;

test('pounce warns its actual fixed landing until impact and an escaped player is safe', () => {
  const f = fixture();
  f.run(beast('wolf') + `late4Second(beast,player,10);const mark=AOE_MARKS[0];
    player.x=mark.x-mark.r-.01;const inside={...player,id:3,x:mark.x-mark.r+.01};actors.push(inside);
    beast.x=.5;GAME.t=.7;runLater();const motion=beast.motion;GAME.t+=motion.dur;updateMotion(beast,motion.dur)`);
  assert.equal(f.run('mark.x'), 8.5, 'leapPlan stops short of the original target');
  assert.equal(f.run('mark.r'), 2.3);
  assert.equal(f.run('beast.x'), f.run('mark.x'), 'movement or target escape during wind-up cannot move the advertised landing');
  assert.ok(f.run('mark.until>=GAME.t'));
  assert.deepEqual(f.json('hits.map(h=>h.id)'), [3]);
  assert.deepEqual(f.json('hits[0].opts.area'), { v: 1, shape: 'disc', x: 8.5, z: 0, r: 2.3 });
  assert.deepEqual(f.json('buffs[0].extra.area'), f.json('hits[0].opts.area'));
  assert.equal(f.run('netEntityAreaAccept(hits[0].opts.area,player)'), false, 'a delayed receipt cannot hit the escaped owner');
});

test('a pounce with newly blocked landing clearance cancels instead of choosing an unmarked landing', () => {
  const f = fixture();
  f.run(beast('wolf') + 'late4Second(beast,player,10);clear=false;GAME.t=.7;runLater()');
  assert.equal(f.run('beast.motion'), undefined);
  assert.equal(f.run('hits.length'), 0);
});

test('pounce keeps its fixed warning through delayed launch and every physical flight step', () => {
  const f = fixture();
  f.run(beast('wolf') + `late4Second(beast,player,10);const mark=AOE_MARKS[0];
    beast.x=-1;player.x=mark.x;GAME.t=.74;runLater();
    while(beast.motion){GAME.t+=.05;updateMotion(beast,.05)}`);
  assert.equal(f.run('hits.length'), 1);
  assert.ok(f.run('hits[0].at<=mark.until'));
  assert.equal(f.run('beast.x'), f.run('mark.x'));
});

test('gore warnings cover every point swept by the boar including path ends, gaps and late travel', () => {
  const f = fixture();
  f.run(beast('boar') + `beast.scale=1.6;player.x=18;late4Second(beast,player,18);const marks=AOE_MARKS.slice();
    let uncovered=0;for(let x=0;x<=20.001;x+=.1)for(let a=0;a<Math.PI*2;a+=.2){
      const px=x+Math.cos(a)*2.2,pz=Math.sin(a)*2.2;
      if(!marks.some(m=>dist2(px,pz,m.x,m.z)<=m.r*m.r))uncovered++;
    }
    GAME.t=.82;runLater();GAME.t=1.3;beast.x=8;player.x=8;late4RushStep()`);
  assert.equal(f.run('uncovered'), 0, 'the complete physical corridor is advertised');
  assert.ok(f.run('marks.length<=9'), 'warning geometry stays bounded');
  assert.equal(f.run('hits.length'), 1);
  assert.ok(f.run('marks.every(m=>m.until>=LATE4.rushes[0].until)'), 'the path stays marked for the full damaging rush');
  assert.deepEqual(f.json('hits[0].opts.area'), { v: 1, shape: 'disc', x: 8, z: 0, r: 2.2 });
  assert.deepEqual(f.json('buffs[0].extra.area'), f.json('hits[0].opts.area'));
  f.run('player.z=4;late4RushStep()');
  assert.equal(f.run('hits.length'), 1, 'moving outside the warned corridor causes no second hit');
  assert.equal(f.run('netEntityAreaAccept(hits[0].opts.area,player)'), false);
});

test('gore tolerates a small crowd push while keeping its endpoint, but cancels a displaced start', () => {
  const f = fixture();
  f.run(beast('boar') + `late4Second(beast,player,10);player.x=100;beast.z=.2;GAME.t=.82;runLater()`);
  assert.equal(f.run('beast.motion.x1'), 14);
  assert.ok(Math.abs(f.run('beast.motion.z1')) < 1e-8);
  const displaced = fixture();
  displaced.run(beast('boar') + 'late4Second(beast,player,10);beast.z=.26;GAME.t=.82;runLater()');
  assert.equal(displaced.run('beast.motion'), null);
});

test('actual champion AI holds the gore crouch instead of chasing away from its warned start', () => {
  const f = fixture();
  f.run(beast('boar') + `Object.assign(beast,{l2risen:true,hp:40,maxHp:100,target:2,meleeRange:2.6,home:{x:0,z:0},
    ai:{pulled:true,l2:{next:10,next2:5,next3:.5,last:1,rally:true,enr:false,w:null}}});
    GAME.t=1;thinkMob(beast,.05);const held=beast.motion.kind;
    for(let i=0;i<16;i++){GAME.t+=.05;runLater();if(!beast.motion||!updateMotion(beast,.05))thinkMob(beast,.05)}
    const startAtLaunch={x:beast.x,z:beast.z,onGround:beast.onGround};GAME.t=1.85;runLater()`);
  assert.equal(f.run('held'), 'windup');
  assert.deepEqual(f.json('startAtLaunch'), { x: 0, z: 0, onGround: true });
  assert.equal(f.run('chases'), 0, 'the actual thinkMob->late2ChampThink->fightTarget chain cannot move during this crouch');
  assert.equal(f.run('beast.motion.kind'), 'leap', 'the advertised rush still launches in ordinary AI');
  assert.equal(f.run('beast.motion.x1'), 14);
});

test('every physical gore step stays inside a live warning through the final grace period', () => {
  const f = fixture();
  f.run(beast('boar') + `player.x=18;late4Second(beast,player,18);const marks=AOE_MARKS.slice();beast.z=.25;
    for(let i=0;i<65;i++){
      GAME.t+=.05;runLater();if(beast.motion)updateMotion(beast,.05);
      actors.push({...player,id:100+i,x:beast.x,z:beast.z+1.79});late4RushStep();
    }`);
  assert.ok(f.run('hits.length>15'));
  assert.ok(f.run('hits.every(h=>marks.some(m=>h.at<=m.until&&dist2(h.x,h.z,m.x,m.z)<=m.r*m.r))'));
  assert.equal(f.run('LATE4.rushes.length'), 0);
});

test('ground dragon breath advertises its whole sweep through its last damaging tick', () => {
  const f = fixture();
  f.run(`const beast={id:1,kind:'dragon',level:15,alive:true,x:0,y:0,z:0,yaw:0,hp:100,maxHp:100,faction:3,target:2};
    const player={id:2,kind:'humanoid',role:'player',alive:true,x:1,y:0,z:10,radius:.45,faction:0};actors.push(beast,player);
    GAME.t=.1;thinkDragon(beast,.05);const mark=AOE_MARKS[0],yaw=beast.yaw;
    player.x=Math.cos(yaw)*7.7+Math.sin(yaw)*18.4;player.z=Math.cos(yaw)*18.4-Math.sin(yaw)*7.7;
    for(let i=0;i<48;i++){GAME.t+=.05;thinkDragon(beast,.05)}`);
  assert.ok(Math.abs(f.run('mark.x-Math.sin(yaw)*13')) < 1e-8, 'the warning uses the actual post-turn direction');
  assert.ok(f.run('hits.some(h=>h.at>1.1)'), 'the old warning expired while this real breath was still damaging');
  assert.ok(f.run('hits.every(h=>h.at<=mark.until&&dist2(h.x,h.z,mark.x,mark.z)<=mark.r*mark.r)'));
  assert.ok(f.run('hits.every(h=>h.opts.area.r===mark.r&&h.opts.area.x===mark.x&&h.opts.area.z===mark.z)'));
  f.run('player.x=mark.x+mark.r+.01;player.z=mark.z');
  assert.equal(f.run('netEntityAreaAccept(hits[0].opts.area,player)'), false, 'an owner beyond the warning also rejects a delayed breath receipt');
});

test('the conservative breath warning contains actual cone hits across the entire sweep at multiple headings', () => {
  for (const heading of [-2.8, 0, .8]) {
    const f = fixture();
    f.run(`const heading=${heading},beast={id:1,kind:'dragon',level:15,alive:true,x:0,y:0,z:0,yaw:heading,hp:100,maxHp:100,faction:3,target:2};
      const player={id:2,kind:'humanoid',role:'player',alive:true,x:Math.sin(heading)*10,y:0,z:Math.cos(heading)*10,radius:3,faction:0};actors.push(beast,player);
      GAME.t=.1;thinkDragon(beast,.05);const mark=AOE_MARKS[0],area=DRAGON.act.area;
      for(let sweep=-.38;sweep<=.381;sweep+=.095)for(let x=-20;x<=20;x++)for(let z=-5;z<=25;z++){
        player.x=Math.cos(heading)*x+Math.sin(heading)*z;player.z=Math.cos(heading)*z-Math.sin(heading)*x;
        dragonBurn(beast,Math.sin(heading)*5.2,Math.cos(heading)*5.2,Math.sin(heading+sweep),Math.cos(heading+sweep),17,.36,.5,area);
      }`);
    assert.ok(f.run('hits.length>500'));
    assert.ok(f.run('hits.every(h=>dist2(h.x,h.z,mark.x,mark.z)<=mark.r*mark.r)'), `heading ${heading} has no damaging point outside its warning`);
  }
});

test('airborne breath without a ground warning keeps its existing damage semantics', () => {
  const f = fixture();
  f.run(beast('wolf') + 'player.x=0;player.z=8;dragonBurn(beast,0,5.2,0,1,17,.36,.5)');
  assert.equal(f.run('hits.length'), 1);
  assert.equal(f.run('Object.hasOwn(hits[0].opts,"area")'), false);
});

test('a fresh risen creature cannot use veteran moves before earning its own levels', () => {
  const f = fixture();
  f.run(beast('boar') + 'beast.level=1');
  assert.equal(f.run('late4Second(beast,player,10)'), false);
  assert.equal(f.run('AOE_MARKS.length'), 0);
});

test('dragon tail, ground breath and aerial strafe unlock only at the dragon own experience levels', () => {
  for (const [level, kind, expected] of [[3,'tail',false],[4,'tail',true],[6,'breath',false],[7,'breath',true],[14,'strafe',false],[15,'strafe',true]]) {
    const f = fixture();
    f.run(`const beast={id:1,kind:'dragon',level:${level},alive:true,x:0,y:0,z:0,yaw:0,hp:${kind === 'strafe' ? 40 : 100},maxHp:100,faction:3,target:2};
      const player={id:2,kind:'humanoid',role:'player',alive:true,x:0,y:0,z:${kind === 'tail' ? -6 : 10},radius:.45,faction:0};actors.push(beast,player);DRAGON.e=beast;
      DRAGON.nextTail=${kind === 'tail' ? 0 : 'Infinity'};DRAGON.nextBreath=${kind === 'breath' ? 0 : 'Infinity'};DRAGON.halfDone=false;
      GAME.t=1;thinkDragon(beast,.05)`);
    assert.equal(f.run(kind === 'strafe' ? "DRAGON.state==='takeoff'" : `DRAGON.act?.kind===${JSON.stringify(kind)}`), expected, `${kind} at own level${level}`);
  }
});
