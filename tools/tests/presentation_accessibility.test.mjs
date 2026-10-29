import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const read = name => readFileSync(new URL('../../'+name, import.meta.url), 'utf8');
const shell = read('src/page.html');
const guard = shell.match(/<script>\s*(\/\* startup-file-guard[\s\S]*?)<\/script>/)[1];
function fileBoot() {
  const listeners = new Map(), timers = new Map();
  const element = () => ({hidden:false, attributes:{}, setAttribute(k,v){this.attributes[k]=v;}, replaceChildren(...v){this.children=v;}});
  const loading=element(), notice=element(); notice.hidden=true;
  const state={reloads:0};
  const context={window:{}, document:{getElementById:id=>id==='loading'?loading:notice, createElement:element},
    addEventListener:(k,f)=>listeners.set(k,f), removeEventListener:k=>listeners.delete(k),
    setTimeout:(f)=>{timers.set(1,f);return 1;},clearTimeout:id=>timers.delete(id), location:{reload:()=>state.reloads++}};
  vm.runInNewContext(guard,context);
  return {context,loading,notice,listeners,timers,state};
}
test('failed module dependency replaces indefinite loading with an alert and explicit retry',()=>{
  const b=fileBoot();b.listeners.get('error')({target:{tagName:'SCRIPT',type:'module'}});
  assert.equal(b.loading.hidden,true);assert.equal(b.notice.hidden,false);
  assert.equal(b.notice.attributes.role,'alert');
  assert.match(b.notice.children[1].textContent,/connection.*saved character is kept/);
  assert.equal(b.state.reloads,0);b.notice.children[2].onclick();assert.equal(b.state.reloads,1);
});
test('unrelated asset errors never interrupt startup; late successful engine load clears a truthful slow notice',()=>{
  const b=fileBoot();b.listeners.get('error')({target:{tagName:'LINK'}});
  assert.equal(b.notice.hidden,true);b.timers.get(1)();assert.equal(b.notice.hidden,false);
  assert.equal(b.notice.attributes.role,'status');
  assert.match(b.notice.children[0].textContent,/taking longer than expected/);
  assert.match(b.notice.children[1].textContent,/keep waiting/);
  assert.doesNotMatch(b.notice.children[1].textContent,/could not load/);
  b.context.window.__hmFileBoot.ready();assert.equal(b.notice.hidden,true);assert.equal(b.loading.hidden,false);
  assert.equal(b.timers.size,0);assert.equal(b.listeners.size,0);assert.equal(b.state.reloads,0);
});

test('a real module error after the slow notice updates its copy and keeps the same single retry',()=>{
  const b=fileBoot();b.timers.get(1)();
  const retry=b.notice.children[2], handler=retry.onclick;
  b.listeners.get('error')({target:{tagName:'SCRIPT',type:'module'}});
  assert.equal(b.notice.attributes.role,'alert');
  assert.match(b.notice.children[0].textContent,/could not finish loading/);
  assert.match(b.notice.children[1].textContent,/required game file could not load/);
  assert.equal(b.notice.children[2],retry);assert.equal(retry.onclick,handler);
  b.timers.get(1)();b.listeners.get('error')({target:{tagName:'SCRIPT',type:'module'}});
  assert.equal(b.notice.children[2],retry);assert.equal(b.notice.children.length,3);
  assert.equal(b.state.reloads,0);retry.onclick();assert.equal(b.state.reloads,1);
});
test('successful dependency load removes the watchdog before slow world generation',()=>{
  const b=fileBoot(), timeout=b.timers.get(1);b.context.window.__hmFileBoot.ready();timeout();
  assert.equal(b.notice.hidden,true);assert.equal(b.loading.hidden,false);
});

test('the main loading status is live while inventory detail and hint stay hidden and quiet',()=>{
  const loading=shell.slice(shell.indexOf('<div id="loading">'),shell.indexOf('<div id="title"'));
  const paragraph=id=>{
    const match=loading.match(new RegExp('<p\\b([^>]*\\bid="'+id+'"[^>]*)>([\\s\\S]*?)<\\/p>'));
    assert.ok(match,'loading paragraph '+id);return{attributes:match[1],text:match[2]};
  };
  const main=paragraph('loadmsg');
  assert.match(main.attributes,/role="status"/);assert.match(main.attributes,/aria-live="polite"/);
  assert.match(main.attributes,/aria-atomic="true"/);
  for(const id of ['load-detail','load-hint']){
    const el=paragraph(id);assert.match(el.attributes,/\bhidden\b/);
    assert.doesNotMatch(el.attributes,/aria-live|\brole=/);
  }
  assert.equal(paragraph('load-detail').text,'');
  assert.equal(paragraph('load-hint').text,'Keep this tab open while the view is prepared.');
  assert.match(loading,/role="progressbar" aria-label="Loading Hallowmarch"/);
});

test('actual rotating Chronicle tips remain readable without a competing live announcement',()=>{
  const lore=read('src/10c_lore.js'),tips=lore.match(/\(function loreLoadingTips\(\) \{[\s\S]*?\n\}\)\(\);/)[0];
  const children=[],callbacks=[],delayed=[];
  const inner={appendChild:el=>children.push(el)},loading={hidden:false,querySelector:()=>inner};
  const context={$:()=>loading,GAME:{ready:false},LOADING_TIPS:['First tip','Second tip'],
    shuffle:(_random,values)=>values,document:{createElement:()=>({attributes:{},style:{},setAttribute(k,v){this.attributes[k]=v;}})},
    setInterval(fn,ms){assert.equal(ms,6000);callbacks.push(fn);return 1;},clearInterval(){},setTimeout:fn=>delayed.push(fn)};
  vm.runInNewContext(tips,context);
  assert.equal(children.length,1);const tip=children[0];
  assert.match(tip.innerHTML,/From the Chronicle.*First tip/);assert.equal(tip.className,'lore-ltip');
  assert.equal(tip.attributes['aria-live'],undefined);assert.equal(tip.attributes.role,undefined);
  callbacks[0]();delayed[0]();
  assert.match(tip.innerHTML,/From the Chronicle.*Second tip/);
  assert.equal(tip.attributes['aria-live'],undefined);assert.equal(tip.attributes.role,undefined);
});
function motion({system=false,saved=null,blocked=false}={}) {
  const events={}, storage=new Map(saved===null?[]:[['hallowmarch.motion.v1',saved]]);
  const query={matches:system, addEventListener:(k,f)=>events[k]=f}, attr={};
  const context={matchMedia:()=>query,document:{documentElement:{setAttribute:(k,v)=>attr[k]=v}},
    localStorage:{getItem:k=>{if(blocked)throw Error();return storage.get(k);},setItem:(k,v)=>{if(blocked)throw Error();storage.set(k,v);}}};
  vm.createContext(context);vm.runInContext(read('src/02_render.js').split('const MOTION_QUERY')[1].split('const GRAPHICS_TRACE_KEY')[0].replace(/^/, 'const MOTION_QUERY'),context);
  return {context,query,events,attr,storage,run:s=>vm.runInContext(s,context)};
}
test('reduced effects respect system changes and a persisted browser override',()=>{
  const b=motion();assert.equal(b.run('REDUCE_MOTION'),false);
  b.query.matches=true;b.events.change();assert.equal(b.run('REDUCE_MOTION'),true);
  b.run("setMotionMode('reduced')");b.query.matches=false;b.events.change();assert.equal(b.run('REDUCE_MOTION'),true);
  assert.equal(b.attr['data-reduced-motion'],'true');assert.equal(motion({saved:b.storage.get('hallowmarch.motion.v1')}).run('REDUCE_MOTION'),true);
  b.run("setMotionMode('system')");assert.equal(b.run('REDUCE_MOTION'),false);
});
test('blocked or malformed preference storage cannot prevent play or disable device preference',()=>{
  const b=motion({blocked:true,system:true});b.run("setMotionMode('system')");assert.equal(b.run('REDUCE_MOTION'),true);
  assert.equal(motion({saved:'invalid'}).run('MOTION_MODE'),'system');
});
function extract(path,name){const src=read(path),start=src.indexOf('function '+name+'(');return src.slice(start,src.indexOf('\n}',start)+2);}
test('reduced effects suppress both incoming camera shake and screen flash without changing gameplay',()=>{
  const b=motion({system:true});
  Object.assign(b.context,{CAM:{shake:0.7}, GAME:{player:{x:0,z:0}},clamp:(n,a,z)=>Math.max(a,Math.min(z,n)), dist:Math.hypot,
    composite:{uniforms:{uFlash:{value:{w:0.8,set(){throw Error('flash applied');}}}}}});
  b.run(extract('src/09_player.js','cameraShake')+'\n'+extract('src/10_ui.js','flashScreen'));
  b.run('cameraShake(1,0,0);flashScreen([1,1,1],1)');
  assert.equal(b.context.CAM.shake,0);assert.equal(b.context.composite.uniforms.uFlash.value.w,0);
  assert.deepEqual(b.context.GAME.player,{x:0,z:0});
});
test('secondary text meets normal-text contrast against the dark menu surface',()=>{
  const opacity=Number(shell.match(/--ink-faint: rgba\(239, 230, 211, ([\d.]+)\)/)[1]);
  const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const backing=Number(shell.match(/--slate: rgba\(15, 17, 21, ([\d.]+)\)/)[1]);
  const overWhite=[15,17,21].map(v=>v*backing+255*(1-backing));
  for(const bg of [[26,28,34],[18,20,24],overWhite]) {
    const fg=[239,230,211].map((v,i)=>opacity*v+(1-opacity)*bg[i]);
    assert.ok((lum(fg)+.05)/(lum(bg)+.05)>=4.5,'secondary text on '+bg);
  }
});

test('changing effects suppresses an in-flight point flash immediately while expired lights are still cleaned up',()=>{
  const b=motion();const vectors=()=>Array.from({length:4},()=>({set(){}}));
  Object.assign(b.context,{FIRES:[],LANTERNS:[],REALMS:[],WAR:{relics:[]},PROJ:[],ENT:[],INDOOR:{on:false},
    GAME:{player:null},FLASHES:[{x:0,y:0,z:0,r:40,c:[3,3,3],t0:0,life:1}],renderTime:0.2,
    _plc:[],quality:{level:'low'},U:{uNight:{value:0},uPLPos:{value:vectors()},uPLCol:{value:vectors()},uPLN:{value:0}}});
  b.run(extract('src/05d_fire.js','gatherLights'));
  b.run('gatherLights(0,0,0)');assert.equal(b.context.U.uPLN.value,1);
  b.run("setMotionMode('reduced');gatherLights(0,0,0)");assert.equal(b.context.U.uPLN.value,0);
  assert.equal(b.context.FLASHES.length,1);
  b.context.renderTime=2;b.run('gatherLights(0,0,0)');assert.equal(b.context.FLASHES.length,0);
});
