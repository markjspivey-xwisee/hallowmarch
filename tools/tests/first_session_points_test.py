"""CPU-only fixture geometry checks against the real touch and pickAt contracts."""
import json
import pathlib
import subprocess
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import first_session_journey as journey
from native_journey_browser import installed_driver, process_options


PROGRAM = r"""
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import vm from 'node:vm';
const root=process.argv[1],input=JSON.parse(readFileSync(0,'utf8'));
const THREE=await import(pathToFileURL(join(root,'tools/node_modules/three/build/three.module.min.js')));
const mobile=readFileSync(join(root,'src/10q_mobile.js'),'utf8');
const player=readFileSync(join(root,'src/09_player.js'),'utf8');
const zoneSource=mobile.slice(mobile.indexOf('function mobileMovementZone('),mobile.indexOf('\nfunction mobileApplyPrefs('));
const pickSource=player.slice(player.indexOf('function pickAt('),player.indexOf('\nfunction setPlayerTarget('));
const done=[];
function fixture({hand='right',hud=false,walkable=true,hudRects=[]}={}){
  const width=390,height=780,pitch=.36,distance=8.5,focusY=1.55;
  const camera=new THREE.PerspectiveCamera(55,width/height,.1,900);
  camera.position.set(0,focusY+Math.sin(pitch)*distance,-Math.cos(pitch)*distance);
  camera.lookAt(0,focusY+.25,0);camera.updateMatrixWorld();
  const P={id:1,x:0,y:0,z:0,radius:.45,alive:true,kind:'humanoid',level:1,target:3};
  const herald={id:2,x:0,y:0,z:1.8,radius:.5,alive:true,kind:'humanoid'};
  const quarry={id:3,x:100,prevX:100,y:0,z:100,prevZ:100,radius:.5,alive:true,kind:'wolf',mobType:'wolf',name:'Wolf',level:1,hp:50,maxHp:50,home:{x:100,z:100}};
  const H={GAME:{player:P,prog:{bounty:{camp:0,type:'wolf'}}},CAM:{yaw:0},ENT:[P,herald,quarry],
    CAMPS:[{members:new Set([3])}],camera,mobile:{prefs:{hand}}};
  H.fn={getEnt:id=>H.ENT.find(e=>e.id===id),isWalkable:()=>walkable,heightAt:()=>0,
    screenOf(x,y,z){const p=new THREE.Vector3(x,y,z).project(camera);return p.z>1||p.z< -1?null:{x:(p.x*.5+.5)*width,y:(-p.y*.5+.5)*height,z:p.z};}};
  const context=vm.createContext({__hm:H,innerWidth:width,innerHeight:height,view:{w:width,h:height},MOBILE_PREFS:H.mobile.prefs,
    document:{elementFromPoint:x=>({id:(hud===true||hud==='left'&&x<width*.5)?'hud':'scene'}),
      querySelectorAll:()=>hudRects.map(rect=>({hidden:false,closest:()=>null,getBoundingClientRect:()=>rect}))},
    getComputedStyle:()=>({display:'grid',visibility:'visible'}),Math,Error,GAME:H.GAME,ENT:H.ENT,camera,
    clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),dist:(x,z,a,b)=>Math.hypot(x-a,z-b),screenOf:H.fn.screenOf,
    playerTargetVisible:()=>true,setPlayerTarget:e=>{P.target=e?e.id:null;}});
  const zone=vm.runInContext('('+zoneSource+')',context),pick=vm.runInContext('('+pickSource+')',context);
  return {H,P,quarry,zone,pick,run:(source,arg)=>vm.runInContext('('+source+')',context)(arg)};
}
for(const hand of ['right','left']){
  const f=fixture({hand}),result=f.run(input.arrange,{touch:true}),point=f.H.fn.screenOf(f.quarry.x,.6,f.quarry.z);
  assert.equal(f.zone(point.x,point.y),false,'touch fixture must not land in the actual movement zone');
  assert.equal(f.run(input.selectable,{point,touch:true}),true);
  f.pick(point.x,point.y);assert.equal(f.P.target,f.quarry.id,'actual pickAt must select the arranged quarry');
  assert.equal(f.quarry.hp,50);assert.equal(f.quarry.maxHp,50);assert.equal(f.quarry.level,1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.original)),{x:100,y:0,z:100,home:{x:100,z:100}});
  done.push('visible touch quarry '+hand);
}
{
  const f=fixture(),result=f.run(input.arrange,{touch:false});
  assert.equal(f.zone(result.inputPoint.x,result.inputPoint.y),true,'desktop may use an unobstructed point on either side');
  f.pick(result.inputPoint.x,result.inputPoint.y);assert.equal(f.P.target,f.quarry.id);done.push('desktop native pick');
}
{
  const f=fixture({hud:'left'}),result=f.run(input.arrange,{touch:false});
  assert(result.inputPoint.x>195,'a HUD-obstructed candidate must be rejected before moving the quarry');
  f.pick(result.inputPoint.x,result.inputPoint.y);assert.equal(f.P.target,f.quarry.id);done.push('reject obstructed candidate');
}
for(const option of [{hud:true},{walkable:false}]){
  const f=fixture(option);assert.throws(()=>f.run(input.arrange,{touch:true}),/No walkable nearby fixture position/);
  assert.equal(f.quarry.x,100);assert.equal(f.quarry.z,100);assert.equal(f.quarry.hp,50);done.push('no mutation on unavailable fixture '+JSON.stringify(option));
}
for(const hand of ['right','left']){
  const f=fixture({hand}),point=f.run(input.empty,{touch:true});
  assert(point);assert.equal(f.zone(point.x,point.y),false);
  f.pick(point.x,point.y);assert.equal(f.P.target,null,'actual pickAt must clear at the verified empty point');
  assert.equal(f.quarry.hp,50);done.push('empty touch clear '+hand);
}
{
  const f=fixture({hud:true});assert.equal(f.run(input.empty,{touch:true}),null);done.push('no false empty point beneath HUD');
}
for(const [name,right,bottom] of [['failed b expanded target',201,149],['passed c compact target',202,124.890625]]){
  const target={left:8,top:80,right,bottom,width:right-8,height:bottom-80};
  const f=fixture({hudRects:[target]}),point=f.run(input.empty,{touch:true});
  assert(point);assert.notDeepEqual(JSON.parse(JSON.stringify(point)),{x:195,y:156},'near-edge point must be refused even when geometric hit-test is canvas');
  assert(point.x<target.left-32||point.x>target.right+32||point.y<target.top-32||point.y>target.bottom+32);
  assert.equal(f.zone(point.x,point.y),false);f.pick(point.x,point.y);assert.equal(f.P.target,null);
  done.push('safe touch clearance '+name);
}
{
  const f=fixture({hudRects:[{left:0,top:0,right:390,bottom:780,width:390,height:780}]});
  assert.equal(f.run(input.empty,{touch:true}),null,'an occupied viewport cannot manufacture a safe point');done.push('no safe interior beneath full HUD');
}
console.log(JSON.stringify(done));
"""


class FirstSessionPoints(unittest.TestCase):
    def test_actual_touch_zone_and_pick_contracts(self):
        node, _ = installed_driver()
        result = subprocess.run([str(node), '--input-type=module', '-e', PROGRAM, str(journey.ROOT)],
                                input=json.dumps({'arrange': journey.ARRANGE_QUARRY,
                                                  'selectable': journey.SELECTABLE_CANVAS_POINT,
                                                  'empty': journey.EMPTY_CANVAS_POINT}),
                                capture_output=True, text=True, encoding='utf-8', timeout=20, **process_options())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(len(json.loads(result.stdout)), 12)


if __name__ == '__main__':
    unittest.main()
