// Actual-source fake-clock cases only. No browser, renderer, real input or timer.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
const read = name => readFileSync(new URL('../../src/' + name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
const sha = value => createHash('sha256').update(value).digest('hex');
const main = read('13_main.js'), live = read('14m_liveplay.js'), render = read('02_render.js');
const oracleRaw = readFileSync(new URL('./fixtures/adaptive_quality_da387.json',import.meta.url));
assert.equal(sha(oracleRaw),'cc0c7e28b487dce055a5b463ef6dcae628cd37dc44dc31ee26bb9e8241d48563');
const oracle = JSON.parse(oracleRaw);
function declaration(source,name) {
  const matches = parse(source,{ecmaVersion:'latest'}).body.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name
    || node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name === name));
  assert.equal(matches.length,1,name); return source.slice(matches[0].start,matches[0].end);
}
const transitionHook = "  // Observe the existing transition only; this never grants or extends play.\n  if (live !== wasLive && typeof resetAdaptiveQualityClock === 'function') resetAdaptiveQualityClock();\n";
function fixture({baseline=false,webdriver=false}={}) {
  const source = baseline ? oracle.main : main, humanSource = baseline ? oracle.live : live;
  let now = 0, focused = true, clockThrows = false;
  const calls = {logs:[],resize:0,worldWrites:[],rng:0,saves:[],net:[],frames:[],ticks:[],errors:[],cancel:0};
  const player = Object.freeze({id:'earned-player',hp:91}), rawGame = {started:true,built:false,player,t:3,dt:.1};
  const game = new Proxy(rawGame,{set(_target,key,value){calls.worldWrites.push([key,value]);throw Error('Quality sampler must not write GAME');}});
  const document = {hidden:false,hasFocus:()=>focused,listeners:new Map(),addEventListener(type,fn) {
    if (!this.listeners.has(type)) this.listeners.set(type,[]); this.listeners.get(type).push(fn);
  }};
  const math = Object.create(Math); math.random = () => {calls.rng++;throw Error('No RNG');};
  const context = vm.createContext({Object,Number,Math:math,document,navigator:{webdriver},performance:{now:()=>{if(clockThrows)throw Error('clock unavailable');return now;}},
    quality:{level:'medium',auto:true,dpr:1.25,msaa:2,scale:1},BOOT_SAFE:false,GAME:game,UI:{modal:null},NETWS:{worldReloadRequired:false},
    SEASON:Object.freeze({t:123,yearSec:8640}),W:Object.freeze({H:Object.freeze([1,2,3])}),NET:{fastKey:'old',fastAt:4},
    GRAPHICS_CONTEXT_LOST:false,GRAPHICS_STARTUP:{stopped:false},
    buildGrass(){throw Error('No live world rebuild in fixture');},buildFlowers(){throw Error('No live world rebuild in fixture');},
    resize(){calls.resize++;},updateTreeVisibility(){throw Error('No live world visibility mutation');},
    uiLog:(...args)=>calls.logs.push(args),saveNow:value=>{calls.saves.push(value);return Promise.resolve();},netOn:()=>false,
    netWsSuspendHuman:()=>calls.net.push('suspend'),netWsStartHumanPing:()=>calls.net.push('start'),
    renderTitleFrame:()=>Promise.resolve(),reportError:error=>calls.errors.push(error),
    requestAnimationFrame:fn=>{calls.frames.push(fn);},lastNow:100,
    tick:dt=>calls.ticks.push(dt),musicImpulsePrepareFrame(){},musicImpulsePrepareCancel(){calls.cancel++;},entryFeedbackCancel(){calls.cancel++;}});
  const parts = [declaration(render,'QUALITY_PRESETS'),declaration(source,'PERF')];
  if (!baseline) parts.push(declaration(source,'resetAdaptiveQualityClock'));
  parts.push(declaration(source,'setQuality'),declaration(source,'adaptQuality'),declaration(source,'frame'),
    ...['NET_HUMAN_PLAY_MS','NET_HUMAN_START_MS','NET_HUMAN_PLAY','netHumanEligible','netHumanLive','netHumanPublish'].map(name=>declaration(humanSource,name)));
  const visibility = parse(source,{ecmaVersion:'latest'}).body.find(node => node.type === 'ExpressionStatement'
    && source.slice(node.start,node.end).startsWith("document.addEventListener('visibilitychange'")
    && source.slice(node.start,node.end).includes('renderTitleFrame'));
  assert(visibility); parts.push(source.slice(visibility.start,visibility.end));
  parts.push('globalThis.api={adapt:adaptQuality,set:setQuality,frame,publish:netHumanPublish,human:NET_HUMAN_PLAY,state:()=>({...PERF}),'
    + 'grace:value=>{PERF.grace=value;}' + (baseline?'':',reset:resetAdaptiveQualityClock') + '};');
  vm.runInContext('"use strict";\n' + parts.join('\n'),context);
  const api = context.api;
  Object.assign(api.human,{player,acceptedAt:0,reportedLive:true,reportedActivity:0});
  return {api,context,calls,document,rawGame,
    sample(milliseconds,dt=.1){now=milliseconds;api.adapt(dt);},
    now(value){now=value;},clockThrows(value){clockThrows=value;},focus(value){focused=value;},
    visibility(hidden){document.hidden=hidden;for(const fn of document.listeners.get('visibilitychange')||[])fn();},
    world(){return JSON.stringify({GAME:rawGame,SEASON:context.SEASON,W:context.W});}};
}

test('independent da387 pins and whole-source inverses restrict changes to private clock/reset hooks',()=>{
  assert.equal(oracle.revision,'da387c00c5577722bc1a73ae260f67d0f336377f');
  assert.equal(sha(oracle.main),'350c065e63ba6fca4cbb691819d454a27a2d7cce04ff66c605d3c23b51507388');
  assert.equal(sha(oracle.live),'0513a8d76d14c09862d40ad288825b5801f21b311786dd120d103de2a283541b');
  assert.equal(sha(render),oracle.hashes['02_render.js']);
  assert.equal(declaration(main,'tick'),declaration(oracle.main,'tick'),'The complete tick stays byte-identical');
  const oldTail = declaration(oracle.main,'adaptQuality').slice(declaration(oracle.main,'adaptQuality').indexOf('  PERF.grace -= dt;'));
  assert.equal(declaration(main,'adaptQuality').slice(declaration(main,'adaptQuality').indexOf('  PERF.grace -= dt;')),oldTail);
  const beginning = main.indexOf(declaration(main,'PERF')), end = main.indexOf(declaration(main,'adaptQuality')) + declaration(main,'adaptQuality').length;
  const touchInventoryCopy = "IS_TOUCH ? 'Tap Items' : 'Press I'";
  assert.equal(main.split(touchInventoryCopy).length,2,'Unique approved touch inventory label');
  const inverse = (main.slice(0,beginning) + declaration(oracle.main,'PERF') + '\n' + declaration(oracle.main,'adaptQuality') + main.slice(end))
    .replace(/^\s+resetAdaptiveQualityClock\(\);\n/gm,'')
    .replace(touchInventoryCopy,"IS_TOUCH ? 'Tap Kit' : 'Press I'");
  assert.equal(inverse,oracle.main);
  assert.equal(live.replace(transitionHook,''),oracle.live,'No grant, timer, input, save or transport condition changes');
  const reset = declaration(main,'resetAdaptiveQualityClock');
  assert(!/performance|Math|GAME|NET_|save|setTimeout|requestAnimationFrame|quality\./.test(reset));
});

test('0.5-second active frames respond to wall periods while the passed simulation delta stays0.1',()=>{
  const f = fixture(), before = fixture({baseline:true}), world = f.world();
  f.sample(0,.1); before.sample(0,.1);
  for(let i=1;i<=18;i++){f.sample(i*500,.1);before.sample(i*500,.1);assert.equal(f.context.quality.level,'medium');}
  f.sample(9500,.1);before.sample(9500,.1);
  assert.equal(f.context.quality.level,'low');assert.equal(before.context.quality.level,'medium','Pinned old sampler still counts only0.1 per call');
  assert.equal(f.api.state().grace,5);assert.equal(f.calls.logs.length,1);
  assert.equal(f.world(),world);assert.deepEqual(f.calls.worldWrites,[]);assert.equal(f.calls.rng,0);
});
test('ordinary60FPS does not reduce quality after multiple complete averaging windows',()=>{
  const f = fixture();f.sample(0);
  for(let i=1;i<=1200;i++)f.sample(i*1000/60,1/60);
  assert.equal(f.context.quality.level,'medium');assert.equal(f.calls.logs.length,0);assert.equal(f.calls.resize,0);
});
test('original grace-crossing quantization is explicit: one8s eligible period may satisfy both gates once',()=>{
  const f = fixture();f.sample(0);f.sample(8000);
  assert.equal(f.context.quality.level,'low');assert.equal(f.calls.logs.length,1);assert.equal(f.api.state().grace,5);
  assert.equal(f.api.state().lastAt,null,'Automatic setQuality resets the private anchor');
  f.sample(8001);assert.equal(f.context.quality.scale,1,'The same period never applies multiple reductions');
});
test('webdriver still refuses adaptation even withauto true and severe eligible wall gaps',()=>{
  const f = fixture({webdriver:true});for(const at of [0,10000,20000,30000])f.sample(at);
  assert.equal(f.context.quality.auto,true);assert.equal(f.context.quality.level,'medium');assert.equal(f.api.state().grace,6);
  assert.equal(f.api.state().lastAt,null);assert.equal(f.calls.logs.length,0);
});
test('manual preset changes clear partial sampling and never re-enable automatic mode',()=>{
  const f = fixture();f.api.grace(0);f.sample(0);f.sample(1000);assert.equal(f.api.state().window,1);
  const remainingGrace=f.api.state().grace;
  f.api.set('high');assert.equal(f.context.quality.auto,false);assert.equal(f.context.quality.userChanged,true);
  assert.equal(f.api.state().window,0);assert.equal(f.api.state().lastAt,null);
  f.sample(20000);assert.equal(f.context.quality.level,'high');
  f.api.set('high',true);f.sample(30000);assert.equal(f.context.quality.level,'high','New automatic choice starts with an anchor');
  assert.equal(f.api.state().window,0);assert.equal(f.api.state().grace,remainingGrace);
});
test('hidden+visible transitions between samples exclude hidden wall time and preserve remaining grace',()=>{
  const f = fixture();f.sample(0);f.sample(500);const grace = f.api.state().grace;
  f.visibility(true);f.now(40000);f.visibility(false);f.sample(40000);
  assert.equal(f.api.state().grace,grace);assert.equal(f.api.state().window,0);assert.equal(f.context.quality.level,'medium');
  f.sample(40500);assert.equal(f.api.state().grace,grace-.5);
});
for(const modal of ['menu','prologue'])test('quick '+modal+' entry/exit between rAFs resets only sampling via actual live publication',()=>{
  const f = fixture();f.api.grace(0);f.sample(0);f.sample(1500);assert.equal(f.api.state().window,1.5);
  f.context.UI.modal=modal;f.api.publish();assert.equal(f.api.state().lastAt,null);
  f.now(50000);f.context.UI.modal=null;f.api.publish();f.sample(50000);
  assert.equal(f.api.state().window,0);assert.equal(f.context.quality.level,'medium');
  f.sample(50500);assert.equal(f.api.state().window,.5);assert.equal(f.context.quality.level,'medium');
});
test('live eligibility/owner boundaries do not renew activity or change original publication effects',()=>{
  const a = fixture({baseline:true}), b = fixture();
  for(const f of [a,b]){f.sample(0);f.sample(500);f.focus(false);f.api.publish();f.now(1000);f.focus(true);f.api.publish();}
  assert.deepEqual(JSON.parse(JSON.stringify(b.api.human)),JSON.parse(JSON.stringify(a.api.human)));
  assert.deepEqual(JSON.parse(JSON.stringify(b.calls.saves)),JSON.parse(JSON.stringify(a.calls.saves)));assert.deepEqual(b.calls.net,a.calls.net);
  assert.equal(b.api.human.activity,0);assert.equal(b.api.human.acceptedAt,0);
  assert.equal(b.api.state().lastAt,null);assert.deepEqual(b.calls.worldWrites,[]);
});
test('expired eligibility and context-stop refuse sampling; recovery starts a fresh anchor',()=>{
  const f = fixture();f.sample(0);f.sample(500);const grace=f.api.state().grace;
  f.sample(90000);assert.equal(f.api.state().lastAt,null,'Expired existing human lease is not extended');
  assert.equal(f.api.human.acceptedAt,0);f.now(91000);f.api.human.acceptedAt=91000;f.sample(91000);
  for(const key of ['GRAPHICS_CONTEXT_LOST','stopped']){
    if(key==='stopped')f.context.GRAPHICS_STARTUP.stopped=true;else f.context[key]=true;
    f.api.frame(91500);assert.equal(f.api.state().lastAt,null);
    if(key==='stopped')f.context.GRAPHICS_STARTUP.stopped=false;else f.context[key]=false;
    f.sample(92000);assert.equal(f.api.state().lastAt,92000);assert.equal(f.api.state().grace,grace);
  }
});
test('invalid, equal, backward and throwing clocks cannot count samples or reduce quality',()=>{
  for(const bad of [NaN,Infinity,-1,1000,500]){
    const f = fixture();f.api.grace(0);f.sample(0);f.sample(1000);f.sample(bad);
    assert.equal(f.api.state().lastAt,null);assert.equal(f.api.state().window,0);assert.equal(f.context.quality.level,'medium');
    f.sample(2000);assert.equal(f.api.state().window,0,'Next valid sample only anchors');
  }
  const f = fixture();f.sample(0);f.clockThrows(true);
  assert.doesNotThrow(()=>f.sample(1000));assert.equal(f.api.state().lastAt,null);
});
test('a replacement player cannot inherit the previous owner frame interval',()=>{
  const f = fixture();f.api.grace(0);f.sample(0);f.sample(1000);
  f.rawGame.player=Object.freeze({id:'replacement',hp:100});f.api.human.player=f.rawGame.player;
  f.sample(2000);assert.equal(f.api.state().window,0);assert.equal(f.api.state().player,f.rawGame.player);
  assert.equal(f.context.quality.level,'medium');assert.deepEqual(f.calls.worldWrites,[]);
});
test('actual frame preserves capped physics arguments/request ordering and never reads RNG',()=>{
  const a = fixture({baseline:true}), b = fixture();
  a.api.frame(600);b.api.frame(600);
  assert.deepEqual(b.calls.ticks,a.calls.ticks);assert.deepEqual(b.calls.ticks,[.1]);
  assert.equal(b.calls.frames.length,a.calls.frames.length);assert.equal(b.calls.frames.length,1);
  assert.equal(b.context.lastNow,a.context.lastNow);assert.equal(b.calls.rng,0);assert.deepEqual(b.calls.worldWrites,[]);
});
