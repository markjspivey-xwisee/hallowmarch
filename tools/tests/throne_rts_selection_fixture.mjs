// CPU fixtures execute selected actual source; they do not create a renderer or a world.
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as THREE from '../node_modules/three/build/three.module.js';
import {parse} from '../node_modules/acorn/dist/acorn.mjs';

export {THREE};
export const read=name=>readFileSync(new URL('../../src/'+name,import.meta.url),'utf8');
export const uiSource=read('10q_throne_rts.js'),modelSource=read('10r_realm_models.js');
export const oracle=JSON.parse(readFileSync(new URL('./fixtures/rts_construction_feedback_d5.json',import.meta.url),'utf8'));
const parsed=new Map();
export function extract(source,name) {
  let body=parsed.get(source);
  if(!body){body=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body;parsed.set(source,body);}
  const matches=body.filter(node=>node.type==='FunctionDeclaration'&&node.id.name===name);
  if(matches.length!==1)throw Error('Missing or duplicate actual function '+name);
  return source.slice(matches[0].start,matches[0].end);
}
class Element {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.nodeType=1;this.children=[];this.dataset={};this.attributes={};this.style={setProperty:(k,v)=>{this.style[k]=v;}};this.options=[];this.innerHTMLWrites=0;this._html='';this.value='';this.disabled=false;this.classes=new Set();this.classList={toggle:(k,on)=>on?this.classes.add(k):this.classes.delete(k),contains:k=>this.classes.has(k)};}
  get innerHTML(){return this._html;}
  set innerHTML(value){this._html=value;this.innerHTMLWrites++;if(this.tagName==='SELECT'){const decode=s=>s.replace(/&(amp|lt|gt|quot|#39);/g,(_,key)=>({'amp':'&','lt':'<','gt':'>','quot':'"','#39':"'"}[key]));this.options=[...value.matchAll(/<option value="([^"]*)"(?: selected)?>([^<]*)<\/option>/g)].map(m=>({value:decode(m[1]),textContent:decode(m[2])}));}}
  get firstChild(){return this.children[0];}
  appendChild(node){return this.insertBefore(node,null);}
  insertBefore(node,before){if(node.parentElement)node.remove();const at=before?this.children.indexOf(before):this.children.length;this.children.splice(at,0,node);node.parentElement=this;return node;}
  remove(){if(this.parentElement){const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null;}}
  setAttribute(k,v){this.attributes[k]=String(v);}
  querySelector(selector){return selector==='span'?this.children.find(n=>n.tagName==='SPAN'):null;}
}
export function selectionFixture({baseline=false,plots,catalog}={}) {
  const ledger={revision:1,plots:plots||[{id:'town:1:0',site:'town:1',name:'Town west',owner:1,x:0,z:0},{id:'keep:0:0',site:'keep:0',name:'Keep east',owner:1,x:20,z:0}],
    catalog:catalog||[{id:'mill',label:'Mill',siteTypes:['town'],cost:{timber:10},workers:2,seconds:45,maxLevel:3},{id:'sawmill',label:'Sawmill',siteTypes:['town','keep'],cost:{timber:20},workers:3,seconds:60,maxLevel:3},{id:'watchpost',label:'Watchpost',siteTypes:['keep'],cost:{stone:40},workers:2,seconds:90,maxLevel:1}],buildings:[],publicBuildings:[]};
  const state={root:{},tab:'build',key:'',form:{plotId:ledger.plots[0].id,buildKind:'mill'},selectedPlot:ledger.plots[0].id,quoteForm:{},markers:[],markerKey:''};
  const plotSelect=new Element('select'),kindSelect=new Element('select'),detail=new Element(),commit=new Element('button');
  plotSelect.name='plotId';kindSelect.name='buildKind';plotSelect.value=state.form.plotId;kindSelect.value='mill';
  const host=new Element(),nodes={'rts-content':host,'rts-title':{},'rts-tabs':{querySelectorAll:()=>[]},'rts-markers':new Element(),'rts-routes':new Element(),'rts-stage':{getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:600,width:800,height:600})}};
  host.contains=node=>[plotSelect,kindSelect,detail,commit].includes(node);
  host.querySelector=selector=>({'[name="buildKind"]':kindSelect,'[name="plotId"]':plotSelect,'[data-rts-construction-detail]':detail,'[data-action="build"]':commit}[selector]||null);
  const document={activeElement:kindSelect,createElement:tag=>new Element(tag),createTextNode:value=>({nodeType:3,nodeValue:value,remove(){if(this.parentElement){const p=this.parentElement;p.children.splice(p.children.indexOf(this),1);this.parentElement=null;}}})};
  const camera=new THREE.PerspectiveCamera(55,800/600,.1,2000);camera.position.set(20,25,35);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const commands=[],notices=[],actions=[],blocked=new Map(),world=read('09_player.js');
  const scope=vm.createContext({THREE,document,camera,_proj:new THREE.Vector3(),view:{w:800,h:600},heightAt:(x,z)=>.02*x-.01*z,
    THRONE_RTS:{active:true},THRONE_RTS_UI:state,GAME:{player:{faction:1}},UI:{modal:'rts'},CWUI:{sel:null},WAR:{keeps:[],temples:[],warbands:[]},
    HALL:{sit:{H:{S:{name:'Test keep'}}}},REALMS:[{}, {name:'Test realm'}],$:id=>nodes[id],hallThroneGrant:()=>true,
    throneRtsView:()=>ledger,throneRtsNotice:text=>notices.push(text),REALM_RTS_SITE_CACHE:new Map(),realmRtsSiteStatus:p=>({eligible:!blocked.has(p.id),reason:blocked.get(p.id)||''}),
    realmRtsModelYaw:p=>p.yaw||0,realmRtsSiteGround:p=>({top:.02*p.x-.01*p.z+.06}),throneRtsCanonicalArmies:()=>[],
    wbLeader:()=>null,cwRoute:()=>null,cwIssue:(...x)=>actions.push(x),throneRtsFocusArmy:id=>actions.push(['focus',id]),netRealmManagementCommand:command=>commands.push(command)});
  const names=['throneRtsEscape','throneRtsNumber','throneRtsForm','throneRtsCost','throneRtsOptions','throneRtsConstructionChoice','throneRtsConstruction','throneRtsRenderPanel','throneRtsFormInput','throneRtsManage'];
  if(!baseline)names.push('throneRtsBuildReason','throneRtsConstructionDetail','throneRtsUpdateOptions','throneRtsRefreshConstruction','throneRtsSelectPlot','throneRtsMarkerAction','throneRtsCollectMarkers','throneRtsPick','throneRtsPlotPolygon','throneRtsPointInPolygon','throneRtsDrawMarkers');
  vm.runInContext(extract(world,'screenOf')+'\n'+names.map(name=>extract(baseline?oracle.sources['src/10q_throne_rts.js']:uiSource,name)).join('\n'),scope);
  scope.throneRtsRenderPanel(true);
  const choice=scope.throneRtsConstructionChoice(ledger);
  plotSelect.innerHTML=scope.throneRtsOptions(choice.plots.map(p=>[p.id,p.name||p.site||p.id]),choice.chosen);
  kindSelect.innerHTML=scope.throneRtsOptions((choice.catalog||ledger.catalog).map(item=>[item.id,item.label||item.id]),choice.kind);
  if(!baseline)detail.innerHTML=scope.throneRtsConstructionDetail(choice);
  return {scope,ledger,state,nodes,document,plotSelect,kindSelect,detail,commit,commands,notices,actions,blocked,
    change(name,value){const target=name==='plotId'?plotSelect:kindSelect;target.value=value;document.activeElement=target;scope.throneRtsFormInput({type:'change',target});},
    screen:(x,z)=>scope.screenOf(x,scope.heightAt(x,z)+.06,z)};
}

export function walkFixture({yaw=0,progress=1,height=(x,z)=>.1*x+.08*z}={}) {
  const model=modelSource,world=read('01_world.js'),floor=read('04g_castles.js'),build=read('06k_build.js');
  const scene=new THREE.Scene(),b={id:'post',plotId:'keep:0:0',kind:'watchpost',x:30,z:40,owner:1,home:1,yaw,level:1,status:progress<1?'building':'built',progress};
  const context=vm.createContext({THREE,scene,GAME:{started:true,player:{faction:1}},NETS:{s:{management:{publicPlots:[],publicBuildings:[b]}}},
    W:{H:new Float32Array(1)},A2FL:{ground:0},HALF:512,UI:{modal:null},THRONE_RTS:{active:false},THRONE_RTS_UI:{tab:'realm',form:{},selectedPlot:''},
    camera:new THREE.PerspectiveCamera(),U:{uNight:{value:0}},GLSL_COMMON:'',GLSL_ATMOS:'',GLSL_SHADOW:'',GLSL_PLIGHT:'',GLSL_LIGHT:'',GLSL_WEATHER:'',GLSL_SEASON:'',
    mat:options=>new THREE.ShaderMaterial({...options,uniforms:{uNight:context.U.uNight}}),heightAt:(x,z)=>height(x,z),
    hallThroneGrant:()=>true,realmRtsSiteStatus:()=>({eligible:true}),realmRtsSiteFrame:row=>({yaw:row.yaw||0}),
    realmRtsSiteGround:row=>{let min=Infinity,max=-Infinity;const c=Math.cos(row.yaw||0),s=Math.sin(row.yaw||0);for(let x=-6;x<=6;x++)for(let z=-6;z<=6;z++){const y=height(row.x+x*c+z*s,row.z-x*s+z*c);min=Math.min(min,y);max=Math.max(max,y);}return{min,max,top:max+.06,bottom:min-.12};},
    COLL:{boxes:[],circles:[],grid:new Map(),cell:16},COVER:{built:false},DUN_X0:10000,SICE:{on:false},clamp:(v,a,z)=>Math.max(a,Math.min(z,v)),
    realmRtsSitesClear(){},coverMarkBox(){},buildCoverMask(){}});
  const collisions=['collKey','collRegister','addBox','collidersNear','resolveCollisions'].map(name=>extract(world,name)).join('\n');
  const floors=floor.slice(floor.indexOf('const FLOOR ='),floor.indexOf('const elevatedEnt'));
  vm.runInContext(collisions+'\nlet _collQ=0;const _cn=[];\n'+floors+'\n'+extract(build,'bCollRemove')+'\n'+extract(build,'bFloorRemove')+'\n'+model+'\nthis.state=REALM_RTS_MODELS;this.floors=FLOOR;',context);
  context.realmRtsModelsFrame(.1);
  const at=(x,z)=>({x:b.x+x*Math.cos(yaw)+z*Math.sin(yaw),z:b.z-x*Math.sin(yaw)+z*Math.cos(yaw)});
  return {context,state:context.state,b,scene,at,frame:()=>{context.realmRtsModelsFrame(.1);context.realmRtsModelsFrame(.1);context.realmRtsModelsFrame(.1);},clear:()=>context.realmRtsModelsClear(),
    walk(localFrom,localTo,initialY){const samples=[],start=at(0,localFrom);let y=initialY??context.heightAt(start.x,start.z);const n=Math.ceil(Math.abs(localTo-localFrom)/.04);
      for(let i=0;i<=n;i++){const local=localFrom+(localTo-localFrom)*i/n,p=at(0,local),want={...p};context.resolveCollisions(p,.35,y,1);const next=context.floorAt(p.x,p.z,y);samples.push({local,want,p,y,next});y=next;}return samples;}};
}
