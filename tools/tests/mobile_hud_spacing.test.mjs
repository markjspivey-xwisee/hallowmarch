// Actual HUD placement predicates/search only; no browser, WebGL or simulated play.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';

const source=readFileSync(new URL('../../src/10p_hud.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const baseline=JSON.parse(readFileSync(new URL('./fixtures/hud_spacing_7004.json',import.meta.url),'utf8'));
assert.equal(baseline.sourceRawSHA256,'cb91e89eccf700463b9b88b33fb26dce83ee683e4ebb5892c015cf603d7933d5');
const ast=parse(source,{ecmaVersion:'latest'});
const layout=ast.body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='hudLayout');
const initializer=(nodes,name)=>{
  const declaration=nodes.flatMap(node=>node.type==='VariableDeclaration'?node.declarations:[]).find(node=>node.id.name===name);
  assert(declaration,name);return source.slice(declaration.init.start,declaration.init.end);
};
const actualHit=initializer(ast.body,'hudHit'),actualFree=initializer(layout.body.body,'free'),actualSeek=initializer(layout.body.body,'seek');

function fixture({touch=true,old=false,placed=[{x:52,y:32,w:184,h:63,sel:'#pf'}]}={}){
  const S={l:44,r:44,t:24,b:20},W=844,H=390,top=36;
  const ctx=vm.createContext({touch,placed,S,W,H,top,pref:{'#lore-path':['L']},xs:{L:()=>S.l+12},
    inside:r=>r.x>=S.l+2&&r.y>=S.t+2&&r.x+r.w<=W-S.r-2&&r.y+r.h<=H-S.b-2});
  vm.runInContext('globalThis.hudHit='+actualHit+';globalThis.free='+(old?baseline.free:actualFree)+';globalThis.seek='+actualSeek+';',ctx);
  return ctx;
}

test('the real touch predicate rejects the observed7px gap while original7004 accepted it',()=>{
  const next={x:56,y:102,w:180,h:48},old=fixture({old:true}),current=fixture();
  assert.equal(next.y-(old.placed[0].y+old.placed[0].h),7);
  assert.equal(old.free(next),true);assert.equal(current.free(next),false);
  assert.equal(current.free({...next,y:103}),true,'Exactly8px is accepted, without a pixel shim');
});

test('both axes and every sub8px gap are excluded for touch; desktop retains its original4px spacing',()=>{
  const placed=[{x:100,y:100,w:100,h:50}],touch=fixture({placed}),desk=fixture({touch:false,placed});
  for(let gap=0;gap<8;gap++){
    assert.equal(touch.free({x:100,y:150+gap,w:100,h:48}),false,'vertical'+gap);
    assert.equal(touch.free({x:200+gap,y:100,w:100,h:48}),false,'horizontal'+gap);
  }
  for(const r of [{x:100,y:158,w:100,h:48},{x:208,y:100,w:100,h:48}])assert.equal(touch.free(r),true);
  assert.equal(desk.free({x:100,y:154,w:100,h:48}),true);
  assert.equal(desk.free({x:100,y:153,w:100,h:48}),false);
});

test('the unchanged actual6px search advances beyond the rejected7px candidate and remains inside safe bounds',()=>{
  const old=fixture({old:true}),current=fixture(),size={w:180,h:48};
  const oldPlace=old.seek('#lore-path',size),next=current.seek('#lore-path',size);
  assert.equal(oldPlace.y,102);assert.equal(next.y,108);
  assert(next.y-current.placed[0].y-current.placed[0].h>=8);assert.equal(current.free(next),true);
  assert.equal(current.inside(next),true);assert.equal(current.placed.length,1,'Search does not mutate existing panel geometry');
});

test('control/text-size variants retain sufficient measured panel separation and existing no-room refusal',()=>{
  for(const size of [48,52])for(const height of [48,50,54,58]){
    const f=fixture(),next=f.seek('#lore-path',{w:2*size+24,h:height});
    assert(next);assert.equal(f.free(next),true);assert(next.y-f.placed[0].y-f.placed[0].h>=8);
  }
  const f=fixture({placed:[{x:46,y:26,w:752,h:342}]});assert.equal(f.seek('#lore-path',{w:180,h:48}),null);
  assert.equal(f.free({x:0,y:0,w:100,h:48}),false,'Safe rectangle guard remains effective');
});

test('the pinned collision primitive and search stay literal; only touch clearance changes',()=>{
  assert.equal(actualHit,baseline.hudHit);assert.equal(actualSeek,baseline.seek);
  assert.equal(actualFree.replace(', touch ? 8 : 4',''),baseline.free);
  assert(source.includes('el.style.left = Math.round(x - pr.left)'));
  assert(!actualFree.includes('ResizeObserver'));assert(!actualFree.includes('requestAnimationFrame'));
});
