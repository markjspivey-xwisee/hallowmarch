import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL('src/' + name, root), 'utf8');
const render = read('02_render.js').split('const camera =')[0];
const titleCompile = read('13o_title_compile.js');
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
const renderRatio = extract(read('13_main.js'), 'graphicsRenderRatio');
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
    document:{getElementById:k=>elements[k],createElement:element,querySelectorAll:()=>[],body:{children:[]}},
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
test('an unknown desktop starts at Medium before adaptive detail has timings',()=>{
  const b=boot(); assert.equal(b.error,undefined);
  assert.equal(b.ctx.__startup.quality.level,'medium');
  assert.equal(b.ctx.__startup.quality.msaa,2);
  assert.equal(b.ctx.__startup.quality.auto,true);
  assert.equal(b.options[0].powerPreference,'high-performance');
  assert.equal(boot({url:'https://march.example/?safe=0'}).ctx.__startup.quality.level,'medium');
});

function pixelRatio(b, {width=3840,height=2160,dpr=2,stored=null}={}) {
  b.ctx.view={w:width,h:height}; b.ctx.window.devicePixelRatio=dpr;
  b.ctx.SAVE={loaded:stored && {settings:stored}};
  vm.runInContext(renderRatio,b.ctx);
  return vm.runInContext('graphicsRenderRatio()',b.ctx);
}

test('automatic desktop targets stay bounded at high DPI and large sizes',()=>{
  for(const [width,height,dpr] of [[1270,1315,1.6],[3840,2160,2],[2160,3840,3],[6000,4000,2],[10000,400,2]]) {
    const b=boot(), ratio=pixelRatio(b,{width,height,dpr});
    const w=Math.floor(width*ratio),h=Math.floor(height*ratio);
    assert.ok(w*h<=1440000,`${width}x${height}: ${w*h} pixels`);
    assert.ok(Math.max(w,h)<=1920,`${width}x${height}: longest edge ${Math.max(w,h)}`);
    assert.equal(b.ctx.__startup.quality.auto,true,'the budget does not turn automatic detail into a manual choice');
    b.ctx.GAME={started:true};
    assert.equal(vm.runInContext('graphicsRenderRatio()',b.ctx),ratio,'entering Play cannot remove the initial protection');
  }
  assert.equal(pixelRatio(boot(),{width:800,height:600,dpr:1}),1,'a small ordinary viewport is not reduced');
});

test('saved automatic quality retains its level within the budget, manual choices retain their render ratio',()=>{
  for(const level of ['low','medium','high']) for(const auto of [false,true]) {
    const b=boot(); settings(b);
    b.ctx.SAVE={loaded:{settings:{quality:level,auto}}};
    vm.runInContext('applySettings(SAVE.loaded.settings)',b.ctx);
    const before={...b.ctx.__startup.quality};
    const ratio=pixelRatio(b,{stored:{quality:level,auto}});
    assert.equal(b.ctx.__startup.quality.level,level);
    assert.equal(b.ctx.__startup.quality.auto,auto);
    if(auto) {
      assert.ok(Math.floor(3840*ratio)*Math.floor(2160*ratio)<=1440000,'saved automatic choices retain the pixel budget');
    } else assert.equal(ratio,before.dpr,'a saved manual choice keeps its full render ratio');
  }
  const manual=boot();settings(manual);
  vm.runInContext("setQuality('high')",manual.ctx);
  assert.equal(pixelRatio(manual),1.6);
  assert.equal(manual.ctx.__startup.quality.auto,false);
});

test('an automatic preference remains bounded after autosave and reload until a manual selection',()=>{
  const first=boot();first.ctx.SAVE={loaded:null};
  vm.runInContext(phone+'\n'+saveGraphics,first.ctx);
  const saved=JSON.parse(vm.runInContext('JSON.stringify(graphicsSaveSettings())',first.ctx));
  assert.deepEqual(saved,{quality:'medium',auto:true});
  const returning=boot();settings(returning);
  returning.ctx.SAVE={loaded:{settings:saved}};
  vm.runInContext('applySettings(SAVE.loaded.settings)',returning.ctx);
  const ratio=pixelRatio(returning,{stored:saved});
  assert.ok(Math.floor(3840*ratio)*Math.floor(2160*ratio)<=1440000);
  assert.equal(returning.ctx.__startup.quality.level,'medium');
  vm.runInContext("setQuality('high')",returning.ctx);
  assert.equal(pixelRatio(returning,{stored:saved}),1.6,'a later manual selection removes the automatic cap');
  assert.equal(returning.ctx.__startup.quality.auto,false);
});

test('automatic desktop budget leaves touch and recovery sizing intact',()=>{
  assert.equal(pixelRatio(boot({touch:true})),1.25,'touch sizing continues to use its existing device selection');
  for(const touch of [false,true]) {
    const b=boot({url:'https://march.example/?safe=1',touch});
    const ratio=pixelRatio(b,{width:6000,height:4000,stored:{quality:'high',auto:false}});
    assert.ok(Math.floor(6000*ratio)*Math.floor(4000*ratio)<=921600);
    assert.ok(Math.max(Math.floor(6000*ratio),Math.floor(4000*ratio))<=1280);
    assert.equal(b.ctx.__startup.quality.level,'low');
  }
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
  assert.equal(children[1].textContent,'The game could not start graphics in this browser.');
  const technical=children.find(x=>x.tag==='details');
  assert.equal(technical.children.find(x=>x.tag==='pre').textContent,reason);
  assert.equal(technical.attributes.open,undefined,'diagnostics stay optional by default');
  const expected=new URL(original);expected.searchParams.set('safe','1');
  assert.equal(children.find(x=>x.tag==='a').href,expected.href);
  assert.equal(b.state.reloads,0);
  assert.ok(b.ctx.window.__hmStartup,'failure retains the early startup trace');
});
test('unsupported WebGL 2 is distinguished and the failed renderer is disposed',()=>{
  const b=boot({webgl2:false});
  assert.match(b.error.message,/WebGL 2 is not available/);
  assert.match(b.elements.nogl.children[1].textContent,/does not provide the graphics features/);
  assert.match(b.elements.nogl.children.find(x=>x.tag==='details').children.find(x=>x.tag==='pre').textContent,/WebGL 2 is not available/);
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
  assert.equal(vm.runInContext('graphicsSaveSettings().quality',desk.ctx),'medium');
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
  const b=boot({url}),footer={children:[],appendChild(child){this.children.push(child);if(child.id)b.elements[child.id]=child;}};
  b.elements.title={querySelector:selector=>selector==='.card-foot'?footer:null};
  const expected=new URL(url); expected.searchParams.set('safe','0'); expected.searchParams.delete('gpuDiag');
  assert.equal(vm.runInContext('graphicsRecoveryURL(false)',b.ctx),expected.href);
  vm.runInContext('graphicsRecoveryNotice(); graphicsRecoveryNotice();',b.ctx);
  assert.equal(footer.children.length,1);
  const notice=footer.children[0];
  assert.equal(notice.attributes.role,'status');
  assert.equal(notice.children.find(child=>child.tag==='a').href,expected.href);
  assert.match(notice.children[0].textContent,/saved graphics preferences are unchanged/);
});

function titleFixture({autoPaint=false}={}) {
  const main=read('13_main.js'), declarations=main.split('\n').filter(line=>line.startsWith('let TITLE_')).join('\n');
  assert.ok(declarations,'test executes the actual staged title state');
  const events=[],staticCalls=[],fences=[],paints=[],glErrors=[],sizeCalls=[],originalTrail={name:'live-trail'},originalShaderError=()=>{};
  const documentListeners=new Map(),canvasListeners=new Map(),windowListeners=new Map(),resizeTimers=new Map();
  let nextResizeTimer=1;
  const listeners=map=>({
    addEventListener(name,fn){if(!map.has(name))map.set(name,new Set());map.get(name).add(fn);},
    removeEventListener(name,fn){map.get(name)?.delete(fn);},
  });
  const titleMath=Object.create(Math); titleMath.random=()=>{throw Error('title must not consume gameplay randomness');};
  const point=()=>({x:0,y:0,set(x,y){this.x=x;this.y=y;}});
  const grassCenter=point(),grassCamera=point(),flowerCenter=point(),flowerCamera=point();
  const familyNames=['sky','terrain','grass','flowers','trees','water','structures','crowds','other'];
  const objects=familyNames.map((name,index)=>({name,type:'Mesh',id:index+1,visible:true,
    geometry:{id:index+101},material:{name:name+' material',type:'ShaderMaterial',id:index+201}}));
  const hidden={name:'hidden',type:'Mesh',id:50,visible:false,geometry:{id:150},material:{name:'hidden material',type:'ShaderMaterial',id:250}};
  const inventory={renderables:[...objects,hidden],sets:Object.fromEntries(familyNames.map((name,index)=>[name,new Set([objects[index]])]))};
  inventory.sets.other.add(hidden);
  const postObject={name:'composite',type:'Mesh',id:99,geometry:{id:199},material:{name:'composite material',type:'ShaderMaterial',id:299}};
  const postState={material:'original-post',uniform:'original-texture'};
  const nodes={};
  const element=id=>({id,attributes:{},hidden:false,textContent:'',style:{},
    setAttribute(key,value){this.attributes[key]=value;},
    appendChild(child){nodes[child.id]=child;},
    remove(){delete nodes[this.id];}});
  nodes.title=element('title');nodes.loadmsg=element('loadmsg');
  let ctx;
  const direct=function(cam,scn,geo,material,object){
    events.push('direct:'+ctx.GRAPHICS_STARTUP.titleStage+':'+object.name);
    if(ctx.failShaderStage===ctx.GRAPHICS_STARTUP.titleStage) this.debug.onShaderError(ctx.gl,{},'vertex','fragment');
    if(!this.info.programs.some(x=>x.id===material.id))this.info.programs.push({id:material.id});
    this.info.render.calls++;this.info.render.triangles+=12;
  };
  const focalMaterial=()=>({uniforms:{uFocal:{value:0}}});
  ctx={
    Promise,Uint8Array,Math:titleMath,performance:{now:()=>100},
    GAME:{built:true,started:false,ready:false,t:27,player:null},
    GRAPHICS_CONTEXT_LOST:false,GRAPHICS_STARTUP:{stopped:false,titleSubmitted:0,titleCompleted:0},
    document:{hidden:false,...listeners(documentListeners),getElementById:id=>nodes[id],createElement:()=>element('')},
    canvas:listeners(canvasListeners),window:{__hm:{ready:false},innerWidth:1024,innerHeight:768,devicePixelRatio:1,...listeners(windowListeners)},
    diagnostic:false,graphicsDiagnosticActive(){return ctx.diagnostic;},
    graphicsAssertActive(){if(ctx.GRAPHICS_CONTEXT_LOST)throw Error('Graphics context was lost');},
    THREE:{DataTexture:class {constructor(){throw Error('title must not allocate a texture');}}},
    U:{uTrail:{value:originalTrail},uCloudDomeOn:{value:{x:1}},uCloudSh:{value:{w:1}},uCloudScrP:{value:{z:1}},uFoliageCut:{value:0}},
    trailA:{texture:{name:'already-cleared-neutral-trail'}},sceneRT:{name:'scene-target'},scene:{name:'world-scene'},
    view:{w:1024,h:768},quality:{dpr:1,scale:1,msaa:0,level:'low'},BOOT_SAFE:true,DEG:Math.PI/180,
    makeTargets(){events.push('targets');sizeCalls.push([ctx.view.w,ctx.view.h]);},setupShadows(){},
    flowerMat:{uniforms:{uAlphaCut:{value:0}}},fxAdd:{mesh:{material:focalMaterial()}},fxAlpha:{mesh:{material:focalMaterial()}},
    glowMesh:{material:focalMaterial()},fireflyMat:focalMaterial(),
    tod:{p:0.3},_fwd:{x:0,z:0},direction:{x:3,z:4},
    camera:{name:'title-camera',position:{x:10,z:20},projectionMatrix:{},matrixWorldInverse:{},updateProjectionMatrix(){},
      updateMatrixWorld(){staticCalls.push('camera');},
      getWorldDirection(out){Object.assign(out,ctx.direction);staticCalls.push('direction');}},
    projView:{multiplyMatrices(a,b){assert.equal(a,ctx.camera.projectionMatrix);assert.equal(b,ctx.camera.matrixWorldInverse);staticCalls.push('projection');}},
    frustum:{setFromProjectionMatrix(value){assert.equal(value,ctx.projView);staticCalls.push('frustum');}},
    skyU:{uInvVP:{value:{copy(value){assert.equal(value,ctx.projView);return this;},invert(){staticCalls.push('inverse');return this;}}}},
    grassMeshes:[{userData:{layer:{ahead:10}},material:{uniforms:{uCenter:{value:grassCenter},uCam2:{value:grassCamera}}}}],
    flowerMeshes:[{material:{uniforms:{uCenter:{value:flowerCenter},uCam2:{value:flowerCamera}}}}],
    applyTimeOfDay(value){assert.equal(value,0.3);events.push('prepare');staticCalls.push('time');},
    applyWeather(){staticCalls.push('weather');},applyIndoor(){staticCalls.push('indoor');},
    updateTreeVisibility(x,z){assert.equal(x,10);assert.equal(z,20);staticCalls.push('trees');},updateMountains(){staticCalls.push('mountains');},
    gl:{LINK_STATUS:1,COMPILE_STATUS:2,isContextLost:()=>ctx.GRAPHICS_CONTEXT_LOST || !!ctx.directLost,
      getProgramParameter:()=>false,getShaderParameter:()=>false,
      getProgramInfoLog:()=>ctx.shaderLog ?? 'program detail',getShaderInfoLog:shader=>shader+' detail'},
    renderer:{
      debug:{onShaderError:originalShaderError,checkShaderErrors:false},
      info:{programs:[],render:{calls:0,triangles:0},reset(){this.render.calls=0;this.render.triangles=0;}},
      setRenderTarget(target){assert.equal(target,ctx.sceneRT);events.push('target:'+ctx.GRAPHICS_STARTUP.titleStage);},
      setClearColor(){},clear(){},setPixelRatio(){},setSize(){},
      renderBufferDirect:direct,
      render(scene,camera){
        assert.equal(scene,ctx.scene);assert.equal(camera,ctx.camera);
        assert.equal(ctx.U.uTrail.value,ctx.trailA.texture);
        events.push('scene:'+ctx.GRAPHICS_STARTUP.titleStage);
        for(const object of inventory.renderables)if(object.visible)this.renderBufferDirect(camera,scene,object.geometry,object.material,object,null);
      },
    },
    gpuDiagFamilies(){events.push('inventory');return inventory;},
    wxPrepareCloudResources(){events.push('entry-resources');return [];},
    gpuDiagCaptureRenderer(){return {...postState};},
    gpuDiagRestoreRenderer(saved,restoreGl){assert.equal(restoreGl,false);Object.assign(postState,saved);events.push('restore:'+ctx.GRAPHICS_STARTUP.titleStage);},
    gpuDiagGlErrors(){return glErrors.shift() || [];},
    gpuDiagPrepareView(){throw Error('title must not prepare the dynamic diagnostic scene');},
    renderPost(){
      postState.material='temporary-post';postState.uniform='temporary-texture';
      events.push('post:'+ctx.GRAPHICS_STARTUP.titleStage);
      ctx.renderer.renderBufferDirect(ctx.camera,{},postObject.geometry,postObject.material,postObject,null);
    },
    gpuDiagWaitForFence(){
      const stage=ctx.GRAPHICS_STARTUP.titleStage;events.push('fence:'+stage);
      return new Promise((resolve,reject)=>fences.push({stage,resolve,reject,settled:false}));
    },
    nextPaint(){
      events.push('paint');
      return autoPaint?Promise.resolve():new Promise(resolve=>paints.push({resolve,settled:false}));
    },
    graphicsRememberRecovery(){events.push('remember');},graphicsCheckpoint(){events.push('checkpoint');},graphicsStartFailure(){events.push('failure');},
    netHumanSync(){throw Error('stopped title must not activate a human');},netHumanLive(){return false;},
    createPlayer(){throw Error('stopped graphics must not create a character');},
    requestAnimationFrame(){throw Error('stopped graphics must not schedule a frame');},
    setTimeout(fn,delay){const id=nextResizeTimer++;resizeTimers.set(id,{fn,delay});return id;},
    clearTimeout(id){resizeTimers.delete(id);},
    reportError(error){throw error;},
  };
  for(const name of ['updateAmbientLife','drawTownLife','drawAnimals','drawActors','drawFires','drawNature','drawHouses','updateFireflies',
    'updateNearTrees','updateGrassCenters','gatherLights','stepTrail','renderDecals','updateWeather','simStep','netPump','saveNow','fetch'])
    ctx[name]=()=>{throw Error('title must not invoke dynamic helper '+name);};
  const resizeStart=main.indexOf('let resizeTimer = 0;'),resizeEnd=main.indexOf('\n\n',resizeStart);
  assert.ok(resizeStart>=0 && resizeEnd>resizeStart,'test installs the actual resize timer declaration and listener');
  vm.createContext(ctx);
  vm.runInContext(titleCompile+'\n'+main.slice(resizeStart,resizeEnd)+'\n'+declarations+'\n'+['prepareTitleView','graphicsRenderRatio','applyGraphicsSize','resize','captureTitleResizeRequest','titleAssertActive','titleGraphicsBusy','submitTitleStage','renderTitleFrame','waitForTitleVisibility',
    'renderFirstTitleFrame','tick','frame','startGame'].map(name=>extract(main,name)).join('\n'),ctx);
  const f={ctx,nodes,events,staticCalls,fences,paints,glErrors,sizeCalls,inventory,objects,hidden,postState,originalTrail,originalShaderError,direct,
    grassCenter,grassCamera,flowerCenter,flowerCamera,documentListeners,canvasListeners,windowListeners,resizeTimers,
    run:()=>vm.runInContext('renderTitleFrame()',ctx),resize:()=>vm.runInContext('resize()',ctx),
    dispatchResize(){for(const fn of [...(windowListeners.get('resize')||[])])fn();},
    async flush(){for(let n=0;n<20;n++)await Promise.resolve();},
    async fence(index=fences.findIndex(x=>!x.settled),error=null){
      const receipt=fences[index];assert.ok(receipt && !receipt.settled,'one pending real stage receipt');
      receipt.settled=true;if(error)receipt.reject(error);else receipt.resolve({waitMs:12});await this.flush();
    },
    async paint(){const receipt=paints.find(x=>!x.settled);assert.ok(receipt,'one pending paint opportunity');receipt.settled=true;receipt.resolve();await this.flush();},
    async finish(pending){
      let done=false,error;pending.then(()=>{done=true;},e=>{done=true;error=e;});
      for(let n=0;n<200&&!done;n++){
        await this.flush();
        if(fences.some(x=>!x.settled))await this.fence();
        else if(paints.some(x=>!x.settled))await this.paint();
      }
      assert.equal(done,true,'bounded staged title completion');if(error)throw error;return pending;
    },
    restored(){
      assert.equal(ctx.U.uTrail.value,originalTrail);assert.equal(ctx.renderer.renderBufferDirect,direct);
      assert.equal(ctx.renderer.debug.onShaderError,originalShaderError);assert.equal(ctx.renderer.debug.checkShaderErrors,false);
      assert.deepEqual(postState,{material:'original-post',uniform:'original-texture'});
      assert.deepEqual(inventory.renderables.map(o=>o.visible),[...objects.map(()=>true),false]);
    },
    visible(){ctx.document.hidden=false;for(const fn of [...(documentListeners.get('visibilitychange')||[])])fn();},
    lose(){ctx.GRAPHICS_CONTEXT_LOST=true;for(const fn of [...(canvasListeners.get('webglcontextlost')||[])])fn();},
  };
  return f;
}
const titleStages=['post','sky','terrain','grass','flowers','trees','water','structures','crowds','other'];

test('entry program completion precedes real title stages and cannot replace their fences',async()=>{
  const f=titleFixture();let finish;
  f.ctx.prepareTitleEntryPrograms=(inventory,generation,resources)=>{
    assert.equal(inventory,f.inventory);assert.equal(generation,1);assert.equal(resources.length,0);
    return new Promise(resolve=>{finish=resolve;});
  };
  const pending=f.run();await f.flush();
  assert.equal(f.fences.length,0);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
  finish({completed:true,stale:false});await f.flush();
  assert.deepEqual(f.fences.map(x=>x.stage),['post']);
  await f.finish(pending);assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages,'combined']);f.restored();
});

test('stale entry preparation replans before any title draw and does not claim readiness',async()=>{
  const f=titleFixture();let calls=0;
  f.ctx.prepareTitleEntryPrograms=async()=>({stale:++calls===1,completed:calls!==1});
  await f.finish(f.run());
  assert.equal(calls,2);assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages,'combined']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);f.restored();
});

test('entry preparation failure stops startup before any title draw',async()=>{
  const f=titleFixture();f.ctx.prepareTitleEntryPrograms=async()=>{throw Error('controlled entry preparation failure');};
  await assert.rejects(f.run(),/controlled entry preparation failure/);assert.equal(f.fences.length,0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);assert(f.events.includes('failure'));f.restored();
});

test('actual static title preparation changes only existing view uniforms without randomness or simulation',()=>{
  const f=titleFixture();vm.runInContext('prepareTitleView()',f.ctx);
  assert.deepEqual(f.staticCalls,['time','weather','indoor','camera','projection','frustum','inverse','direction','trees','mountains']);
  assert.deepEqual([f.grassCenter.x,f.grassCenter.y,f.grassCamera.x,f.grassCamera.y],[16,28,10,20]);
  assert.ok(Math.abs(f.flowerCenter.x-18.4)<1e-9);assert.ok(Math.abs(f.flowerCenter.y-31.2)<1e-9);
  assert.equal(f.ctx.GAME.t,27);assert.equal(f.ctx.GAME.player,null);
  assert.equal(f.ctx.U.uCloudDomeOn.value.x,0);assert.equal(f.ctx.U.uCloudSh.value.w,0);assert.equal(f.ctx.U.uCloudScrP.value.z,0);
});
test('actual title stages require a completed fence and paint before advancing to combined readiness',async()=>{
  const f=titleFixture(),pending=f.run();await f.flush();
  assert.deepEqual(f.fences.map(x=>x.stage),['post']);assert.equal(f.ctx.GRAPHICS_STARTUP.titleSubmitted,0);f.restored();
  await f.fence();assert.deepEqual(f.fences.map(x=>x.stage),['post']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleWarmup.length,1);assert.equal(f.paints.length,1);f.restored();
  await f.paint();assert.deepEqual(f.fences.map(x=>x.stage),['post','sky']);f.restored();
  await f.finish(pending);
  assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages,'combined']);
  assert.deepEqual(Array.from(f.ctx.GRAPHICS_STARTUP.titleWarmup,x=>x.id),titleStages);
  for(const row of f.ctx.GRAPHICS_STARTUP.titleWarmup){
    assert.equal(row.completed,true);assert.equal(row.fenceComplete,true);assert.equal(row.exercised,true);assert.ok(row.workCalls>0);assert.equal(row.fenceWaitMs,12);
  }
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleSubmitted,1);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleFenceWaitMs,12);assert.equal(f.ctx.GRAPHICS_STARTUP.titleFinal.newPrograms,0,'combined draw reuses warmed programs');assert.equal(f.ctx.GAME.t,27);assert.equal(f.ctx.GAME.started,false);f.restored();
  const calls=f.events.length;await f.flush();assert.equal(f.events.length,calls,'standby creates no automatic batch, frame or timer');
});
test('family warming preserves hidden objects and reports empty families without claiming exercised work',async()=>{
  const f=titleFixture();f.inventory.sets.flowers.clear();const pending=f.run();await f.finish(pending);
  assert.equal(f.hidden.visible,false);
  assert.equal(f.events.some(x=>x==='direct:other:hidden'),false);
  const flowers=f.ctx.GRAPHICS_STARTUP.titleWarmup.find(x=>x.id==='flowers');
  assert.equal(flowers.completed,true);assert.equal(flowers.fenceComplete,true);assert.equal(flowers.exercised,false);assert.equal(flowers.workCalls,0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleWarmup[0].exercised,true,'post batch counts its actual composite draw');
  f.restored();
});
test('cold crowd meshes each finish their fence and yield before the next shader is submitted',async()=>{
  const f=titleFixture(),beast={name:'beast',type:'Mesh',id:71,visible:true,
    geometry:{id:171},material:{name:'beast material',type:'ShaderMaterial',id:271}};
  f.inventory.renderables.push(beast);f.inventory.sets.crowds.add(beast);
  const pending=f.run();await f.flush();
  while(f.fences.at(-1).stage!=='crowds-1'){await f.fence();await f.paint();}
  assert.equal(f.events.some(x=>x==='direct:crowds-2:beast'),false);
  await f.fence();
  assert.equal(f.fences.at(-1).stage,'crowds-1','next crowd waits for a paint opportunity');
  await f.paint();assert.equal(f.fences.at(-1).stage,'crowds-2');
  assert.ok(f.events.includes('direct:crowds-2:beast'));
  assert.equal(f.events.some(x=>x==='direct:crowds-1:beast'),false);
  await f.finish(pending);
  assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages.slice(0,-2),'crowds-1','crowds-2','other','combined']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleFinal.newPrograms,0);
  assert.equal(beast.visible,true);assert.equal(f.ctx.GAME.t,27);assert.equal(f.ctx.GAME.player,null);
});
test('unchanged concurrent title redraw requests coalesce and reuse completed warming',async()=>{
  const f=titleFixture(),first=f.run();assert.equal(f.run(),first);assert.equal(f.run(),first);await f.finish(first);
  assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages,'combined','combined']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,2);
  const next=f.run();await f.finish(next);
  assert.deepEqual(f.fences.slice(-1).map(x=>x.stage),['combined']);assert.equal(f.fences.length,13);f.restored();
});
test('explicit resize waits for the pending fence and rewarms once at the latest projection',async()=>{
  const f=titleFixture(),pending=f.run();await f.flush();
  f.ctx.window.innerWidth=800;f.ctx.window.innerHeight=400;f.resize();
  f.ctx.window.innerWidth=900;f.ctx.window.innerHeight=500;f.resize();
  assert.equal(f.sizeCalls.length,0,'pending GPU targets cannot be disposed by resize');
  await f.fence();assert.equal(f.sizeCalls.length,0);await f.paint();
  assert.deepEqual(f.sizeCalls,[[900,500]]);assert.deepEqual(f.fences.map(x=>x.stage),['post','post']);
  await f.finish(pending);assert.deepEqual(f.fences.map(x=>x.stage),['post',...titleStages,'combined']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleWarmup.length,10);
  assert.ok(Array.from(f.ctx.GRAPHICS_STARTUP.titleWarmup).every(x=>x.generation===2));
  f.ctx.GAME.ready=true;f.ctx.window.__hm.ready=true;
  f.ctx.window.innerWidth=1200;f.resize();await f.flush();
  const current=vm.runInContext('TITLE_FRAME_PROMISE',f.ctx);await f.finish(current);
  assert.deepEqual(f.fences.slice(-11).map(x=>x.stage),[...titleStages,'combined'],'new targets/frustum must warm newly visible variants');
  assert.deepEqual(f.sizeCalls,[[900,500],[1200,500]]);
});
test('a real play start during a successful pending fence applies queued size without more title work',async()=>{
  const f=titleFixture(),pending=f.run();await f.flush();
  f.ctx.window.innerWidth=700;f.ctx.window.innerHeight=900;f.resize();f.ctx.GAME.started=true;
  await f.fence();if(f.paints.some(x=>!x.settled))await f.paint();await pending;
  assert.deepEqual(f.sizeCalls,[[700,900]]);assert.deepEqual(f.fences.map(x=>x.stage),['post']);f.restored();
});
test('hidden title pauses between completed stages until a visible event without polling',async()=>{
  const f=titleFixture(),pending=f.run();await f.flush();f.ctx.document.hidden=true;
  await f.fence();await f.paint();assert.equal(f.fences.length,1);
  assert.equal(f.documentListeners.get('visibilitychange').size,1);await f.flush();assert.equal(f.fences.length,1);
  f.visible();await f.finish(pending);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  assert.equal(f.documentListeners.get('visibilitychange').size,0);assert.equal(f.canvasListeners.get('webglcontextlost').size,0);
});
test('hiding during the final combined fence keeps the pipeline pending until a visible redraw is fenced',async()=>{
  const f=titleFixture(),pending=f.run();let done=false;pending.then(()=>{done=true;});
  for(let n=0;n<titleStages.length;n++){
    await f.flush();assert.equal(f.fences[n].stage,titleStages[n]);await f.fence(n);await f.paint();
  }
  assert.equal(f.fences[10].stage,'combined');f.ctx.document.hidden=true;await f.fence(10);
  assert.equal(done,false);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  assert.equal(f.documentListeners.get('visibilitychange').size,1);assert.equal(f.fences.length,11);
  f.visible();await f.flush();assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages,'combined','combined']);
  assert.equal(done,false);assert.equal(f.ctx.GRAPHICS_STARTUP.titleWarmup.length,10,'visibility redraw reuses completed warming');
  await f.fence(11);await pending;assert.equal(done,true);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,2);
  assert.equal(f.documentListeners.get('visibilitychange').size,0);assert.equal(f.nodes.title.attributes['aria-busy'],'false');f.restored();
});

test('an actual raw resize during the final fence keeps readiness pending for the latest generation',async()=>{
  const f=titleFixture(),pending=f.run();let done=false;pending.then(()=>{done=true;});
  for(let n=0;n<titleStages.length;n++){await f.flush();await f.fence(n);await f.paint();}
  assert.equal(f.fences[10].stage,'combined');
  f.ctx.window.innerWidth=850;f.ctx.window.innerHeight=500;f.dispatchResize();
  f.ctx.window.innerWidth=950;f.ctx.window.innerHeight=550;f.dispatchResize();
  assert.equal(f.resizeTimers.size,1);assert.equal(f.sizeCalls.length,0,'no debounced callback or target replacement has run');
  await f.fence(10);
  assert.equal(done,false,'a completed old-size fence cannot settle the requested latest view');
  assert.equal(f.resizeTimers.size,0);assert.equal(vm.runInContext('resizeTimer',f.ctx),0);
  assert.deepEqual(f.sizeCalls,[[950,550]]);assert.equal(f.fences[11].stage,'post');
  assert.equal(f.nodes.title.attributes['aria-busy'],'true');assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  await f.finish(pending);
  assert.equal(done,true);assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages,'combined',...titleStages,'combined']);
  assert.deepEqual(f.sizeCalls,[[950,550]]);assert.equal(f.resizeTimers.size,0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,2);assert.equal(f.ctx.GRAPHICS_STARTUP.titleSubmitted,2);
  assert.ok(Array.from(f.ctx.GRAPHICS_STARTUP.titleWarmup).every(row=>row.generation===2 && row.fenceComplete));
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleFinal.newPrograms,0);assert.equal(f.nodes.title.attributes['aria-busy'],'false');f.restored();
});

test('hidden first title waits event-driven and context loss removes listeners without readiness',async()=>{
  const f=titleFixture();f.ctx.document.hidden=true;
  const pending=vm.runInContext('renderFirstTitleFrame()',f.ctx);const rejected=assert.rejects(pending,/Graphics stopped before the title became visible/);
  assert.equal(f.fences.length,0);f.lose();await rejected;
  assert.equal(f.fences.length,0);assert.equal(f.documentListeners.get('visibilitychange').size,0);
  assert.equal(f.canvasListeners.get('webglcontextlost').size,0);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
});
test('hidden playing diagnostic unbuilt and lost title never submits work',async()=>{
  for(const mutate of [c=>{c.document.hidden=true;},c=>{c.GAME.started=true;},c=>{c.diagnostic=true;},c=>{c.GAME.built=false;},c=>{c.GRAPHICS_CONTEXT_LOST=true;}]) {
    const f=titleFixture();mutate(f.ctx);assert.equal(await f.run(),false);assert.equal(f.fences.length,0);assert.equal(f.events.length,0);
  }
});
test('title fence failure permanently stops stages play tick resizing and RAF with stage evidence',async()=>{
  const f=titleFixture(),pending=f.run(),rejected=assert.rejects(pending,/controlled title fence timeout/);await f.flush();
  f.ctx.window.innerWidth=900;f.resize();await f.fence(0,Error('controlled title fence timeout'));await rejected;
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleFailure.stage,'post');assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);assert.equal(f.ctx.GAME.ready,false);assert.equal(f.ctx.window.__hm.ready,false);
  const before=[...f.events];assert.equal(await f.run(),false);vm.runInContext('startGame({});tick(0.1);frame(1000);resize();',f.ctx);
  assert.deepEqual(f.events,before);assert.equal(f.sizeCalls.length,0);f.restored();
});
test('context loss during a stage fence issues no later stage or resize commands',async()=>{
  const f=titleFixture(),pending=f.run(),rejected=assert.rejects(pending,/context was lost/);await f.flush();f.lose();
  await f.fence(0,Error('Graphics context was lost'));await rejected;
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleFailure.contextLost,true);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
  assert.deepEqual(f.fences.map(x=>x.stage),['post']);assert.equal(f.sizeCalls.length,0);f.restored();
});
test('a lost GL context before its browser event cannot advance to another stage',async()=>{
  const f=titleFixture(),pending=f.run(),rejected=assert.rejects(pending,/context is unavailable/);await f.flush();
  f.ctx.directLost=true;await f.fence();await rejected;
  assert.equal(f.ctx.GRAPHICS_CONTEXT_LOST,false,'the global context-loss event has not arrived');
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleFailure.contextLost,true);
  assert.deepEqual(f.fences.map(x=>x.stage),['post']);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);f.restored();
});

test('shader failure retains bounded exact stage material geometry and compiler diagnostics',async()=>{
  const f=titleFixture();f.ctx.failShaderStage='sky';f.ctx.shaderLog='X'.repeat(1000);
  const pending=f.run(),rejected=assert.rejects(pending,/Title shader could not link/);await f.flush();await f.fence();await f.paint();await rejected;
  const failure=f.ctx.GRAPHICS_STARTUP.titleFailure;
  assert.equal(failure.stage,'sky');assert.equal(failure.material,'sky material');assert.equal(failure.materialId,201);
  assert.equal(failure.object,'sky');assert.equal(failure.objectId,1);assert.equal(failure.geometryId,101);
  assert.equal(failure.contextLost,false);assert.equal(failure.linked,'false');assert.equal(failure.vertexCompiled,'false');assert.equal(failure.fragmentCompiled,'false');
  assert.equal(failure.programLog.length,600);assert.equal(failure.vertexLog,'vertex detail');assert.equal(failure.fragmentLog,'fragment detail');
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleWarmup.length,1);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
  assert.equal(await f.run(),false);f.restored();
});
test('pre-draw and post-fence GL errors never become successful warmup or combined receipts',async()=>{
  for(const mode of ['prior','after']) {
    const f=titleFixture();f.glErrors.push(...(mode==='prior'?[['0x0502']]:[[],['0x0502']]));
    const pending=f.run(),rejected=assert.rejects(pending,/GL errors/);await f.flush();
    if(mode==='after')await f.fence();await rejected;
    assert.equal(f.ctx.GRAPHICS_STARTUP.titleWarmup.length,0);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);
    assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);assert.equal(f.ctx.GRAPHICS_STARTUP.titleFailure.stage,'post');f.restored();
  }
});
test('early dependencies precede their real draws while all original stage fences remain',async()=>{
  const f=titleFixture(), original=f.ctx.prepareTitleDependencies, dependencies=[];
  f.ctx.prepareTitleDependencies=async(id,inventory,generation)=>{
    dependencies.push([id,generation]);f.events.push('dependency:'+id);
    return original(id,inventory,generation);
  };
  await f.finish(f.run());
  assert.deepEqual(dependencies,[['post',1],['sky',1]]);
  for(const id of ['post','sky'])assert(f.events.indexOf('dependency:'+id)<f.events.indexOf('target:'+id));
  assert.deepEqual(f.fences.map(x=>x.stage),[...titleStages,'combined']);f.restored();
});
for(const id of ['post','sky'])test(`a failed ${id} dependency cannot submit that draw or release readiness`,async()=>{
  const f=titleFixture(),original=f.ctx.prepareTitleDependencies;
  f.ctx.prepareTitleDependencies=async(stage,inventory,generation)=>{
    if(stage===id)throw Error('controlled dependency rejection');
    return original(stage,inventory,generation);
  };
  await assert.rejects(f.finish(f.run()),/controlled dependency rejection/);
  assert.deepEqual(f.fences.map(x=>x.stage),id==='post'?[]:['post']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);
  assert.equal(f.ctx.GAME.ready,false);assert.equal(f.ctx.GAME.started,false);f.restored();
});
test('a stale early dependency replans before drawing and preserves the original real stages',async()=>{
  const f=titleFixture(),original=f.ctx.prepareTitleDependencies,dependencies=[];let stale=true;
  f.ctx.prepareTitleDependencies=async(id,inventory,generation)=>{
    dependencies.push([id,generation]);
    if(id==='sky'&&stale){stale=false;return {stale:true};}
    return original(id,inventory,generation);
  };
  await f.finish(f.run());
  assert.deepEqual(dependencies,[['post',1],['sky',1],['post',2],['sky',2]]);
  assert.deepEqual(f.fences.map(x=>x.stage),['post',...titleStages,'combined']);f.restored();
});
test('a rejected final program-queue GL check stops the actual staged title before terrain or readiness',async()=>{
  const f=titleFixture();
  f.ctx.prepareTitlePrograms=async()=>{throw Error('GL errors while preparing title programs: final queue error');};
  await assert.rejects(f.finish(f.run()),/final queue error/);
  assert.deepEqual(f.fences.map(receipt=>receipt.stage),['post','sky']);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);
  assert.equal(f.ctx.GAME.ready,false);assert.equal(f.ctx.GAME.started,false);assert.equal(f.ctx.window.__hm.ready,false);
  const before=[...f.events];assert.equal(await f.run(),false);
  vm.runInContext('startGame({});tick(0.1);frame(1000);resize();',f.ctx);
  assert.deepEqual(f.events,before);f.restored();
});
function allowPlayerCreation(f) {
  const created=[];f.ctx.GAME.prog={level:1,rp:0};f.ctx.INPUT={keys:new Set()};
  f.ctx.$=id=>f.nodes[id];f.ctx.CLASSES={warrior:{name:'Warrior'}};
  f.ctx.zoneAt=()=>({name:'Fresh Season'});f.ctx.realmRank=()=>1;
  f.ctx.createPlayer=save=>{
    created.push(save);const player={id:'player-'+created.length,x:0,z:0,name:save.name,cls:'warrior',faction:0};
    f.ctx.GAME.player=player;return player;
  };
  for(const name of ['savePartsLoad','rescaleWar','buildHUD','uiLog','sfx','loreOnStart','giftsOnStart','buildOnStart','survivalOnStart','depthOnStart'])
    f.ctx[name]=()=>{};
  f.ctx.intent={name:'Owner',realm:0,cls:'warrior',level:1,gold:0};
  f.ctx.INV={potions:0,gold:0,eq:{}};f.ctx.SAVE={chain:Promise.resolve()};f.ctx.saveNow=()=>{};
  const main=read('13_main.js'),start=main.indexOf('  start(o = {}) {'),end=main.indexOf('\n  simulate(',start);
  assert.ok(start>=0 && end>start,'test executes the actual debug start facade');
  vm.runInContext('globalThis.debug={'+main.slice(start,end)+'};',f.ctx);
  return created;
}
test('actual debug start returns a deferred ID through all title fences and coalesces one player',async()=>{
  const f=titleFixture(),created=allowPlayerCreation(f);
  assert.equal(f.ctx.debug.start({name:'Owner'}),null);assert.equal(created.length,0,'pre-Ready calls cannot create a player');
  await f.finish(f.run());f.ctx.GAME.ready=true;f.ctx.window.__hm.ready=true;
  f.ctx.window.innerWidth=1200;f.resize();await f.flush();
  const pending=vm.runInContext('TITLE_FRAME_PROMISE',f.ctx);
  assert.equal(f.nodes.title.attributes['aria-busy'],'true');assert.equal(f.nodes['title-graphics-status'].attributes.role,'status');
  const first=f.ctx.debug.start({name:'Owner'}),second=f.ctx.debug.start({name:'Owner'});
  assert.equal(typeof first.then,'function');assert.equal(typeof second.then,'function');
  const coalesced=vm.runInContext('TITLE_START_PROMISE',f.ctx);
  assert.equal(vm.runInContext('startGame(intent)',f.ctx),coalesced,'underlying pending Play intent shares one promise');
  assert.equal(created.length,0);assert.equal(f.ctx.GAME.started,false);
  await f.finish(pending);assert.equal(await first,'player-1');assert.equal(await second,'player-1');await f.flush();
  assert.equal(created.length,1);assert.equal(f.ctx.GAME.started,true);
  assert.equal(f.nodes.title.attributes['aria-busy'],'false');assert.equal(f.nodes['title-graphics-status'],undefined);
  const immediate=f.ctx.debug.start({name:'Replacement'});
  assert.equal(immediate,'player-2','idle debug character replacement keeps its immediate ID result');assert.equal(typeof immediate.then,'undefined');
  assert.equal(created.length,2);
});
test('actual Play before the resize timer drains one latest-size request and awaits every fence',async()=>{
  const f=titleFixture(),created=allowPlayerCreation(f);
  await f.finish(f.run());f.ctx.GAME.ready=true;f.ctx.window.__hm.ready=true;
  f.ctx.window.innerWidth=800;f.ctx.window.innerHeight=400;f.dispatchResize();
  f.ctx.window.innerWidth=900;f.ctx.window.innerHeight=500;f.dispatchResize();
  assert.equal(f.resizeTimers.size,1);assert.equal([...f.resizeTimers.values()][0].delay,80);
  assert.equal(f.sizeCalls.length,0,'the actual debounced callback has not fired');
  const first=f.ctx.debug.start({name:'Owner'}),second=f.ctx.debug.start({name:'Owner'});
  assert.equal(typeof first.then,'function');assert.equal(typeof second.then,'function');
  assert.equal(f.resizeTimers.size,0);assert.equal(vm.runInContext('resizeTimer',f.ctx),0);
  assert.deepEqual(f.sizeCalls,[[900,500]],'Play drains only the latest queued layout');
  assert.equal(created.length,0);assert.equal(f.ctx.GAME.started,false);
  const pending=vm.runInContext('TITLE_FRAME_PROMISE',f.ctx);await f.flush();
  assert.equal(f.fences.at(-1).stage,'post');assert.equal(created.length,0);
  await f.finish(pending);assert.equal(await first,'player-1');assert.equal(await second,'player-1');
  assert.equal(created.length,1);assert.equal(f.resizeTimers.size,0);assert.deepEqual(f.sizeCalls,[[900,500]]);
  assert.deepEqual(f.fences.slice(-11).map(x=>x.stage),[...titleStages,'combined']);
});

test('actual deferred debug start rejects failed title graphics and never creates a player',async()=>{
  const f=titleFixture(),created=allowPlayerCreation(f),reported=[];f.ctx.reportError=error=>reported.push(error.message);
  await f.finish(f.run());f.ctx.GAME.ready=true;f.ctx.window.__hm.ready=true;
  f.ctx.window.innerWidth=1200;f.resize();await f.flush();
  const pending=vm.runInContext('TITLE_FRAME_PROMISE',f.ctx),rejected=assert.rejects(pending,/controlled deferred-play fence timeout/);
  const deferred=f.ctx.debug.start({name:'Owner'}),startRejected=assert.rejects(deferred,/controlled deferred-play fence timeout/);
  await f.fence(f.fences.length-1,Error('controlled deferred-play fence timeout'));await rejected;await startRejected;await f.flush();
  assert.equal(created.length,0);assert.equal(f.ctx.GAME.started,false);assert.equal(f.ctx.GAME.ready,false);
  assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);assert.ok(reported.some(x=>x.includes('controlled deferred-play fence timeout')));
  assert.equal(f.nodes.title.attributes['aria-busy'],'false');assert.equal(f.nodes['title-graphics-status'],undefined);
});

function wrappedTitleStepFixture() {
  const f=titleFixture({autoPaint:true}),main=read('13_main.js'),perf=read('13p_perf.js');
  const start=perf.indexOf('{\n  const ls0 = loadStep;'),end=perf.indexOf('\n}',start);
  assert.ok(start>=0 && end>start);f.ctx.BOOT_STEPS=[];f.ctx.PERFX={boot:[]};f.ctx.$=()=>({style:{}});
  const workStart=main.indexOf('const BOOT_WORK_BUDGET_MS'),workEnd=main.indexOf('async function loadStep(');
  assert.ok(workStart>=0&&workEnd>workStart);
  vm.runInContext(main.slice(workStart,workEnd)+'\n'+extract(main,'loadStep')+'\n'+perf.slice(start,end+2),f.ctx);
  f.step=()=>vm.runInContext("loadStep(0.97,'Drawing the first view',renderFirstTitleFrame)",f.ctx);
  return f;
}
test('actual profiled boot cannot finish until every warmup and the combined title fence completes',async()=>{
  const f=wrappedTitleStepFixture(),pending=f.step();await f.flush();
  assert.equal(f.fences.length,1);assert.equal(f.ctx.BOOT_STEPS.length,0);assert.equal(f.ctx.PERFX.boot.length,0);
  await f.finish(pending);assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,1);
  assert.equal(f.ctx.BOOT_STEPS.length,1);assert.equal(f.ctx.PERFX.boot.length,1);
});
test('actual profiling propagates a failed warmup instead of declaring boot complete',async()=>{
  const f=wrappedTitleStepFixture(),pending=f.step(),rejected=assert.rejects(pending,/controlled profiled title timeout/);await f.flush();
  await f.fence(0,Error('controlled profiled title timeout'));await rejected;
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted,0);assert.equal(f.ctx.GRAPHICS_STARTUP.stopped,true);
  assert.equal(f.ctx.BOOT_STEPS.length,0);assert.equal(f.ctx.PERFX.boot.length,0);
});

test('ordinary title setup never schedules an idle bulk shadow compilation',()=>{
  const source=read('13x_perf2.js'),start=source.indexOf('{\n  // the static meshes'),end=source.indexOf('// Static meshes may have released',start);
  assert.ok(start>=0&&end>start,'executes the actual profiling installation block');
  const calls=[],timers=[];
  const ctx={BOOT_SAFE:false,GRAPHICS_CONTEXT_LOST:false,
    groupOutdoors:()=>calls.push('group'),perf2ReleaseStatic:()=>calls.push('release'),
    setupTitle:()=>calls.push('title'),perf2Compile:()=>calls.push('bulk-shadow-compile'),
    setTimeout:(fn,delay)=>{timers.push({fn,delay});return timers.length;},reportError(error){throw error;}};
  vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
  vm.runInContext('groupOutdoors();setupTitle(null);setupTitle(null);',ctx);
  assert.deepEqual(calls,['group','release','title','title']);
  assert.equal(timers.length,0,'an unattended title must not queue shader work');
});

test('explicit profiling still has working world and shadow compile helpers',()=>{
  const calls=[],ctx={BOOT_SAFE:false,GRAPHICS_CONTEXT_LOST:false,performance:{now:()=>1},
    PERF2:{warmed:0,warmMs:0},scene:{id:'world'},camera:{id:'camera'},SHADOW:{rt:{},scene:{id:'shadow'},cam:{id:'light'}},
    renderer:{info:{programs:[]},compile(scene,camera){calls.push([scene.id,camera.id]);this.info.programs.push({});}},
    spellCompileVisible:value=>calls.push(['spells',value]),gl:{flush:()=>calls.push(['flush'])},reportError(error){throw error;}};
  const source=read('13x_perf2.js'),start=source.indexOf('window.__hm.perf2 = {'),end=source.indexOf('\n};',start);
  assert.ok(start>=0&&end>start,'executes the actual explicit profiling API installation');
  Object.assign(ctx,{window:{__hm:{}},BOOT_T0:0,BOOT_STEPS:[],perf2Release(){},perf2ReleaseStatic(){},perf2LazyMesh(){}});
  vm.createContext(ctx);vm.runInContext(extract(source,'perf2Compile')+'\n'+extract(source,'perf2Shaders')+'\n'+source.slice(start,end+3),ctx);
  assert.deepEqual(calls,[],'installing explicit helpers does not request any shader work');
  assert.equal(typeof ctx.window.__hm.perf2.shaders,'function');
  vm.runInContext('window.__hm.perf2.compile(false);window.__hm.perf2.compile(true);',ctx);
  assert.deepEqual(calls,[['spells',true],['world','camera'],['spells',false],['flush'],['shadow','light'],['flush']]);
  assert.equal(ctx.PERF2.warmed,2);
  ctx.GRAPHICS_CONTEXT_LOST=true;vm.runInContext('perf2Compile(false);perf2Compile(true);',ctx);
  assert.equal(ctx.PERF2.warmed,2,'stopped graphics cannot start an explicit benchmark either');
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

