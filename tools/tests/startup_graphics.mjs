import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL('src/' + name, root), 'utf8');
const render = read('02_render.js').split('const camera =')[0];
function extract(source, name) {
  let start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0);
  if(source.slice(start-6,start)==='async ')start-=6;
  const end = source.indexOf('\n}', start);
  assert.ok(end > start);
  return source.slice(start, end + 2);
}
const apply = extract(read('12_save.js'), 'applySettings');
const saveGraphics = extract(read('12_save.js'), 'graphicsSaveSettings');
const phone = extract(read('13q_lod.js'), 'phoneQualityPick');
const set = extract(read('13_main.js'), 'setQuality');
const automatic = read('13_main.js').split('\n').find(line => line.startsWith('quality.auto ='));

function boot({url='https://march.example/?tag=a&tag=b', touch=false, failure='', webgl2=true, storage=new Map(), session=new Map(), storageFailure=false}={}) {
  const callbacks={}, options=[], state={disposed:false, reloads:0};
  function element(tag) {
    return {tag,hidden:true,style:{},attributes:{},children:[],
      setAttribute(k,v) { this.attributes[k]=v; },
      replaceChildren(...children) { this.children=children; },
      appendChild(child) { this.children.push(child); if(child.id) elements[child.id]=child; return child; },
      addEventListener(k,f) { callbacks[k]=f; }};
  }
  const elements={scene:element('canvas'),loading:element('div'),nogl:element('p')};
  elements.loading.hidden=false;
  const browserStorage = map => ({
    getItem(k) { if(storageFailure) throw Error('Storage unavailable'); return map.get(k) ?? null; },
    setItem(k,v) { if(storageFailure) throw Error('Storage unavailable'); map.set(k,String(v)); },
    removeItem(k) { if(storageFailure) throw Error('Storage unavailable'); map.delete(k); },
  });
  const ctx={URL,URLSearchParams,localStorage:browserStorage(storage),sessionStorage:browserStorage(session),
    performance:{now:()=>0},
    setTimeout:()=>0,clearTimeout:()=>{},
    requestAnimationFrame:()=>0,cancelAnimationFrame:()=>{},
    location:{href:url,search:new URL(url).search,reload(){state.reloads++;}},
    document:{getElementById:k=>elements[k],createElement:element},
    matchMedia:q=>({matches:q==='(pointer: coarse)'&&touch}),
    window:{addEventListener(k,f){callbacks['window:'+k]=f;}},navigator:{maxTouchPoints:touch?5:0,deviceMemory:8,hardwareConcurrency:8},
    screen:{width:1024,height:768},
    THREE:{LinearSRGBColorSpace:1,NoToneMapping:0,HalfFloatType:2,UnsignedByteType:3,
      WebGLRenderer:class {
        constructor(o) {
          options.push(o);
          if (failure) {
            callbacks.webglcontextcreationerror({statusMessage:failure});
            throw new Error('Error creating WebGL context.');
          }
          this.capabilities={isWebGL2:webgl2};
          this.extensions={has:()=>true};
        }
        setClearColor() {}
        getContext() {return {ALIASED_POINT_SIZE_RANGE:1,getParameter:()=>[1,64],isContextLost:()=>false};}
        dispose(){state.disposed=true;}
      }}
  };
  vm.createContext(ctx);
  let error;
  try { vm.runInContext(render,ctx); } catch(e) {error=e;}
  if(!error) {
    vm.runInContext(automatic,ctx);
    vm.runInContext('globalThis.__startup={safe:BOOT_SAFE,quality,rtType:RT_TYPE};',ctx);
  }
  return {ctx,elements,options,state,error,callbacks,storage,session};
}
test('normal desktop quality and renderer preference remain unchanged',()=>{
  const b=boot(); assert.equal(b.error,undefined);
  assert.equal(b.ctx.__startup.quality.level,'high');
  assert.equal(b.ctx.__startup.quality.auto,true);
  assert.equal(b.options[0].powerPreference,'high-performance');
  assert.equal(boot({url:'https://march.example/?safe=0'}).ctx.__startup.quality.level,'high');
});
test('safe recovery selects Low before any scene or world allocation',()=>{
  const b=boot({url:'https://march.example/?safe=1'});
  assert.equal(b.error,undefined);
  assert.equal(b.ctx.__startup.quality.level,'low');
  assert.equal(b.ctx.__startup.quality.msaa,0);
  assert.equal(b.ctx.__startup.quality.dpr,1);
  assert.equal(b.ctx.__startup.quality.auto,false);
  assert.equal(b.options[0].powerPreference,'default');
  assert.equal(b.ctx.__startup.rtType,b.ctx.THREE.UnsignedByteType);
  assert.ok(b.ctx.window.__hmStartup,'trace exists before world generation');
});
test('blocked creation reports browser reason and preserves retry URL without reload',()=>{
  const reason='Web page caused context loss and was blocked';
  const original='https://march.example/?server=wss%3A%2F%2Frelay.example%2Fws%3Froom%3Done&tag=a&tag=b&safe=0#return';
  const b=boot({url:original,failure:reason});
  assert.match(b.error.message,/WebGL context/);
  assert.equal(b.elements.loading.style.display,'none');
  assert.equal(b.elements.nogl.hidden,false);
  assert.equal(b.elements.nogl.attributes.role,'alert');
  const children=b.elements.nogl.children;
  assert.equal(children[0].textContent,'Graphics could not start');
  assert.equal(children[1].textContent,reason);
  const expected=new URL(original);expected.searchParams.set('safe','1');
  assert.equal(children.find(x=>x.tag==='a').href,expected.href);
  assert.equal(b.state.reloads,0);
  assert.ok(b.ctx.window.__hmStartup,'failure retains the early startup trace');
});
test('unsupported WebGL 2 is distinguished and the failed renderer is disposed',()=>{
  const b=boot({webgl2:false});
  assert.match(b.error.message,/WebGL 2 is not available/);
  assert.match(b.elements.nogl.children[1].textContent,/WebGL 2 is not available/);
  assert.equal(b.state.disposed,true);
});
function settings(b) {
  const ctx=b.ctx;
  ctx.GAME={built:false};
  ctx.AUDIO={on:true};ctx.calls=[];
  ctx.setTimeMode=v=>ctx.calls.push(['time',v]);
  ctx.setMusicVolume=v=>ctx.calls.push(['music',v]);
  ctx.soundApplySettings=st=>ctx.calls.push(['sound',st.sound]);
  ctx.setWeatherMode=v=>ctx.calls.push(['weather',v]);
  vm.runInContext(set+'\n'+apply,ctx);
}
test('safe boot ignores saved High while still applying nongraphics settings',()=>{
  const b=boot({url:'https://march.example/?safe=1'});settings(b);
  vm.runInContext("applySettings({quality:'high',auto:true,tod:'night',sound:false,music:0.25,weather:'clear'})",b.ctx);
  assert.equal(b.ctx.__startup.quality.level,'low');
  assert.equal(b.ctx.__startup.quality.auto,false);
  assert.equal(b.ctx.AUDIO.on,false);
  assert.ok(b.ctx.calls.some(([name,value])=>name==='music'&&value===0.25));
  assert.ok(b.ctx.calls.some(([name,value])=>name==='weather'&&value==='clear'));
});
test('normal saved quality still applies and manual safe-session changes stay usable',()=>{
  const normal=boot();settings(normal);
  vm.runInContext("applySettings({quality:'low',auto:false})",normal.ctx);
  assert.equal(normal.ctx.__startup.quality.level,'low');
  const safe=boot({url:'https://march.example/?safe=1'});settings(safe);
  vm.runInContext("setQuality('medium')",safe.ctx);
  assert.equal(safe.ctx.__startup.quality.level,'medium');
  assert.equal(safe.ctx.__startup.quality.auto,false);
});
test('tablet selection cannot raise recovery quality, ordinary tablets remain Medium',()=>{
  const safe=boot({url:'https://march.example/?safe=1',touch:true});
  vm.runInContext(phone,safe.ctx);
  assert.equal(vm.runInContext('phoneQualityPick()',safe.ctx),'low');
  const normal=boot({touch:true});vm.runInContext(phone,normal.ctx);
  assert.equal(vm.runInContext('phoneQualityPick()',normal.ctx),'medium');
});

test('automatic saves preserve the existing graphics preference until a manual change',()=>{
  const b=boot({url:'https://march.example/?safe=1'});settings(b);
  b.ctx.SAVE={loaded:{settings:{quality:'high',auto:true}}};
  vm.runInContext(phone+'\n'+saveGraphics,b.ctx);
  assert.equal(vm.runInContext('graphicsSaveSettings().quality',b.ctx),'high');
  assert.equal(vm.runInContext('graphicsSaveSettings().auto',b.ctx),true);
  assert.equal(b.ctx.__startup.quality.level,'low');
  vm.runInContext("setQuality('low')",b.ctx);
  assert.equal(vm.runInContext('graphicsSaveSettings().quality',b.ctx),'low');
  assert.equal(vm.runInContext('graphicsSaveSettings().auto',b.ctx),false);
});
test('recovery without a saved preference retains the ordinary device default on save',()=>{
  const desk=boot({url:'https://march.example/?safe=1'});desk.ctx.SAVE={loaded:null};
  vm.runInContext(phone+'\n'+saveGraphics,desk.ctx);
  assert.equal(vm.runInContext('graphicsSaveSettings().quality',desk.ctx),'high');
  assert.equal(vm.runInContext('graphicsSaveSettings().auto',desk.ctx),true);
  const tablet=boot({url:'https://march.example/?safe=1',touch:true});tablet.ctx.SAVE={loaded:null};
  vm.runInContext(phone+'\n'+saveGraphics,tablet.ctx);
  assert.equal(vm.runInContext('graphicsSaveSettings().quality',tablet.ctx),'medium');
});

test('a context lost while a boot step yields prevents subsequent world allocation',async()=>{
  const b=boot({url:'https://march.example/?safe=1'});
  assert.equal(b.error,undefined);
  let paint;
  b.ctx.nextPaint=()=>new Promise(resolve=>{paint=resolve;});
  b.ctx.$=id=>b.elements[id]||(b.elements[id]={style:{}});
  b.ctx.BOOT_STEPS=[];
  b.ctx.allocate=()=>{throw new Error('allocation must not run after loss');};
  const source=read('13_main.js');
  const stepStart=source.indexOf('async function loadStep(');
  const stepEnd=source.indexOf('\nasync function boot()',stepStart);
  assert.ok(stepStart>=0&&stepEnd>stepStart);
  vm.runInContext(source.slice(stepStart,stepEnd),b.ctx);
  const pending=vm.runInContext("loadStep(0.5,'Controlled allocation',allocate)",b.ctx);
  assert.equal(typeof paint,'function');
  vm.runInContext('GRAPHICS_CONTEXT_LOST=true',b.ctx);
  paint();
  await assert.rejects(pending,/Graphics stopped during Controlled allocation/);
  assert.equal(b.ctx.BOOT_STEPS.length,0,'an interrupted allocation is not counted as complete');
});

const recoveryKey='hallowmarch.graphics.recovery.v1', traceKey='hallowmarch.graphics.trace.v1';
test('recovery is remembered per browser without changing native saved preferences',()=>{
  const storage=new Map([['hallowmarch.save.v1','native-save-sentinel'],['other','keep']]);
  const explicit=boot({url:'https://march.example/?safe=1',storage});
  assert.equal(explicit.ctx.window.__hmStartup.recoverySource,'explicit');
  assert.deepEqual(JSON.parse(storage.get(recoveryKey)),{v:1,enabled:true});
  const remembered=boot({storage}); settings(remembered);
  remembered.ctx.SAVE={loaded:{settings:{quality:'high',auto:true}}};
  vm.runInContext(phone+'\n'+saveGraphics,remembered.ctx);
  assert.equal(remembered.ctx.window.__hmStartup.recoverySource,'remembered');
  assert.equal(remembered.ctx.__startup.quality.level,'low');
  assert.equal(vm.runInContext('graphicsSaveSettings().quality',remembered.ctx),'high');
  assert.equal(vm.runInContext('graphicsSaveSettings().auto',remembered.ctx),true);
  assert.equal(storage.get('hallowmarch.save.v1'),'native-save-sentinel');
  assert.equal(storage.get('other'),'keep');
});
test('legacy reduced and failed session traces migrate to remembered recovery',()=>{
  for(const trace of [{recovery:true},{lost:1},{stopped:true}]) {
    const storage=new Map(), session=new Map([[traceKey,JSON.stringify(trace)]]);
    const b=boot({storage,session});
    assert.equal(b.error,undefined);
    assert.equal(b.ctx.window.__hmStartup.recoverySource,'previous-session');
    assert.equal(b.ctx.__startup.quality.level,'low');
    assert.deepEqual(JSON.parse(storage.get(recoveryKey)),{v:1,enabled:true});
    assert.equal(boot({storage}).ctx.window.__hmStartup.recoverySource,'remembered');
  }
});
test('explicit standard retry clears only recovery and outranks legacy failure trace',()=>{
  const storage=new Map([[recoveryKey,JSON.stringify({v:1,enabled:true})],['hallowmarch.save.v1','native-sentinel'],['other','keep']]);
  const session=new Map([[traceKey,JSON.stringify({recovery:true,lost:1,stopped:true})]]);
  const b=boot({url:'https://march.example/?safe=0',storage,session});
  assert.equal(b.error,undefined);
  assert.equal(b.ctx.__startup.safe,false);
  assert.equal(b.ctx.window.__hmStartup.recoverySource,'standard');
  assert.equal(storage.has(recoveryKey),false);
  assert.equal(storage.get('hallowmarch.save.v1'),'native-sentinel');
  assert.equal(storage.get('other'),'keep');
  assert.equal(boot({storage,session}).ctx.__startup.safe,false,'new standard trace does not re-enable old failure');
});
test('missing malformed and blocked browser storage never prevent graphics selection',()=>{
  for(const value of [null,'{','true','{}','{"v":2,"enabled":true}','{"v":1,"enabled":"true"}']) {
    const storage=new Map(value===null?[]:[[recoveryKey,value]]);
    const b=boot({storage});
    assert.equal(b.error,undefined);
    assert.equal(b.ctx.__startup.safe,false);
  }
  for(const safe of ['0','1']) {
    const b=boot({url:'https://march.example/?safe='+safe,storageFailure:true});
    assert.equal(b.error,undefined);
    assert.equal(b.ctx.__startup.safe,safe==='1');
  }
  assert.equal(boot({storageFailure:true}).error,undefined);
});
test('actual context loss persists recovery before a later bare launch',()=>{
  const storage=new Map(), b=boot({storage});
  let prevented=0;
  b.callbacks.webglcontextlost({preventDefault(){prevented++;},statusMessage:'device reset'});
  assert.equal(prevented,1);
  assert.equal(b.ctx.window.__hmStartup.stopped,true);
  assert.equal(b.ctx.window.__hmStartup.lost,1);
  assert.deepEqual(JSON.parse(storage.get(recoveryKey)),{v:1,enabled:true});
  assert.equal(boot({storage}).ctx.__startup.safe,true);
  assert.equal(b.state.reloads,0);
});
test('standard recovery link drops diagnostic mode and preserves URL and native preference',()=>{
  const url='https://march.example/?server=wss%3A%2F%2Frelay.example%2Fws&tag=a&tag=b&safe=1&gpuDiag=1#return';
  const b=boot({url}); b.elements.title={children:[],appendChild(child){this.children.push(child);if(child.id)b.elements[child.id]=child;}};
  const expected=new URL(url); expected.searchParams.set('safe','0'); expected.searchParams.delete('gpuDiag');
  assert.equal(vm.runInContext('graphicsRecoveryURL(false)',b.ctx),expected.href);
  vm.runInContext('graphicsRecoveryNotice(); graphicsRecoveryNotice();',b.ctx);
  assert.equal(b.elements.title.children.length,1);
  const notice=b.elements.title.children[0];
  assert.equal(notice.attributes.role,'status');
  assert.equal(notice.children.find(child=>child.tag==='a').href,expected.href);
  assert.match(notice.children[0].textContent,/saved graphics preferences are unchanged/);
});

function titleFixture() {
  const main=read('13_main.js');
  const declaration=main.split('\n').find(line=>line.startsWith('let TITLE_FRAME_PROMISE ='));
  assert.ok(declaration,'test executes the actual title helper state');
  const events=[], fences=[], glErrors=[], originalTrail={name:'live-trail'}, originalShaderError=()=>{};
  const documentListeners=new Map(),canvasListeners=new Map();
  const listeners=map=>({
    addEventListener(name,fn){if(!map.has(name))map.set(name,new Set());map.get(name).add(fn);},
    removeEventListener(name,fn){map.get(name)?.delete(fn);},
  });
  const ctx={
    Promise,Uint8Array,Math,
    GAME:{built:true,started:false,ready:true,t:27,player:null},
    GRAPHICS_CONTEXT_LOST:false,GRAPHICS_STARTUP:{stopped:false,titleSubmitted:0,titleCompleted:0},
    document:{hidden:false,...listeners(documentListeners)},canvas:listeners(canvasListeners),window:{__hm:{ready:true}},
    diagnostic:false,graphicsDiagnosticActive(){return ctx.diagnostic;},
    graphicsAssertActive(){if(ctx.GRAPHICS_CONTEXT_LOST)throw Error('lost');},
    THREE:{RGBAFormat:1,UnsignedByteType:2,NearestFilter:3,
      DataTexture:class {constructor(data,w,h){this.image={data,width:w,height:h};}}},
    U:{uTrail:{value:originalTrail}},
    sceneRT:{name:'scene-target'},scene:{name:'world-scene'},camera:{name:'title-camera'},gl:{},
    renderer:{
      debug:{onShaderError:originalShaderError,checkShaderErrors:false},
      info:{reset(){events.push('reset');}},
      setRenderTarget(target){assert.equal(target,ctx.sceneRT);events.push('target');},
      setClearColor(){},clear(){events.push('clear');},
      render(scene,camera){
        assert.equal(scene,ctx.scene); assert.equal(camera,ctx.camera);
        assert.deepEqual(Array.from(ctx.U.uTrail.value.image.data),[128,128,0,0]);
        events.push('scene');
        if(ctx.failShader) ctx.renderer.debug.onShaderError({isContextLost:()=>false,getProgramInfoLog:()=> 'controlled link failure'},{});
      },
    },
    gpuDiagGlErrors(){return glErrors.shift() || [];},
    gpuDiagPrepareView(options){assert.equal(options.weatherGpu,false);events.push('prepare');},
    renderPost(){events.push('post');},
    gpuDiagWaitForFence(){events.push('fence');return new Promise((resolve,reject)=>fences.push({resolve,reject}));},
    graphicsRememberRecovery(){events.push('remember');},
    graphicsCheckpoint(){events.push('checkpoint');},
    graphicsStartFailure(){events.push('failure');},
    netHumanSync(){throw Error('title must not activate a human');},
    netHumanLive(){return false;},
    netPump(){throw Error('title must not pump network');},
    simStep(){throw Error('title must not simulate');},
    saveNow(){throw Error('title must not save');},
    fetch(){throw Error('title must not fetch');},
    createPlayer(){throw Error('stopped graphics must not create a character');},
    requestAnimationFrame(){throw Error('stopped graphics must not schedule a frame');},
    reportError(error){throw error;},
  };
  vm.createContext(ctx);
  vm.runInContext(declaration+'\n'+['renderTitleFrame','waitForTitleVisibility','renderFirstTitleFrame','tick','frame','resize','startGame'].map(name=>extract(main,name)).join('\n'),ctx);
  return {ctx,events,fences,glErrors,documentListeners,canvasListeners,originalTrail,originalShaderError,run:()=>vm.runInContext('renderTitleFrame()',ctx)};
}
test('actual frozen title submits one scene and post frame and waits for completion without play',async()=>{
  const f=titleFixture(), pending=f.run();
  assert.deepEqual(f.events,['prepare','reset','target','clear','scene','post','fence']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleSubmitted,1);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0,'submission is not GPU completion');
  assert.equal(f.ctx.U.uTrail.value,f.originalTrail,'shared uniform is restored before the asynchronous fence');
  assert.equal(f.ctx.renderer.debug.onShaderError,f.originalShaderError);
  assert.equal(f.ctx.renderer.debug.checkShaderErrors,false);
  assert.equal(f.ctx.GAME.t,27); assert.equal(f.ctx.GAME.started,false);
  f.fences[0].resolve({waitMs:12});
  assert.equal(await pending,true);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleFenceWaitMs,12);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.events.filter(value=>value==='scene').length,1,'standby does not resubmit title frames');
  assert.equal(f.ctx.GAME.t,27); assert.equal(f.ctx.GAME.player,null);
});
test('concurrent explicit title redraw requests coalesce while the first GPU fence is pending',async()=>{
  const f=titleFixture(), first=f.run();
  assert.equal(f.run(),first); assert.equal(f.run(),first);
  assert.equal(f.fences.length,1);
  f.fences[0].resolve({waitMs:3});
  for(let n=0;n<4&&f.fences.length<2;n++)await Promise.resolve();
  assert.equal(f.fences.length,2,'one follow-up frame covers all requests during the first draw');
  f.fences[1].resolve({waitMs:4});
  await first;
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleSubmitted,2);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,2);
  assert.equal(f.ctx.U.uTrail.value,f.originalTrail);
});
test('hidden playing diagnostic unbuilt or lost title never submits a frame',async()=>{
  for(const mutate of [
    c=>{c.document.hidden=true;},c=>{c.GAME.started=true;},
    c=>{c.diagnostic=true;},c=>{c.GAME.built=false;},c=>{c.GRAPHICS_CONTEXT_LOST=true;},
  ]) {
    const f=titleFixture(); mutate(f.ctx);
    assert.equal(await f.run(),false); assert.equal(f.events.length,0); assert.equal(f.fences.length,0);
  }
});
test('title fence failure latches stopped graphics and blocks title play tick resize and RAF',async()=>{
  const f=titleFixture(), pending=f.run();
  f.fences[0].reject(Error('controlled title fence timeout'));
  await assert.rejects(pending,/controlled title fence timeout/);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleSubmitted,1);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);
  assert.equal(f.ctx.GAME.ready,false); assert.equal(f.ctx.window.__hm.ready,false);
  assert.equal(f.ctx.U.uTrail.value,f.originalTrail);
  assert.equal(f.events.filter(value=>value==='remember').length,1);
  assert.equal(await f.run(),false);
  const before=[...f.events];
  vm.runInContext('startGame({}); tick(0.1); frame(1000); resize();',f.ctx);
  assert.deepEqual(f.events,before);
  assert.equal(f.ctx.GAME.started,false); assert.equal(f.ctx.GAME.t,27);
});
test('title shader and GL errors never produce a successful completion or permit play',async()=>{
  for(const mode of ['shader','prior-gl','after-gl']) {
    const f=titleFixture();
    if(mode==='shader')f.ctx.failShader=true;
    if(mode==='prior-gl')f.glErrors.push(['0x0502']);
    if(mode==='after-gl')f.glErrors.push([],['0x0502']);
    const pending=f.run();
    if(mode==='after-gl')f.fences[0].resolve({waitMs:1});
    await assert.rejects(pending,mode==='shader'?/Title shader could not link/:/GL errors/);
    assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
    assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);
    assert.match(f.ctx.GRAPHICS_STARTUP.titleError,mode==='shader'?/controlled link failure/:/0x0502/);
    assert.equal(f.ctx.renderer.debug.onShaderError,f.originalShaderError);
    assert.equal(f.ctx.renderer.debug.checkShaderErrors,false);
    assert.equal(f.ctx.U.uTrail.value,f.originalTrail);
    assert.equal(await f.run(),false);
    vm.runInContext('startGame({}); tick(0.1); frame(1000); resize();',f.ctx);
    assert.equal(f.ctx.GAME.started,false);
  }
});

test('hidden first title waits for visibility and a completed GPU fence without polling',async()=>{
  const f=titleFixture(); f.ctx.document.hidden=true; f.ctx.GAME.ready=false; f.ctx.window.__hm.ready=false;
  const pending=vm.runInContext('renderFirstTitleFrame()',f.ctx);
  assert.equal(f.events.length,0); assert.equal(f.fences.length,0);
  assert.equal(f.documentListeners.get('visibilitychange').size,1);
  for(const fn of f.documentListeners.get('visibilitychange'))fn();
  await Promise.resolve(); assert.equal(f.fences.length,0,'hidden events cannot submit a frame');
  f.ctx.document.hidden=false;
  for(const fn of [...f.documentListeners.get('visibilitychange')])fn();
  for(let n=0;n<5&&f.fences.length===0;n++)await Promise.resolve();
  assert.equal(f.fences.length,1);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
  assert.equal(f.ctx.GAME.ready,false);
  assert.equal(f.documentListeners.get('visibilitychange').size,0);
  assert.equal(f.canvasListeners.get('webglcontextlost').size,0);
  f.fences[0].resolve({waitMs:5}); await pending;
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  assert.equal(f.ctx.GAME.t,27); assert.equal(f.ctx.GAME.started,false);
});
test('context loss while a hidden first title waits removes listeners and refuses readiness',async()=>{
  const f=titleFixture(); f.ctx.document.hidden=true; f.ctx.GAME.ready=false;
  const pending=vm.runInContext('renderFirstTitleFrame()',f.ctx);
  f.ctx.GRAPHICS_CONTEXT_LOST=true;
  for(const fn of [...f.canvasListeners.get('webglcontextlost')])fn();
  await assert.rejects(pending,/Graphics stopped before the title became visible/);
  assert.equal(f.events.length,0); assert.equal(f.fences.length,0);
  assert.equal(f.documentListeners.get('visibilitychange').size,0);
  assert.equal(f.canvasListeners.get('webglcontextlost').size,0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0); assert.equal(f.ctx.GAME.ready,false);
});

test('a real title resize requests one frozen redraw while play and stopped states do not',()=>{
  const f=titleFixture(), ctx=f.ctx;
  let redraws=0, allocations=0;
  const focalMaterial=()=>({uniforms:{uFocal:{value:0}}});
  Object.assign(ctx,{
    view:{w:0,h:0},quality:{dpr:1,scale:1,msaa:0,level:'low'},BOOT_SAFE:true,DEG:Math.PI/180,
    makeTargets(){allocations++;},setupShadows(){},
    flowerMat:{uniforms:{uAlphaCut:{value:0}}},fxAdd:{mesh:{material:focalMaterial()}},
    fxAlpha:{mesh:{material:focalMaterial()}},glowMesh:{material:focalMaterial()},fireflyMat:focalMaterial(),
  });
  ctx.window.innerWidth=1920;ctx.window.innerHeight=1080;ctx.window.devicePixelRatio=1;
  ctx.camera.updateProjectionMatrix=()=>{};
  ctx.renderer.setPixelRatio=()=>{};ctx.renderer.setSize=()=>{};
  ctx.U.uFoliageCut={value:0};
  ctx.redraw=()=>{redraws++;return Promise.resolve(true);};
  vm.runInContext('renderTitleFrame = redraw; resize();',ctx);
  assert.equal(redraws,1); assert.equal(allocations,1);
  ctx.GAME.started=true;vm.runInContext('resize()',ctx);assert.equal(redraws,1);
  ctx.GRAPHICS_STARTUP.stopped=true;vm.runInContext('resize()',ctx);
  assert.equal(redraws,1); assert.equal(allocations,2);
});

function wrappedTitleStepFixture() {
  const f=titleFixture(), main=read('13_main.js'), perf=read('13p_perf.js');
  const start=perf.indexOf('{\n  const ls0 = loadStep;'), end=perf.indexOf('\n}',start);
  assert.ok(start>=0 && end>start,'test installs the actual profiling wrapper used by the combined page');
  f.ctx.BOOT_STEPS=[]; f.ctx.PERFX={boot:[]};
  f.ctx.performance={now:()=>100};
  f.ctx.nextPaint=async()=>{};
  f.ctx.$=()=>({style:{}});
  vm.runInContext(extract(main,'loadStep')+'\n'+perf.slice(start,end+2),f.ctx);
  f.step=()=>vm.runInContext("loadStep(0.97,'Drawing the first view',renderFirstTitleFrame)",f.ctx);
  return f;
}
test('the actual profiling wrapper preserves asynchronous title GPU completion before boot finishes',async()=>{
  const f=wrappedTitleStepFixture(), pending=f.step();
  for(let n=0;n<8&&f.fences.length===0;n++)await Promise.resolve();
  assert.equal(f.fences.length,1);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
  assert.equal(f.ctx.BOOT_STEPS.length,0,'base step cannot finish before the GPU fence');
  assert.equal(f.ctx.PERFX.boot.length,0,'profiling wrapper cannot mark pending async work complete');
  f.fences[0].resolve({waitMs:8}); await pending;
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  assert.equal(f.ctx.BOOT_STEPS.length,1);
  assert.equal(f.ctx.PERFX.boot.length,1);
});
test('the actual profiling wrapper propagates an asynchronous title failure instead of finishing boot',async()=>{
  const f=wrappedTitleStepFixture(), pending=f.step();
  const rejected=assert.rejects(pending,/controlled profiled title timeout/);
  for(let n=0;n<8&&f.fences.length===0;n++)await Promise.resolve();
  f.fences[0].reject(Error('controlled profiled title timeout'));
  await rejected;
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);
  assert.equal(f.ctx.BOOT_STEPS.length,0);
  assert.equal(f.ctx.PERFX.boot.length,0);
});

function selectedSky(safe) {
  const source=read('02_render.js');
  const start=source.indexOf('const RECOVERY_SKY_FRAGMENT');
  const end=source.indexOf('scene.add(skyMesh);',start);
  assert.ok(start>=0&&end>start);
  const ctx={
    BOOT_SAFE:safe,skyU:{},fsTriGeo:{},
    GLSL_COMMON:'COMMON_SENTINEL',GLSL_ATMOS:'ATMOS_SENTINEL',GLSL_CLOUDS:'CLOUDS_SENTINEL',
    scene:{add(){}},mat:options=>({...options}),
    THREE:{Mesh:class{constructor(geometry,material){this.geometry=geometry;this.material=material;}}},
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(start,end+'scene.add(skyMesh);'.length)+'\nglobalThis.material=skyMesh.material;',ctx);
  return ctx.material;
}

test('recovery actually selects a small sky fragment without procedural compiler input',()=>{
  const material=selectedSky(true);
  assert.equal(material.name,'Recovery sky');
  assert.ok(material.fragmentShader.length<1600,'selected input is the short recovery fragment');
  assert.match(material.fragmentShader,/uniform vec3 uSunDir, uMoonDir/);
  assert.match(material.fragmentShader,/gl_FragColor/);
  assert.doesNotMatch(material.fragmentShader,/SENTINEL|sampler|texture|fbm|hash|cloud|fwidth|dFdx|dFdy|floatBitsToUint|\buint\b|\bfor\s*\(|\bwhile\s*\(/i);
});

test('normal sky fragment and both sky vertices preserve their earlier compiler input',()=>{
  const normal=selectedSky(false),recovery=selectedSky(true);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  // Verified against the earlier startup-fix source. Sentinels replace only
  // unchanged shared chunks so the digest pins the actual normal template.
  assert.equal(hash(normal.fragmentShader),'7a3db51d7dbd1db5d8f9c6d183f1f87807835d627be99fcef637012c8ad84a60');
  assert.equal(hash(normal.vertexShader),'c0f96cb3c6162ed6cfe1884f11c35fb8f31d3663268dfbcebf98f34cd178619b');
  assert.equal(recovery.vertexShader,normal.vertexShader);
  assert.notEqual(recovery.fragmentShader,normal.fragmentShader);
});
