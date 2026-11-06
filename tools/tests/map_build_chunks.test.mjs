import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse,tokenizer} from 'acorn';

const read=file=>readFileSync(new URL('../../src/'+file,import.meta.url),'utf8');
const pinned=JSON.parse(readFileSync(new URL('./fixtures/map_build_be8dece.json',import.meta.url),'utf8'));
const sources=new Map();
function actual(file,name){
  if(!sources.has(file)){const text=read(file);sources.set(file,{text,nodes:parse(text,{ecmaVersion:'latest'}).body});}
  const {text,nodes}=sources.get(file),n=nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);
  assert(n,name);return text.slice(n.start,n.end);
}
function declaration(file,name){const text=read(file),n=parse(text,{ecmaVersion:'latest'}).body.find(n=>n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name));assert(n,name);return text.slice(n.start,n.end);}
const candidate=['buildMapImage','buildMapImageChunks','buildDungeonMap','buildDungeonMapChunks'].map(n=>actual('10_ui.js',n)).join('\n');
const common=['TAU','clamp','lerp','sstep','angDiff'].map(n=>declaration('00_util.js',n)).join('\n')+'\n'+declaration('01_world.js','bearingOf');
const sha=text=>createHash('sha256').update(text).digest('hex');
const tokens=text=>Array.from(tokenizer(text,{ecmaVersion:'latest'}),t=>text.slice(t.start,t.end));
test('independent current-release map/readers oracle is pinned and public terrain/water readers stay unchanged',()=>{
  assert.equal(pinned.revision,'be8decea8934f8082da1f854143bd32fc0c66fd1');
  const expected={buildMapImage:'8e91f59b75cc36a10ae6d9e0b373e0c5e3a10f87dd0fc301a6e1cdbc99dc4330',buildDungeonMap:'105de8b2d365c3a9bfb32802789a6a05eb1fa60a1e327984697ad763edf591b1',
    heightAt:'3e5bf0606b8d0c8e5379057a438bba4783314cc462479b47a875f44a27db15f1',sampleGrid:'4438f139abe441051c51a9bc1d5d616d80ec7343a70ba5341aeab7bd40b73b50',realmWeightsAt:'bf12a6059a4e7add8ef4db36d4456dedcee6b2b4e166aca91266add5fe0f922c',
    waterAt:'9e08bf8a6bd13b41592837ca309e1f8fd199a17745ba02c5d3cf3143ebc3ab51',hex3:'4ad2b3d4cb3f723ca8636231f3a1ec5f912b1be7cc10fa02bb04803da0a72618',dunIdx:'a9911588b7ed11f4459d86c31537dea2928ae9d24423f8158a15f83448758607'};
  for(const[name,hash]of Object.entries(expected)){
    assert.equal(sha(pinned.functions[name].source),hash,name+' independent body');
    if(!name.startsWith('build'))assert.deepEqual(tokens(actual(pinned.functions[name].file,name)),tokens(pinned.functions[name].source),name+' public reader unchanged');
  }
  assert.equal(sha(pinned.common.source),'67911e4f320b9d58957d7c3853638c6c31aaba27ba6bd9a7ecc7cd29ff6f0736');
  assert.deepEqual(tokens(common),tokens(pinned.common.source),'shared arithmetic constants remain pinned too');
  assert.deepEqual(tokens(declaration('01_world.js','WSIZE')),tokens('const WSIZE=1024,HALF=512,HN=513,HS=2;'));
  assert.deepEqual(tokens(declaration('04d_barrow.js','DUN_X0')),tokens('const DUN_X0=1000;'));
  assert.deepEqual(tokens(declaration('10_ui.js','DMAP_PX')),tokens('const DMAP_PX=4;'));
});

function fixture({old=false,seed=7,trees=777,dry=false,threshold=false,GW=230,GH=84}={}){
  const HN=513,N=HN*HN,W={H:new Float32Array(N),rock:new Float32Array(N),road:new Float32Array(N),field:new Float32Array(N),trees:[]};
  const WATERGRID={surf:dry?null:new Float32Array(N).fill(NaN),fx:dry?null:new Float32Array(N),fz:dry?null:new Float32Array(N)};
  for(let j=0;j<HN;j++)for(let i=0;i<HN;i++){
    const q=j*HN+i,x=-512+i*2,z=-512+j*2;
    W.H[q]=Math.sin((i+seed)*.027)*19+Math.cos((j-seed)*.041)*21-4-Math.max(0,1-Math.hypot(x-57,z+31)/48)*9;
    W.rock[q]=(Math.sin(i*.11+j*.09+seed)+1)*.5;W.road[q]=Math.max(0,1-Math.abs(x+z*.07)/8);W.field[q]=(Math.cos(i*.023-j*.016-seed)+1)*.5;
    if(!dry&&(threshold||Math.hypot(i-140,j-160)<51||Math.abs(i-260-Math.sin(j*.031)*30)<4)){
      WATERGRID.surf[q]=threshold?W.H[q]+[.009,.01,.011,.049,.05,.051,.1][q%7]:9;
      WATERGRID.fx[q]=threshold?(q%3?0:1e-6):Math.abs(i-260-Math.sin(j*.031)*30)<4?.6:0;
      WATERGRID.fz[q]=q%13===0?.2:0;
    }
  }
  for(let i=0;i<trees;i++)W.trees.push({x:((i*127.137+seed)%1000)-500,z:((i*67.513+seed*3)%1000)-500});
  const REALMS=[{color:'#c9483b',bearing:150*Math.PI/180},{color:'#2f9a6a',bearing:270*Math.PI/180},{color:'#4d7fcb',bearing:30*Math.PI/180}];
  const DUN={GW,GH,cell:new Uint8Array(GW*GH),fy:new Float32Array(GW*GH)};
  for(let j=0;j<GH;j++)for(let i=0;i<GW;i++){const q=j*GW+i;DUN.cell[q]=(i+j+seed)%5?((i+j)%9===0?3:1):0;DUN.fy[q]=Math.sin(i*.07+j*.13+seed)*14;}
  const initial={map:'old world',dungeon:'old dungeon'},publications=[],canvases=[],images=[];
  const UI={};let map=initial.map,dungeon=initial.dungeon;
  Object.defineProperties(UI,{mapImg:{get:()=>map,set:value=>{map=value;publications.push(['map',value.commands.length]);}},dunImg:{get:()=>dungeon,set:value=>{dungeon=value;publications.push(['dungeon',value.commands.length]);}}});
  const document={createElement(tag){assert.equal(tag,'canvas');const c={width:0,height:0,commands:[],image:null};
    const ctx={createImageData(w,h){const img={width:w,height:h,data:new Uint8ClampedArray(w*h*4)};images.push(img);return img;},
      putImageData(img,x,y){c.image=Buffer.from(img.data);c.commands.push(['putImageData',x,y,img.width,img.height]);},
      fillRect(x,y,w,h){c.commands.push(['fillRect',x,y,w,h]);},
      set fillStyle(value){c.commands.push(['fillStyle',value]);}};
    c.getContext=type=>{assert.equal(type,'2d');return ctx;};canvases.push(c);return c;}};
  const math=Object.create(Math);math.random=()=>{throw Error('Maps must not consume RNG');};
  const helpers=Object.entries(pinned.functions).filter(([n])=>!n.startsWith('build')).map(([,v])=>v.source).join('\n');
  const body=old?[pinned.functions.buildMapImage.source,pinned.functions.buildDungeonMap.source].join('\n'):candidate;
  const api=new Function('W','WATERGRID','REALMS','DUN','UI','document','Math','THREE',(old?pinned.common.source:common)+`
    const WSIZE=1024,HALF=512,HN=513,HS=2,DUN_X0=1000,DMAP_PX=4,_wa={y:0,depth:0,fx:0,fz:0};
    const dunFloorAt=()=>{throw Error('Map escaped its overworld domain');},late3WaterAt=dunFloorAt;
    `+helpers+'\n'+body+'\nreturn {buildMapImage,buildDungeonMap,'+(old?'':'buildMapImageChunks,buildDungeonMapChunks,')+'heightAt,sampleGrid};')(
      W,WATERGRID,REALMS,DUN,UI,document,math,new Proxy({},{get(){throw Error('Maps must not construct Three resources');}}));
  return{W,WATERGRID,REALMS,DUN,UI,initial,publications,canvases,images,api};
}
function equalImage(a,b,key){
  assert.equal(a.UI[key].width,b.UI[key].width);assert.equal(a.UI[key].height,b.UI[key].height);
  assert.deepEqual(a.UI[key].image,b.UI[key].image,'every base ImageData RGBA byte');
  assert.deepEqual(a.UI[key].commands,b.UI[key].commands,'every ordered Canvas2D command/style including fractional tree stamps');
  assert.deepEqual(a.publications,b.publications,'same complete-only publication boundary');
}
function drain(work,onYield=()=>{}){let yields=0;for(;;){const step=work.next();if(step.done)return yields;onYield(++yields);}}
for(const seed of[7,19,503])test('all512²world bytes and forest drawing commands match pinned synchronous source: '+seed,()=>{
  const a=fixture({old:true,seed}),b=fixture({seed});a.api.buildMapImage();
  const yields=drain(b.api.buildMapImageChunks(),()=>assert.equal(b.UI.mapImg,b.initial.map));
  assert.equal(yields,128+Math.floor(b.W.trees.length/256));equalImage(a,b,'mapImg');
});
for(const options of[{dry:true,trees:0},{threshold:true,trees:256}])test('dry borders / water depth and current thresholds retain exact map output: '+JSON.stringify(options),()=>{
  const a=fixture({old:true,...options}),b=fixture(options);a.api.buildMapImage();b.api.buildMapImage();equalImage(a,b,'mapImg');
});
for(const options of[{GW:230,GH:84},{GW:13,GH:7}])test('dungeon floor and wall passes retain all original ordered canvas commands: '+JSON.stringify(options),()=>{
  const a=fixture({old:true,...options}),b=fixture(options);a.api.buildDungeonMap();
  const yields=drain(b.api.buildDungeonMapChunks(),()=>assert.equal(b.UI.dunImg,b.initial.dungeon));
  assert.equal(yields,2*Math.ceil(options.GH/4));equalImage(a,b,'dunImg');
});
test('world pixel work yields after four rows and tree draws never exceed256 per token',()=>{
  const f=fixture(),work=f.api.buildMapImageChunks();work.next();
  const alpha=f.images[0].data;for(let row=0;row<512;row++)assert.equal(alpha[(row*512)*4+3],row<4?255:0);
  let drawn=0;drain(work,()=>{const now=f.canvases[0].commands.filter(c=>c[0]==='fillRect').length;assert(now-drawn<=256);drawn=now;});
  assert(f.UI.mapImg.commands.filter(c=>c[0]==='fillRect').length-drawn<=256);
});
for(const kind of['MapImage','DungeonMap'])test('interrupted '+kind+' never publishes its partial canvas or changes the world',()=>{
  const f=fixture(),key=kind==='MapImage'?'mapImg':'dunImg',before=Buffer.from(f.W.H.buffer);
  const work=f.api['build'+kind+'Chunks']();work.next();work.return();assert.equal(work.next().done,true);
  assert.equal(f.UI[key],kind==='MapImage'?f.initial.map:f.initial.dungeon);assert.deepEqual(f.publications,[]);assert.deepEqual(Buffer.from(f.W.H.buffer),before);
});
for(const kind of['MapImage','DungeonMap'])test('cancellation after a completed private drawing phase still publishes no '+kind,()=>{
  const f=fixture({trees:512}),work=f.api['build'+kind+'Chunks'](),tokens=kind==='MapImage'?129:Math.ceil(f.DUN.GH/4);
  for(let n=0;n<tokens;n++)assert.equal(work.next().done,false);
  if(kind==='MapImage'){assert(f.canvases[0].image);assert.equal(f.canvases[0].commands.filter(c=>c[0]==='fillRect').length,256);}
  else assert(!f.canvases[0].commands.some(c=>c[0]==='fillStyle'&&c[1]==='rgba(30,26,22,0.95)'));
  work.return();assert.deepEqual(f.publications,[]);
});
test('terrain/tree edits and replaced immutable-grid references between yields cannot mix world-map snapshots',()=>{
  const a=fixture({old:true}),b=fixture();a.api.buildMapImage();const work=b.api.buildMapImageChunks();work.next();
  b.W.H.fill(99);b.W.H=new Float32Array(513*513);b.W.trees[0].x+=91;b.W.trees[0].z-=83;b.W.trees.push({x:9,z:11});
  b.W.rock=new Float32Array(513*513).fill(1);b.W.road=new Float32Array(513*513);b.W.field=new Float32Array(513*513);
  b.WATERGRID.surf=null;b.WATERGRID.fx=null;b.WATERGRID.fz=null;b.REALMS[0].bearing=0;b.REALMS[0].color='#ffffff';
  drain(work);equalImage(a,b,'mapImg');assert.equal(b.W.H[0],0,'map never writes terrain');
});
test('dungeon floor/cell edits and dimension changes between yields cannot mix dungeon-map snapshots',()=>{
  const a=fixture({old:true}),b=fixture();a.api.buildDungeonMap();const work=b.api.buildDungeonMapChunks();work.next();
  b.DUN.cell.fill(0);b.DUN.fy.fill(99);b.DUN.GW=1;b.DUN.GH=1;b.DUN.cell=new Uint8Array(1);b.DUN.fy=new Float32Array(1);
  drain(work);equalImage(a,b,'dunImg');
});
test('the synchronous public APIs finish immediately while boot explicitly selects only bounded iterators',()=>{
  const f=fixture({dry:true,trees:0});assert.equal(f.api.buildMapImage(),undefined);assert.notEqual(f.UI.mapImg,f.initial.map);
  assert.equal(f.api.buildDungeonMap(),undefined);assert.notEqual(f.UI.dunImg,f.initial.dungeon);
  assert.match(read('13_main.js'),/loadStep\(0\.84, 'Drawing the map', \(\) => bootSequence\(\[buildMapImageChunks, buildDungeonMapChunks\]\)\)/);
});
