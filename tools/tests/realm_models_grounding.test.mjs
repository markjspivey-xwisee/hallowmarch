import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as THREE from '../node_modules/three/build/three.module.js';

const source = await readFile(new URL('../../src/10r_realm_models.js',import.meta.url),'utf8');
const worldSource=await readFile(new URL('../../src/01_world.js',import.meta.url),'utf8');
const floorSource=await readFile(new URL('../../src/04g_castles.js',import.meta.url),'utf8');
const buildSource=await readFile(new URL('../../src/06k_build.js',import.meta.url),'utf8');
const wallSource=await readFile(new URL('../../src/07g_walls.js',import.meta.url),'utf8');
const extract=(body,name)=>{const at=body.indexOf('function '+name+'(');return body.slice(at,body.indexOf('\n}',at)+2);};
const plot = (id,x=0,extra={}) => ({id,x,z:0,owner:0,home:0,yaw:0,...extra});
const building = (id,x=0,extra={}) => ({id,plotId:id,kind:'house',x,z:0,owner:0,home:0,yaw:0,level:1,status:'built',progress:1,...extra});
function fixture({plots=[],buildings=[],height=(x,z)=>x*.1+z*.05}={}) {
  const scene = new THREE.Scene(), boxes=[], covers=[], removed=[], masks=[];
  const context = vm.createContext({THREE,scene,GAME:{started:true,player:{faction:0}},NETS:{s:{management:{publicPlots:plots,publicBuildings:buildings}}},
    W:{H:new Float32Array(1)},A2FL:{ground:0},HALF:512,UI:{modal:null},THRONE_RTS:{active:false},THRONE_RTS_UI:{tab:'realm',form:{},selectedPlot:''},
    camera:new THREE.PerspectiveCamera(),U:{uNight:{value:0}},GLSL_COMMON:'',GLSL_ATMOS:'',GLSL_SHADOW:'',GLSL_PLIGHT:'',GLSL_LIGHT:'',GLSL_WEATHER:'',GLSL_SEASON:'',
    mat:options=>new THREE.ShaderMaterial({...options,uniforms:{uNight:context.U.uNight}}),heightAt:(x,z)=>height(x,z),
    hallThroneGrant:()=>true,realmRtsSiteStatus:row=>({eligible:!row.blocked}),realmRtsSiteFrame:row=>({yaw:row.yaw||0}),
    realmRtsSiteGround:row=>{let min=Infinity,max=-Infinity;const c=Math.cos(row.yaw||0),s=Math.sin(row.yaw||0);
      for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++){const y=height(row.x+x*c+z*s,row.z-x*s+z*c);min=Math.min(min,y);max=Math.max(max,y);}return{min,max,top:max+.06,bottom:min-.12};},
    COLL:{boxes,circles:[],grid:new Map(),cell:16},COVER:{built:true},removed,
    DUN_X0:10000,SICE:{on:false},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),dist2:(x,z,a,b)=>(x-a)**2+(z-b)**2,
    wallMatOf:()=>0,wallSet:(result,t)=>{result.t=t;},realmRtsSitesClear(){},
    coverMarkBox:(...args)=>covers.push(args),buildCoverMask:()=>masks.push(true),
  });
  const collision=['collKey','collRegister','addBox','collidersNear','resolveCollisions'].map(name=>extract(worldSource,name)).join('\n');
  const floors=floorSource.slice(floorSource.indexOf('const FLOOR ='),floorSource.indexOf('const elevatedEnt'));
  vm.runInContext(collision+'\nlet _collQ=0;const _cn=[];\n'+floors+'\n'+extract(buildSource,'bCollRemove')+'\n'+extract(buildSource,'bFloorRemove')+'\n'+extract(wallSource,'wallColl')+
    '\nconst removeOriginal=bCollRemove;bCollRemove=c=>{removed.push(c);removeOriginal(c);};\n'+source+
    '\nthis.state=REALM_RTS_MODELS;this.frame=realmRtsModelsFrame;this.clear=realmRtsModelsClear;this.floors=FLOOR;',context);
  return {context,scene,boxes,covers,removed,masks,state:context.state,frame:()=>context.frame(.1),clear:()=>context.clear(),
    tick(){context.frame(.1);context.frame(.1);context.frame(.1);},
    construction(){context.UI.modal='rts';context.THRONE_RTS.active=true;context.THRONE_RTS_UI.tab='build';},
    changeHeight(next){height=next;context.A2FL.ground++;},data:context.NETS.s.management};
}
function instance(pool,index=0){const matrix=new THREE.Matrix4();pool.getMatrixAt(index,matrix);return matrix;}

test('ordinary play has no empty outlines; Construction admits only owned eligible vacant sites',()=>{
  const f=fixture({plots:[plot('own'),plot('enemy',30,{owner:1}),plot('blocked',60,{blocked:true}),plot('occupied',90)],buildings:[building('occupied',90)]});
  f.frame();assert.equal(f.state.plots,null);assert.equal(f.state.buildings,1);
  f.construction();f.tick();assert.ok(f.state.plots);assert.equal(f.state.plots.geometry.attributes.position.count,4*12*6);
  f.context.hallThroneGrant=()=>false;f.frame();assert.equal(f.state.plots,null);
});

test('all outline vertices follow sloped terrain under rotated home orientation',()=>{
  const height=(x,z)=>2+x*.15-z*.08,f=fixture({plots:[plot('own',5,{z:9,yaw:Math.PI/2})],height});
  f.construction();f.frame();const positions=f.state.plots.geometry.attributes.position;
  for(let i=0;i<positions.count;i++)assert.ok(Math.abs(positions.getY(i)-height(positions.getX(i),positions.getZ(i))-.06)<.00002);
  const normals=f.state.plots.geometry.attributes.normal;assert.ok(normals.getY(0)>0);
});

test('terrain and selection refresh overlays while steady frames and camera pans reuse geometry',()=>{
  const f=fixture({plots:[plot('own')]});f.construction();f.frame();const initial=f.state.plots.geometry;
  let disposed=0;initial.addEventListener('dispose',()=>disposed++);f.tick();assert.equal(f.state.plots.geometry,initial);
  f.context.camera.position.set(200,180,-100);f.context.camera.fov=70;f.tick();assert.equal(f.state.plots.geometry,initial);
  f.context.THRONE_RTS_UI.form.plotId='own';f.tick();assert.notEqual(f.state.plots.geometry,initial);assert.equal(disposed,1);
  const selected=f.state.plots.geometry;f.changeHeight(()=>8);f.tick();assert.notEqual(f.state.plots.geometry,selected);
  assert.ok(Math.abs(f.state.plots.geometry.attributes.position.getY(0)-8.06)<.00002);
});

test('legacy buildings keep coordinates and owner-independent yaw with a foundation reaching all sampled ground',()=>{
  const row=building('legacy',11,{z:15,home:0,owner:2,yaw:Math.PI/3}),original=JSON.stringify(row);
  const f=fixture({buildings:[row],height:(x,z)=>x*.3-z*.2});f.frame();
  const foundation=instance(f.state.pools.get('foundation'));
  f.state.pools.get('foundation').geometry.computeBoundingBox();const world=f.state.pools.get('foundation').geometry.boundingBox.clone().applyMatrix4(foundation);
  const ground=f.context.realmRtsSiteGround(row);assert.ok(world.min.y<=ground.min);assert.ok(Math.abs(world.max.y-ground.top)<.00001);
  assert.equal(foundation.elements[12],11);assert.equal(foundation.elements[14],15);assert.equal(f.boxes[0].yaw,Math.PI/3);
  assert.equal(f.boxes[0].baseY,ground.bottom);assert.equal(JSON.stringify(row),original);
});

test('colliders and grass cover are managed once per solid footprint, not each construction percent',()=>{
  const row=building('new',20,{status:'building',progress:.2}),adopted=building('existing-town',50,{adopted:true});
  const f=fixture({buildings:[row,adopted]});f.frame();assert.ok(f.boxes.length>1);assert.equal(f.covers.length,1);
  const total=f.boxes.length,collider=f.boxes[1],before=collider.h;row.progress=.6;f.tick();assert.equal(f.boxes[1],collider);assert.ok(collider.h>before);
  assert.equal(f.covers.length,1);assert.equal(f.removed.length,0);
  f.data.publicBuildings=[];f.tick();assert.equal(f.boxes.length,0);assert.equal(f.removed.length,total);assert.equal(f.masks.length,1);
  assert.equal(f.context.floors.list.length,0);assert.ok([...f.context.COLL.grid.values()].every(rows=>rows.length===0));
  assert.ok([...f.context.floors.grid.values()].every(rows=>rows.length===0));
});

test('world changes and clear dispose private scene resources and remove their colliders',()=>{
  const f=fixture({plots:[plot('own')],buildings:[building('built',40)]});f.construction();f.frame();
  const oldMaterial=f.state.material,oldGeometry=f.state.plots.geometry;let materialDisposed=0,geometryDisposed=0;
  oldMaterial.addEventListener('dispose',()=>materialDisposed++);oldGeometry.addEventListener('dispose',()=>geometryDisposed++);
  const solidCount=f.boxes.length;f.context.W.H=new Float32Array(1);f.frame();assert.equal(materialDisposed,1);assert.equal(geometryDisposed,1);assert.equal(f.boxes.length,solidCount);
  assert.notEqual(f.state.material,oldMaterial);assert.equal(f.state.material.uniforms.uNight,f.context.U.uNight);
  f.clear();assert.equal(f.boxes.length,0);assert.equal(f.context.floors.list.length,0);assert.equal(f.scene.children.length,0);assert.equal(f.state.solids.size,0);
});

test('render and physical integration stay bounded to 72 unique validated rows',()=>{
  const f=fixture({buildings:Array.from({length:100},(_,i)=>building('b'+String(i).padStart(3,'0'),i*2))});f.frame();
  assert.ok(f.boxes.length<=72*65);assert.equal(f.context.floors.list.length,72);assert.equal(f.state.pools.get('foundation').count,72);assert.equal(f.state.solids.size,72);
});

test('foundation apron supports real floorAt and remains passable while the visible building body blocks actors and shots',()=>{
  const f=fixture({buildings:[building('house')],height:()=>0});f.frame();const top=.06;
  assert.equal(f.context.floorAt(5,0,3),top);assert.equal(f.context.floorAt(5,0,top),top);
  assert.equal(f.context.floorSolidAt(5,0,top),false);
  const apron={x:5,z:0};f.context.resolveCollisions(apron,.35,top);assert.deepEqual(apron,{x:5,z:0});
  const body={x:0,z:0};f.context.resolveCollisions(body,.35,top);assert.ok(Math.hypot(body.x,body.z)>1);
  const shot=x=>{const result={t:1};for(const c of f.boxes)if(c.active)f.context.wallColl(c,x,1.5,-8,0,0,16,result,x,1.5,-8,null,0);return result.t;};
  assert.equal(shot(5),1,'no invisible wall above empty apron');assert.ok(shot(0)<1,'main body stops the real projectile query');
});

test('pose-only metadata changes update both visual orientation and physics, with no canonical relocation',()=>{
  const row=building('house',20),f=fixture({buildings:[row]});f.frame();const before=instance(f.state.pools.get('house'));
  row.yaw=Math.PI/2;row.home=1;row.placementVersion=2;f.tick();const after=instance(f.state.pools.get('house'));
  assert.notDeepEqual(after.elements,before.elements);assert.equal(after.elements[12],20);assert.equal(after.elements[14],0);
  assert.equal(f.boxes[0].yaw,Math.PI/2);
});

test('terrain mesh readiness gates the first fit and invalidation clears visual and physical models',()=>{
  const f=fixture({buildings:[building('house')],height:()=>0});f.context.LOD={built:false};
  const sample=f.context.realmRtsSiteGround;
  f.context.realmRtsSiteGround=row=>{const ground=sample(row);return f.context.LOD.built?{...ground,min:2,max:2,top:2.06,bottom:1.88}:ground;};
  f.frame();assert.equal(f.state.group,null);assert.equal(f.boxes.length,0);assert.equal(f.context.floors.list.length,0);
  f.context.LOD.built=true;f.frame();const after=instance(f.state.pools.get('foundation')),group=f.state.group,collider=f.boxes[0];
  assert.equal(f.context.A2FL.ground,0);assert.ok(Math.abs(after.elements[13]-1.88)<.00001);
  assert.equal(f.boxes[0].y0,1.88);assert.equal(f.context.floors.list[0].ya,2.06);
  f.context.LOD.built=false;f.frame();assert.equal(f.state.group,null);assert.equal(f.boxes.length,0);assert.equal(f.context.floors.list.length,0);
  f.context.LOD.built=true;f.frame();assert.notEqual(f.state.group,group);assert.notEqual(f.boxes[0],collider);assert.equal(f.boxes[0].y0,1.88);
});
