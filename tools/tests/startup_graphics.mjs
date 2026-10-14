import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL('src/' + name, root), 'utf8');
const render = read('02_render.js').split('const camera =')[0];
function extract(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0);
  const end = source.indexOf('\n}', start);
  assert.ok(end > start);
  return source.slice(start, end + 2);
}
const apply = extract(read('12_save.js'), 'applySettings');
const saveGraphics = extract(read('12_save.js'), 'graphicsSaveSettings');
const phone = extract(read('13q_lod.js'), 'phoneQualityPick');
const set = extract(read('13_main.js'), 'setQuality');
const automatic = read('13_main.js').split('\n').find(line => line.startsWith('quality.auto ='));

function boot({url='https://march.example/?tag=a&tag=b', touch=false, failure='', webgl2=true}={}) {
  const callbacks={}, options=[], state={disposed:false, reloads:0};
  function element(tag) {
    return {tag,hidden:true,style:{},attributes:{},children:[],
      setAttribute(k,v) { this.attributes[k]=v; },
      replaceChildren(...children) { this.children=children; },
      addEventListener(k,f) { callbacks[k]=f; }};
  }
  const elements={scene:element('canvas'),loading:element('div'),nogl:element('p')};
  elements.loading.hidden=false;
  const ctx={URL,URLSearchParams,
    location:{href:url,search:new URL(url).search,reload(){state.reloads++;}},
    document:{getElementById:k=>elements[k],createElement:element},
    matchMedia:q=>({matches:q==='(pointer: coarse)'&&touch}),
    window:{},navigator:{maxTouchPoints:touch?5:0,deviceMemory:8,hardwareConcurrency:8},
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
        getContext() {return {ALIASED_POINT_SIZE_RANGE:1,getParameter:()=>[1,64]};}
        dispose(){state.disposed=true;}
      }}
  };
  vm.createContext(ctx);
  let error;
  try { vm.runInContext(render,ctx); } catch(e) {error=e;}
  if(!error) {
    vm.runInContext(automatic,ctx);
    vm.runInContext('globalThis.__startup={safe:BOOT_SAFE,quality};',ctx);
  }
  return {ctx,elements,options,state,error};
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
