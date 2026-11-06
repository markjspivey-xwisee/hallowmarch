import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/05i_aurora.js', import.meta.url), 'utf8');
function fixture(safe=false) {
  const submitted = [];
  class Vector3 {
    constructor(x=0,y=0,z=0) { Object.assign(this,{x,y,z}); }
    set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
    copy(v) { return this.set(v.x,v.y,v.z); }
    lerp(v,t) { return this.set(this.x+(v.x-this.x)*t,this.y+(v.y-this.y)*t,this.z+(v.z-this.z)*t); }
    normalize() { const n=Math.hypot(this.x,this.y,this.z)||1; return this.set(this.x/n,this.y/n,this.z/n); }
  }
  const scene = { children: [], add(mesh) { this.children.push(mesh); } };
  const ctx = {
    GLSL_CLOUDS:'', GLSL_COMMON:'', fsTriGeo:{}, scene, BOOT_SAFE:safe,
    skyU:{uInvVP:{value:{}},uCloudCover:{value:0}},
    THREE:{Vector3,CustomBlending:1,AddEquation:2,OneFactor:3,ZeroFactor:4,OneMinusSrcAlphaFactor:5,
      BufferGeometry:class { setAttribute(){} setIndex(){} }, Float32BufferAttribute:class {},
      Mesh:class { constructor(geometry,material) { Object.assign(this,{geometry,material,visible:true}); } }},
    mat:opts=>({...opts,name:''}), queueMicrotask(){},
    WEATHER:{overcast:0,storm:0,raining:0,mist:0,fog:0},
    INDOOR:{on:false},U:{uNight:{value:1},uTime:{value:0}},
    camera:{position:{x:0,z:0}},inDungeonX:()=>false,realmWeightsAt:()=>[0,0,1],
    clamp:(n,a,b)=>Math.min(b,Math.max(a,n)),
    sstep:(a,b,n)=>{const t=Math.min(1,Math.max(0,(n-a)/(b-a)));return t*t*(3-2*t);},
    lerp:(a,b,t)=>a+(b-a)*t,quality:{level:'low'},REDUCE_MOTION:true,
  };
  vm.createContext(ctx);
  vm.runInContext(source+'\nglobalThis.effects={AURORA,AUR_STAR,aurU,updateNightSky};',ctx);
  // Exercise ordinary renderer visibility behavior with the production meshes.
  const submit = () => { for (const mesh of scene.children) if (mesh.visible) submitted.push(mesh); };
  return {ctx,scene,submitted,submit,...ctx.effects};
}
test('off night overlays submit no title work immediately after their production constructors',()=>{
  const f=fixture();
  assert.equal(f.scene.children.length,2);
  assert.equal(f.AURORA.on,false); assert.equal(f.aurU.uAur.value,0);
  assert.equal(f.AUR_STAR.on,false);
  assert.equal(f.AURORA.mesh.visible,false);
  assert.equal(f.AURORA.star.visible,false);
  f.submit();
  assert.deepEqual(f.submitted,[],'the idle title must not link dormant night shaders');
});
test('real night-sky updates activate and retire the existing aurora without replacing its material',()=>{
  const f=fixture(), material=f.AURORA.mesh.material;
  f.AURORA.force={str:1,lat:1,clear:1,dark:1};
  f.updateNightSky(1);
  assert.equal(f.AURORA.on,true); assert.equal(f.AURORA.mesh.visible,true);
  f.submit(); assert.deepEqual(f.submitted,[f.AURORA.mesh]);
  assert.equal(f.AURORA.mesh.material,material);
  f.AURORA.force={str:0,lat:1,clear:1,dark:0};
  f.updateNightSky(1);
  assert.equal(f.AURORA.on,false); assert.equal(f.AURORA.mesh.visible,false);
});
test('real shooting-star updates activate and retire the existing streak',()=>{
  const f=fixture(), material=f.AURORA.star.material;
  Object.assign(f.AUR_STAR,{on:true,dur:1,hold:0.5,t:0});
  f.AUR_STAR.a.set(0,1,-1); f.AUR_STAR.b.set(1,1,-1);
  f.updateNightSky(0);
  assert.equal(f.AURORA.star.visible,true);
  assert.equal(f.AURORA.star.material,material);
  f.AUR_STAR.hold=1.1; f.updateNightSky(0);
  assert.equal(f.AUR_STAR.on,false); assert.equal(f.AURORA.star.visible,false);
});
test('night overlays identify their own mesh and material in native failure receipts',()=>{
  const f=fixture();
  assert.equal(f.AURORA.mesh.name,'Aurora curtains');
  assert.equal(f.AURORA.mesh.material.name,'Aurora curtains');
  assert.equal(f.AURORA.star.name,'Shooting star');
  assert.equal(f.AURORA.star.material.name,'Shooting star');
});

test('recovery never submits optional night shaders even when night and a star are active',()=>{
  const f=fixture(true);
  f.AURORA.force={str:1,lat:1,clear:1,dark:1};
  Object.assign(f.AUR_STAR,{on:true,dur:1,hold:0.5,t:0});
  f.AUR_STAR.a.set(0,1,-1); f.AUR_STAR.b.set(1,1,-1);
  f.updateNightSky(1);
  assert.ok(f.AURORA.str>0.004,'the underlying night state was exercised');
  assert.equal(f.AUR_STAR.on,true,'the active streak lifecycle was exercised');
  assert.equal(f.AURORA.on,false);
  assert.equal(f.AURORA.mesh.visible,false);
  assert.equal(f.AURORA.star.visible,false);
  f.submit(); assert.deepEqual(f.submitted,[]);
});
