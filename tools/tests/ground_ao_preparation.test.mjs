/** Actual-source byte equivalence and ownership: no renderer/browser/services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {parse,tokenizer} from 'acorn';
const read=file=>readFileSync(new URL('../../'+file,import.meta.url),'utf8');
const prior=JSON.parse(read('tools/tests/fixtures/ground_ao_7201708.json'));
assert.equal(prior.revision,'720170869cd8469f8841a6bbc714c5e9fcdd673d');
assert.equal(createHash('sha256').update(prior.buildGroundAO).digest('hex'),'eb980085051ee84cb728f482c32de84b79577497065c71a6c99cbdea6d5e9e60');
const terrain=read('src/03_terrain.js');
const names=new Set(['GROUND_AO_WORK','GROUND_AO_APPEND_PROPS','GROUND_AO_APPEND_WORK','GROUND_AO_BOX_FIELDS','GROUND_AO_CIRCLE_FIELDS','GROUND_AO_PATH_FIELDS',
  'groundAOPathFns','groundAOPrepared','groundAOPreparation','groundAONote','groundAOList','groundAOListCurrent','groundAOInputs',
  'groundAOInputsCurrent','groundAOBoxBytesChunks','groundAOAppendedProps','groundAOExtendPrepared','groundAOBytesChunks','prepareGroundAOChunks','buildGroundAO']);
const actual=parse(terrain,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>
  n.type==='FunctionDeclaration'&&names.has(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.some(d=>names.has(d.id.name)))
  .map(n=>terrain.slice(n.start,n.end)).join('\n');
function declarations(source,names){const wanted=new Set(names);return parse(source,{ecmaVersion:'latest',sourceType:'module'}).body
  .filter(n=>n.type==='FunctionDeclaration'&&wanted.has(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.some(d=>wanted.has(d.id.name)))
  .map(n=>source.slice(n.start,n.end)).join('\n');}
const tokens=source=>Array.from(tokenizer(source,{ecmaVersion:'latest'}),token=>[token.type.label,token.value]);
test('all pinned helper bodies still match the actual current source',()=>{
  const util=declarations(read('src/00_util.js'),['clamp','smooth','sstep','dist2','segDist2']);
  const town=declarations(read('src/13t_look.js'),['lookTownPlan','lookSegD']);
  const hall=declarations(read('src/13v_look3.js'),['look3HallPlan']);
  const paths=declarations(read('src/13u_look2.js'),['look2PathMap'])+'\n'+declarations(read('src/13v_look3.js'),['look3PathMap']);
  for(const [name,current]of Object.entries({util,town,hall,paths}))assert.deepEqual(tokens(current),tokens(prior[name]),name);
});
test('retained synchronous kernel is token-identical to the independent original',()=>{
  const fn=parse(terrain,{ecmaVersion:'latest',sourceType:'module'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='buildGroundAO');
  const start=fn.body.body.findIndex(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name==='R'));
  const original=parse(prior.buildGroundAO,{ecmaVersion:'latest'}).body[0];
  assert(start>=0);
  const fallback=fn.body.body.slice(start,-1).map(n=>terrain.slice(n.start,n.end)).join('\n');
  const body=original.body.body.map(n=>prior.buildGroundAO.slice(n.start,n.end)).join('\n');
  assert.deepEqual(tokens(fallback),tokens(body));
});
function fixture({oracle=false,countWrites=false,failAllocation=0,canopy=false}={}){
  const effects={allocations:0,textures:[],bindings:[],pathCalls:0,planCalls:0,writes:0,random:0};
  class Texture{constructor(data,w,h,format,type){Object.assign(this,{data,w,h,format,type});effects.textures.push(this);}}
  const array=new Proxy(Uint8Array,{construct(Target,args){effects.allocations++;if(effects.allocations===failAllocation)throw Error('optional bytes unavailable');
    const value=new Target(...args);return countWrites?new Proxy(value,{get:(t,k)=>Reflect.get(t,k,t),set(t,k,v){if(/^\d+$/.test(String(k))){effects.writes++;effects.onWrite?.(t,k,v);}return Reflect.set(t,k,v,t);}}):value;}});
  const u={};let bound={neutral:true};Object.defineProperty(u,'value',{get:()=>bound,set:v=>{bound=v;effects.bindings.push(v);}});
  const site={x:0,z:0},house={S:site,big:false,door:{c:{x:8,z:3},out:{x:9,z:3}}};
  const ctx={WSIZE:1024,HALF:512,GRAPHICS_STARTUP:{},CANOPY:{ao:null,tex:null,res:32,next:0},U:{uGroundAO:u,uCanopy:{value:null}},
    COLL:{boxes:[{tag:'wall',x:1.3,z:-2.7,h:6,hx:2.5,hz:0.8,cos:Math.cos(.7),sin:Math.sin(.7)},
      {tag:'prop',x:-511.4,z:510.2,h:0,hx:1.2,hz:1.3,cos:1,sin:0},{tag:'ignored',x:13,z:7,h:3,hx:1,hz:1,cos:1,sin:0}],
      circles:[{tag:'stone',x:5.7,z:3.8,h:2,r:1.25},{tag:'tree',x:20,z:30,h:6,r:3}]},
    LOOK:{towns:[{paths:[{ax:-12.2,az:5.5,bx:20.1,bz:-7.7,w:1.5},{ax:0,az:0,bx:0,bz:0,w:1.9}]}]},
    LOOK3:{halls:[{ax:-512.3,az:507.2,bx:-500.7,bz:515.5,w:1.9}]},HOUSES:[house],REALMS:[{id:0,town:site}],HALL:{list:[]},
    THREE:{DataTexture:Texture,RGFormat:'RG',RGBAFormat:'RGBA',UnsignedByteType:'byte',LinearFilter:'linear'},effects,
    W:{trees:[]},window:{},renderTime:73};
  const math=Object.create(Math);math.random=()=>{effects.random++;throw Error('No RNG permitted');};
  vm.createContext(ctx);
  const util=prior.util;
  const helpers=prior.town+'\n'+prior.hall+'\n'+prior.paths;
  const counted=`const savedMaps=[look2PathMap,look3PathMap],savedPlans=[lookTownPlan,look3HallPlan];
    look2PathMap=(...a)=>{effects.pathCalls++;return savedMaps[0](...a);};look3PathMap=(...a)=>{effects.pathCalls++;return savedMaps[1](...a);};
    lookTownPlan=(...a)=>{effects.planCalls++;return savedPlans[0](...a);};look3HallPlan=(...a)=>{effects.planCalls++;return savedPlans[1](...a);};`;
  const canopySource=canopy?declarations(read('src/00_util.js'),['hash2','vnoise'])+'\n'
    +declarations(terrain,['meadowRGB','bakeMeadowChunks','bakeMeadow','canopyOf','stampCanopy','updateCanopy']):'';
  vm.runInContext('(function(Math,Uint8Array){\n'+util+'\n'+helpers+'\n'+counted+'\n'+(oracle?prior.buildGroundAO:actual)+'\n'+canopySource
    +'\nglobalThis.api={buildGroundAO'+(oracle?'':',prepareGroundAOChunks,prepared:()=>groundAOPrepared')
    +(canopy?',updateCanopy':'')+',replaceMap:fn=>{look2PathMap=fn;}};})(TEST_MATH,TEST_ARRAY);',Object.assign(ctx,{TEST_MATH:math,TEST_ARRAY:array}));
  return {ctx,api:ctx.api,effects,texture:()=>ctx.U.uGroundAO.value};
}
function drain(work,onYield=()=>{}){let n=0,step;do{step=work.next();if(!step.done)onYield(++n);}while(!step.done);return {value:step.value,yields:n};}
const bytes=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);
function compare(h,oracle){assert.deepEqual(bytes(h.ctx.CANOPY.ao),bytes(oracle.ctx.CANOPY.ao));
  assert.deepEqual(bytes(h.texture().data),bytes(oracle.texture().data));
  for(const key of ['w','h','format','type','minFilter','magFilter','generateMipmaps','needsUpdate'])assert.equal(h.texture()[key],oracle.texture()[key],key);
  assert.equal(h.effects.random,0);assert.equal(oracle.effects.random,0);}

test('prepared complete bytes match the independent7201708 oracle without early publication',()=>{
  const h=fixture(),o=fixture({oracle:true}),uniform=h.texture(),plans=[h.ctx.LOOK.towns,h.ctx.LOOK3.halls];
  const result=drain(h.api.prepareGroundAOChunks(),()=>{assert.equal(h.texture(),uniform);assert.equal(h.ctx.CANOPY.ao,null);assert.equal(h.effects.textures.length,0);});
  assert.equal(result.value,true);assert(result.yields>=1024);assert.equal(h.effects.pathCalls,0);assert.equal(h.effects.planCalls,0);
  assert.equal(h.ctx.LOOK.towns,plans[0]);assert.equal(h.ctx.LOOK3.halls,plans[1]);
  h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);assert.equal(h.effects.pathCalls,0);assert.equal(h.effects.textures.length,1);assert.equal(h.effects.bindings.length,1);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.completed,true);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,true);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.bytes,3145728);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.outcome,'consumed');
  assert.equal(h.api.prepared(),null,'Consumed snapshots and byte cache are released');
});
test('synchronous public fallback remains byte-exact',()=>{const h=fixture(),o=fixture({oracle:true});h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);assert.equal(h.effects.pathCalls,2);});
test('work yields bound byte writes instead of publishing a partial map',()=>{
  const h=fixture({countWrites:true}),work=h.api.prepareGroundAOChunks();let before=0;
  const result=drain(work,()=>{assert(h.effects.writes-before<=1024);before=h.effects.writes;assert.equal(h.effects.textures.length,0);});
  assert.equal(result.value,true);assert(h.effects.writes-before<=1024);
});
const mutations={
  'box scalar':c=>c.COLL.boxes[0].x+=.7,'box extent':c=>c.COLL.boxes[0].hx+=1,'box rotation':c=>c.COLL.boxes[0].sin=.5,
  'ignored box becomes wall':c=>c.COLL.boxes[2].tag='wall','box order':c=>c.COLL.boxes.reverse(),
  'box membership':c=>c.COLL.boxes.push({...c.COLL.boxes[0],x:44}),'box source replaced':c=>c.COLL.boxes=c.COLL.boxes.slice(),
  'circle scalar':c=>c.COLL.circles[0].r+=.5,'ignored tree becomes prop':c=>c.COLL.circles[1].tag='prop',
  'circle order':c=>c.COLL.circles.reverse(),'circle source replaced':c=>c.COLL.circles=c.COLL.circles.slice(),
  'town path scalar':c=>c.LOOK.towns[0].paths[0].bx+=1,'town path order':c=>c.LOOK.towns[0].paths.reverse(),
  'town path list replaced':c=>c.LOOK.towns[0].paths=c.LOOK.towns[0].paths.slice(),
  'town plan replaced':c=>c.LOOK.towns=c.LOOK.towns.slice(),'hall path scalar':c=>c.LOOK3.halls[0].w=2.1,
  'hall plan replaced':c=>c.LOOK3.halls=c.LOOK3.halls.slice(),'houses removed':c=>c.HOUSES.length=0,
  'world extent':c=>c.WSIZE=1025,'world origin':c=>c.HALF=511,
};
for(const [name,mutate]of Object.entries(mutations))test('mutation between yields rejects private result: '+name,()=>{
  const h=fixture(),o=fixture({oracle:true}),work=h.api.prepareGroundAOChunks();assert.equal(work.next().done,false);
  mutate(h.ctx);mutate(o.ctx);assert.equal(drain(work).value,false);assert.equal(h.api.prepared(),null);
  h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);
});
for(const name of ['box scalar','circle scalar','town path scalar','hall path scalar','world origin'])test('completed cache revalidates at actual publication: '+name,()=>{
  const h=fixture(),o=fixture({oracle:true});assert.equal(drain(h.api.prepareGroundAOChunks()).value,true);mutations[name](h.ctx);mutations[name](o.ctx);
  h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);assert.equal(h.effects.pathCalls,2);
});
test('missing lazy plans fall back without publishing or invoking those plans during preparation',()=>{
  for(const missing of ['towns','halls']){const h=fixture(),o=fixture({oracle:true});
    if(missing==='towns'){h.ctx.LOOK.towns=[];o.ctx.LOOK.towns=[];}else{h.ctx.LOOK3.halls=null;o.ctx.LOOK3.halls=null;}
    assert.equal(drain(h.api.prepareGroundAOChunks()).value,false);assert.equal(h.effects.planCalls,0);assert.equal(h.effects.textures.length,0);
    h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);
  }
});
test('cancellation exposes nothing and leaves the normal fallback available',()=>{
  const h=fixture(),o=fixture({oracle:true}),work=h.api.prepareGroundAOChunks();work.next();work.next();work.return();
  assert.equal(h.api.prepared(),null);assert.equal(h.effects.textures.length,0);h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.canceled,1);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);
});
test('a newer preparation owns publication and an older canceled generation cannot evict it',()=>{
  const h=fixture(),old=h.api.prepareGroundAOChunks();old.next();assert.equal(drain(h.api.prepareGroundAOChunks()).value,true);
  const latest=h.api.prepared();assert.equal(drain(old).value,false);assert.equal(h.api.prepared(),latest);
  assert.equal(drain(h.api.prepareGroundAOChunks()).value,true);assert.equal(h.api.prepared(),latest);
});
test('a live synchronous winner cancels pending optional work without replacing its texture',()=>{
  const h=fixture(),work=h.api.prepareGroundAOChunks();work.next();h.api.buildGroundAO();const winner=h.texture();
  assert.equal(drain(work).value,false);assert.equal(h.texture(),winner);assert.equal(h.effects.textures.length,1);
});
test('optional byte allocation failure preserves the live synchronous API',()=>{
  const h=fixture({failAllocation:1}),o=fixture({oracle:true});assert.equal(drain(h.api.prepareGroundAOChunks()).value,false);
  assert.equal(h.effects.textures.length,0);h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);
});
test('changed path helper rejects the cache and still executes the current live helper',()=>{
  const h=fixture(),o=fixture({oracle:true});assert.equal(drain(h.api.prepareGroundAOChunks()).value,true);
  h.api.replaceMap(rg=>{rg[1]=17;});o.api.replaceMap(rg=>{rg[1]=17;});h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);
});

const prop=(x,z,yaw=0,hx=3.4,hz=2.65,h=1.6)=>({tag:'prop',x,z,h,hx,hz,cos:Math.cos(yaw),sin:Math.sin(yaw)});
const append=(ctx,rows)=>ctx.COLL.boxes.push(...rows.map(row=>({...row})));
const green=rg=>{const b=Buffer.alloc(rg.length/2);for(let q=0;q<b.length;q++)b[q]=rg[q*2+1];return b;};
function extendedPair(rows,{mutate,canopy=false}={}){
  const h=fixture({canopy}),o=fixture({oracle:true,canopy});assert.equal(drain(h.api.prepareGroundAOChunks()).value,true);
  const prepared=h.api.prepared(),beforeGreen=green(prepared.rg),allocations=h.effects.allocations;
  append(h.ctx,rows);append(o.ctx,rows);mutate?.(h.ctx);mutate?.(o.ctx);
  if(canopy){h.api.updateCanopy();o.api.updateCanopy();}else{h.api.buildGroundAO();o.api.buildGroundAO();}
  compare(h,o);return {h,o,prepared,beforeGreen,allocations};
}
for(const [name,rows]of [
  ['the three ordinary stores-yard-shaped props',[prop(9,3),prop(-11,5,.74),prop(20,-7,-1.28)]],
  ['rotated overlapping props and the map edge',[prop(2,-2,.31,2.1,.8,4),prop(511.8,-511.4,-.67,.5,1.4,0)]],
  ['near the admitted raster limit',[prop(0,0,.3,30,0,.1)]],
])test('bounded appended props reuse exact original full AO/path bytes: '+name,()=>{
  const {h,prepared,beforeGreen,allocations}=extendedPair(rows);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,true);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.appendedProps,rows.length);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.fallbacks,0);assert.equal(h.effects.pathCalls,0);
  assert.equal(h.effects.allocations,allocations,'reuse adds no byte buffers');assert.equal(h.ctx.CANOPY.ao,prepared.b);
  assert.equal(h.texture().data,prepared.rg);assert.deepEqual(green(h.texture().data),beforeGreen);
  assert.equal(h.effects.textures.length,1);assert.equal(h.effects.bindings.length,1);assert.equal(h.api.prepared(),null);
});

for(const [name,rows]of [
  ['a new wall',[{...prop(12,4),tag:'wall'}]],
  ['a mixed prop and non-prop tail',[prop(12,4),{...prop(14,4),tag:'tree'}]],
  ['four appended props',[prop(1,1),prop(3,3),prop(5,5),prop(7,7)]],
  ['an oversized raster after a small valid prop',[prop(1,1),prop(0,0,0,34,34)]],
  ['a nonfinite prop scalar',[{...prop(4,4),x:NaN}]],
  ['a negative prop extent',[prop(4,4,0,-1,1)]],
])test('unapproved appended tail takes unchanged exact synchronous fallback: '+name,()=>{
  const {h}=extendedPair(rows);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.fallbacks,1);assert.equal(h.effects.pathCalls,2);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.appendedProps,0);
});

for(const [name,mutate]of Object.entries(mutations))test('an appended prop cannot bless an old snapshot mutation: '+name,()=>{
  const {h}=extendedPair([prop(15,8)],{mutate});
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);assert.equal(h.effects.pathCalls,2);
});
test('box removal with an appended prop cannot reuse an altered prefix',()=>{
  const {h}=extendedPair([prop(15,8)],{mutate:c=>c.COLL.boxes.splice(0,1)});
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);assert.equal(h.effects.pathCalls,2);
});
test('an appended prop cannot bless a changed live helper',()=>{
  const h=fixture(),o=fixture({oracle:true});drain(h.api.prepareGroundAOChunks());append(h.ctx,[prop(5,5)]);append(o.ctx,[prop(5,5)]);
  h.api.replaceMap(rg=>{rg[1]=17;});o.api.replaceMap(rg=>{rg[1]=17;});h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);assert.equal(h.effects.pathCalls,1,'The replaced town map executes directly; the retained hall map is still counted');
});
test('appended props during preparation still fail the unchanged strict predicate',()=>{
  const h=fixture(),o=fixture({oracle:true}),work=h.api.prepareGroundAOChunks();work.next();append(h.ctx,[prop(5,5)]);append(o.ctx,[prop(5,5)]);
  assert.equal(drain(work).value,false);assert.equal(h.api.prepared(),null);
  h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);
});
test('cancelled preparation plus an appended prop retains the exact normal fallback',()=>{
  const h=fixture(),o=fixture({oracle:true}),work=h.api.prepareGroundAOChunks();work.next();work.return();
  append(h.ctx,[prop(5,5)]);append(o.ctx,[prop(5,5)]);h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.canceled,1);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);
});
test('a mutation during private appended stamping is rejected by the final strict guard',()=>{
  const h=fixture({countWrites:true}),o=fixture({oracle:true});drain(h.api.prepareGroundAOChunks());
  append(h.ctx,[prop(5,5)]);append(o.ctx,[prop(5,5)]);
  h.effects.onWrite=()=>{h.effects.onWrite=null;h.ctx.COLL.circles[0].r+=.5;o.ctx.COLL.circles[0].r+=.5;};
  h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);
  assert.equal(h.effects.pathCalls,2);assert.equal(h.effects.textures.length,1);
});
test('a newer generation during appended stamping cannot be published by the old consumer',()=>{
  const h=fixture({countWrites:true}),o=fixture({oracle:true});drain(h.api.prepareGroundAOChunks());
  append(h.ctx,[prop(5,5)]);append(o.ctx,[prop(5,5)]);let newer;
  h.effects.onWrite=()=>{h.effects.onWrite=null;newer=h.api.prepareGroundAOChunks();newer.next();};
  h.api.buildGroundAO();o.api.buildGroundAO();compare(h,o);const winner=h.texture();
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);assert.equal(drain(newer).value,false);
  assert.equal(h.texture(),winner);assert.equal(h.effects.textures.length,1);
});
test('actual updateCanopy consumes appended props before its ordinary canopy texture publication',()=>{
  const rows=[prop(9,3),prop(-11,5,.74),prop(20,-7,-1.28)],{h,o,prepared,beforeGreen}=extendedPair(rows,{canopy:true});
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,true);assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.appendedProps,3);
  assert.equal(h.ctx.CANOPY.ao,prepared.b);assert.equal(h.effects.textures.length,2);assert.equal(h.effects.textures[0].format,'RG');
  assert.equal(h.effects.textures[1].format,'RGBA');assert.deepEqual(bytes(h.ctx.CANOPY.bytes),bytes(o.ctx.CANOPY.bytes));
  assert.deepEqual(green(h.texture().data),beforeGreen);assert.equal(h.ctx.U.uCanopy.value,h.ctx.CANOPY.tex);
  const first=h.ctx.CANOPY.tex;h.api.updateCanopy();assert.equal(h.ctx.CANOPY.tex,first);assert.equal(h.effects.textures.length,2);
});
for(const [name,mutate]of [
  ['uniform reference',c=>{c.U.uGroundAO={value:c.U.uGroundAO.value};}],
  ['uniform value',c=>{c.U.uGroundAO.value={neutral:'changed'};}],
  ['AO publication',c=>{c.CANOPY.ao=new Uint8Array(1024*1024);}],
  ['canopy publication',c=>{c.CANOPY.tex={live:true};}],
])test('an appended prop cannot bless changed publication ownership: '+name,()=>{
  const {h}=extendedPair([prop(15,8)],{mutate});assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);
  assert.equal(h.effects.pathCalls,2);
});
test('actual updateCanopy preserves a live winner instead of consuming an older appended cache',()=>{
  const h=fixture({canopy:true});drain(h.api.prepareGroundAOChunks());append(h.ctx,[prop(15,8)]);
  const live={winner:true},ao=new Uint8Array(1024*1024),ground={ground:true};
  Object.assign(h.ctx.CANOPY,{tex:live,ao,cache:new Float32Array(0),next:100});h.ctx.U.uGroundAO.value=ground;
  h.api.updateCanopy();assert.equal(h.ctx.CANOPY.tex,live);assert.equal(h.ctx.CANOPY.ao,ao);assert.equal(h.texture(),ground);
  assert.equal(h.ctx.GRAPHICS_STARTUP.groundAO.consumed,false);assert.equal(h.effects.textures.length,0);
});
