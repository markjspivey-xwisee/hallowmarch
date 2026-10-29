import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = readFileSync(new URL('../../src/10c_lore.js', import.meta.url), 'utf8');
const declarations = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }).body;
function actual(name) {
  const node = declarations.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}

test('the dragon guide reports its own current level, independently of visitor and world level', () => {
  const c = vm.createContext({});
  vm.runInContext(`const GAME={player:{level:1}},DRAGON_LEVEL=1;
    const DRAGON={e:{level:7,alive:true,removed:false,x:1,z:2},state:'perch'};
    const zoneAt=()=>({name:'the hills'}),warLevel=()=>{throw new Error('world unlock is not a combat level')};
  ` + actual('chronDragon'), c);
  for (const visitor of [1, 20, 50]) {
    vm.runInContext(`GAME.player.level=${visitor}`, c);
    const html = vm.runInContext('chronDragon()', c);
    assert.match(html, /Cinderwing is <b>level 7<\/b>/);
    assert.doesNotMatch(html, /rises with you|For you it is/);
  }
  vm.runInContext('DRAGON.e.level=8', c);
  assert.match(vm.runInContext('chronDragon()', c), /Cinderwing is <b>level 8<\/b>/);
});

test('an absent dragon is described as fallen with its fresh level-one fallback', () => {
  const c = vm.createContext({});
  vm.runInContext(`const GAME={player:{level:50}},DRAGON_LEVEL=1,DRAGON={e:null};
    const warLevel=()=>50;
  ` + actual('chronDragon'), c);
  const html = vm.runInContext('chronDragon()', c);
  assert.match(html, /Cinderwing is <b>level 1<\/b>/);
  assert.match(html, /Cinderwing has fallen/);
});

test('camp summaries use living actors own levels and fresh empty-camp fallback without changing placement tiers', () => {
  const c = vm.createContext({ Map, Set });
  vm.runInContext(`let stage=1;
    const actors=new Map([
      [1,{level:2,alive:true}],[2,{level:7,alive:true}],[3,{level:40,alive:false}],
      [4,{level:50,alive:true,removed:true}],[5,{level:9,alive:true}],[6,{level:50,alive:true}]
    ]);
    const CAMPS=[
      {realm:0,type:'wolf',lmin:30,lmax:40,members:new Set([1,2,3,4,99])},
      {realm:0,type:'wolf',lmin:35,lmax:45,members:new Set([5])},
      {realm:0,type:'boar',lmin:20,lmax:25,members:new Set()},
      {realm:1,type:'wolf',lmin:40,lmax:50,members:new Set([6])},
      {realm:0,type:'wolf',elite:true,lmin:40,lmax:50,members:new Set([6])}
    ];
    const getEnt=id=>actors.get(id),MOB_PLURAL={wolf:'Wolves',boar:'Boars'},warLevel=()=>stage;
  ` + actual('campSummary'), c);
  const placement = vm.runInContext('JSON.stringify(CAMPS.map(c=>[c.lmin,c.lmax]))', c);
  const before = vm.runInContext('campSummary(0)', c);
  assert.match(before, /Wolves <span class="num">2–9<\/span>/);
  assert.match(before, /Boars <span class="num">1–1<\/span>/);
  vm.runInContext('stage=50', c);
  assert.equal(vm.runInContext('campSummary(0)', c), before);
  vm.runInContext('actors.get(5).level=12', c);
  assert.match(vm.runInContext('campSummary(0)', c), /Wolves <span class="num">2–12<\/span>/);
  assert.equal(vm.runInContext('JSON.stringify(CAMPS.map(c=>[c.lmin,c.lmax]))', c), placement);
});

test('the compact war aim identifies the next rank without changing full goals, progress or routes', () => {
  const guide = readFileSync(new URL('../../src/10f_guide2.js', import.meta.url), 'utf8');
  const nodes = parse(guide, { ecmaVersion: 'latest' }).body;
  const code = nodes.filter(n => n.type === 'FunctionDeclaration' && n.id.name === 'guideWarAimHTML'
    || n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === 'G2_WAR_STEPS'))
    .map(n => guide.slice(n.start, n.end)).join('\n');
  const c = vm.createContext({});
  vm.runInContext(`const GAME={player:{},prog:{lore:{}}}; let step=null;
    const aims=[{t:'Realm rank 2: Soldier',m:[0,'0 / 100 RP']}];
    const pathNext=()=>step, guideAims=()=>aims, guideShortWhere=()=>'the keep';
    const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),esc=String;` + code, c);
  const before = vm.runInContext('JSON.stringify(aims)', c);
  const html = vm.runInContext('guideWarAimHTML()', c);
  assert.match(html, /Next rank: 2/); assert.match(html, /data-g2="goals"/);
  assert.match(html, /<span class="d">0%<\/span>/);
  assert.equal(vm.runInContext('JSON.stringify(aims)', c), before);
  vm.runInContext(`step={id:'muster',short:'Join a warband'}`, c);
  const tracked = vm.runInContext('guideWarAimHTML()', c);
  assert.match(tracked, /data-g2="path"/); assert.match(tracked, /Join a warband/);
  assert.doesNotMatch(tracked, /Next rank/);
  vm.runInContext(`step=null;aims[0]={t:'Win campaign 1 for Logres'}`, c);
  assert.match(vm.runInContext('guideWarAimHTML()', c), /Win campaign 1 for Logres/);
});
