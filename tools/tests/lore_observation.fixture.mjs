import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
const read=n=>readFileSync(new URL('../../src/'+n,import.meta.url),'utf8');
const pick=(file,names)=>{const s=read(file);return parse(s,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)||n.type==='VariableDeclaration'&&n.declarations.some(d=>names.includes(d.id.name))).map(n=>s.slice(n.start,n.end)).join('\n');};
const playerSource=read('09_player.js');
const keydown=parse(playerSource,{ecmaVersion:'latest'}).body.find(n=>n.type==='ExpressionStatement'&&n.expression.callee?.object?.name==='window'&&n.expression.callee?.property?.name==='addEventListener'&&n.expression.arguments[0]?.value==='keydown').expression.arguments[1];
const code=pick('09_player.js',['currentInteraction','playerInteract','bountyCampInfo','chooseBounty','typing','gameplayKeyIgnored','gameplayControlKey'])+'\n'
 +pick('10e_guide.js',['guideCampResidents'])+'\n'+pick('10_ui.js',['bindHUD','dialogReturnFocus','openHerald','closeDialog'])+'\n'
 +pick('10c_lore.js',['LORE_OBSERVATIONS','loreObservationScope','loreObservationCurrent','loreObservationEvidence','loreObserve','PATH_STEPS','PATH_BY_ID','pathDone','pathPay','pathComplete','loreWatch','updateLore'])+'\n'
 +pick('14m_liveplay.js',['NET_HUMAN_PLAY_MS','NET_HUMAN_START_MS','NET_HUMAN_PLAY','netHumanEligible','netHumanLive','netHumanInput','netHumanSync'])
 +'\nglobalThis.keydown='+playerSource.slice(keydown.start,keydown.end)+';';
// CPU stand-in exercises actual dispatch/lease code; browser trust is verified by
// the separate native first-session journey, never manufactured in a real page.
export class InputEvent {
 constructor(type='keydown',options={}){Object.assign(this,{type,isTrusted:true,eventPhase:0,code:'KeyE',repeat:false},options);}
}
export function fixture(){
 let clock=0;const nodes=new Map(),events=[],tasks=[],timers=new Map();let timer=0,publishes=0;
 const node=id=>{if(!nodes.has(id)){const n={id,hidden:false,textContent:'',children:[],style:{},isConnected:true,disabled:false,
  classList:{add(){},remove(){},contains(){return false;}},get childNodes(){return this.children;},
  listeners:new Map(),addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},
  set innerHTML(v){this.html=v;this.children=[];},get innerHTML(){return this.html||'';},appendChild(v){this.children.push(v);v.parent=this;},
  removeChild(v){this.children.splice(this.children.indexOf(v),1);},remove(){},
  closest(selector){return selector==='button'?this:selector==='[data-buyp]'?this.dataset?.buyp?this:null:selector==='#prompt, #t-use'&&['prompt','t-use'].includes(this.id)?this:null;},
  contains(value){return value===this||value.parent===this;},getClientRects(){return[1];},focus(){}};nodes.set(id,n);}return nodes.get(id);};
 const player={id:1,name:'Fast path fixture',alive:true,faction:0,cls:'warrior',x:0,y:0,z:0,carrying:null,hp:100,maxHp:100,combatUntil:-1};
 const herald={id:3,name:'Fixture Herald',x:0,z:1},mob={id:2,alive:true,level:1,mobType:'wolf',name:'wolf',camp:0};
 const LORE={ev:{},watchT:.25,bounty:null,potions:3,carried:null,doors:new Map(),elites:new Set(),loot:new Set(),queue:[],mwNames:new Set(),keepRealm:[],campN:0,hudT:.3,placeT:.25,noteUntil:Infinity};
 const c={console,Map,Set,Object,Array,Math,Number,performance:{now:()=>clock},LORE,UI:{modal:null},CAPTURE:{on:false},
  GAME:{started:true,ready:true,t:0,player,prog:{level:1,xp:0,rp:0,bounty:null,lore:{done:[],seen:['loot']}}},
  REALMS:[{name:'Fixture',townName:'Fixture Town',herald,merchant:null,town:{x:100,z:100},musterSite:{x:200,z:200,r:10}}],
  NETWS:{host:'fixture',acct:{id:'owner'},worldReloadRequired:false},NATIVE_PLAYER:{profile:{}},SAVE:{ref:{},lsKey:'fixture',native:false,wiping:false},Event:InputEvent,
  document:{hidden:false,hasFocus:()=>true,body:{},createElement:()=>node('element-'+nodes.size)},$ :node,
  INV:{potions:3,gold:100},INPUT:{keys:new Set()},POTION:{max:10},LEVEL_CAP:50,MOBS:{wolf:{names:['wolf']}},MOB_PLURAL:{wolf:'wolves'},CAMPS:[{id:0,type:'wolf',realm:0,members:[2]}],
  getEnt:id=>id===2?mob:id===3?herald:null,dist:(x,z,a,b)=>Math.hypot(x-a,z-b),dist2:(x,z,a,b)=>(x-a)**2+(z-b)**2,
  xpToNext:()=>100,fmtInt:String,pluralName:value=>value==='wolf'?'wolves':value,esc:String,
  clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),sfx(){},uiToast(){},uiLog(){},saveSoon(){},iconSvg:()=>'',
  queueMicrotask:fn=>tasks.push(fn),setTimeout(fn,ms){const id=++timer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),netHumanPublish(){publishes++;},
  activityRecord:(...args)=>events.push(args),addGold(){throw Error('No gold expected');},late2HeraldBounty:()=>null,late3HeraldText:()=>'',seasonWarText:()=>'',
  WAR:{relics:[],keeps:[],temples:[],warbands:[]},BARROW:{door:null},inDungeon:()=>false,LOOT:[],GUIDE:{made:[]},
  GIFT:{lastCast:null},DRAGON:{e:null},RECIPES:[],kitItems:()=>[],CAMPAIGN:{history:[],claims:[]},CWUI:{vicShown:false},
  WEATHER:{raining:0,snowing:0},R_RING:0,towerRoomOf:()=>null,cwCanCommand:()=>false,guideWatch(){},
  showNextNote(){},updateGuide(){},renderPathHud(){},placePathHud(){},mobileBind(){},HUDL:{k:0},
 };
 for(const name of['houseOffers','wearOffers','natureOffers','brandOffers','siegeOffers','waterOffers','hallOffers','buildOffers','survivalOffers','farmOffers','animalOffers','depthOffers','towerOffers','late2Offers','loopsOffers'])c[name]=()=>{};
 vm.createContext(c);vm.runInContext(code+'\nglobalThis.human=NET_HUMAN_PLAY;',c);c.bindHUD();node('dialog').hidden=true;
 const microtasks=()=>{while(tasks.length)tasks.shift()();};
 const dispatch=(event,fn,{input=true}={})=>{event.eventPhase=3;try{if(input)c.netHumanInput(event);fn(event);}finally{event.eventPhase=0;}microtasks();};
 return{c,nodes,events,node,microtasks,dispatch,get publishes(){return publishes;},
  interact(options){const event=new InputEvent('keydown',{target:node('body')});dispatch(event,e=>c.keydown(e),options);return event;},
  use(id){const event=new InputEvent('click',{target:node(id)});dispatch(event,e=>id==='prompt'?node(id).onclick(e):node('tpad').listeners.get('click').forEach(fn=>fn(e)));return event;},
  click(label){const button=nodes.get('dlg-actions').children.find(b=>b.textContent===label);if(!button)throw Error('Missing actual dialog action '+label);dispatch(new InputEvent('click',{target:button}),()=>button.onclick());},
  advance(dt){clock+=dt*1000;if(c.netHumanLive())c.updateLore(dt);},snapshot(){return{modal:c.UI.modal,event:LORE.ev.herald??false,done:[...c.GAME.prog.lore.done],potions:c.INV.potions,bounty:!!c.GAME.prog.bounty,activity:events.map(e=>[e[0],e[1]])};}};
}
