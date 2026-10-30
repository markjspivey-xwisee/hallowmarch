import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'acorn';

const read=name=>readFileSync(new URL('../../src/'+name,import.meta.url),'utf8');
const ui=read('10_ui.js'),main=read('13_main.js'),lore=read('10c_lore.js'),render=read('02_render.js');
function actual(source,names){return parse(source,{ecmaVersion:'latest'}).body.filter(node=>
  node.type==='FunctionDeclaration'&&names.includes(node.id.name)
  ||node.type==='VariableDeclaration'&&node.declarations.some(d=>names.includes(d.id.name)))
  .map(node=>source.slice(node.start,node.end)).join('\n');}
const presentation=actual(ui,['ENTRY_FEEDBACK','entryFeedbackScope','entryFeedbackCurrent','entryFeedbackCancel',
  'entryFeedbackSync','entryFeedbackPrepare','entryFeedbackLeavePrologue','entryFeedbackBeforeFrame','entryFeedbackComplete']);
function eventTarget(extra={}){return Object.assign({listeners:new Map(),addEventListener(type,fn){
  if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(fn);},
  emit(type){for(const fn of this.listeners.get(type)||[])fn({type});}},extra);}

function fixture({prologue=false,native=false}={}){
  let now=100,focused=true;const calls={cold:[],frames:[],errors:[],saves:0,notes:[],created:0},timers=new Map(),microtasks=[];
  const node=(id,hidden=false)=>({id,hidden,isConnected:true,inert:false,innerHTML:'',querySelector:()=>null,
    focus(){throw Error('Entry feedback must not move focus');}});
  const nodes=Object.fromEntries(['entry-feedback','title','menu','menu-tabs','lore-pro','hud'].map(id=>[id,node(id,id!=='hud')]));
  const document=eventTarget({hidden:false,hasFocus:()=>focused,getElementById:id=>nodes[id]||null,activeElement:null,
    querySelectorAll:()=>Object.values(nodes),body:{children:Object.values(nodes)}});
  const window=eventTarget(),canvas=eventTarget();
  const P={x:0,y:0,z:0,name:'Earned name',level:1,cls:'warrior',faction:0,alive:true},prog={level:1,xp:40,rp:0,lore:{pro:0,seen:['farmers'],done:['herald']}};
  const c=vm.createContext({console,document,window,canvas,performance:{now:()=>now},
    setTimeout:(fn,ms)=>{const id=timers.size+1;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    queueMicrotask:fn=>microtasks.push(fn),
    GAME:{ready:true,started:true,player:P,prog,t:0,hitStop:0},UI:{modal:prologue?'prologue':null},
    NETWS:{host:'local',acct:{id:'owner'},reload:false,worldReloadRequired:false},NET:{},netOn:()=>false,
    NATIVE_PLAYER:{profile:{},status:{verified:true},switching:false},SAVE:{ref:{},lsKey:'owner',native,readConfirmed:true,chain:Promise.resolve()},
    GRAPHICS_CONTEXT_LOST:false,GRAPHICS_STARTUP:{stopped:false},$:(id)=>nodes[id],
    renderer:{info:{reset:()=>calls.cold.push('reset')},setRenderTarget:()=>calls.cold.push('target'),
      setClearColor(){},clear(){},render:()=>calls.cold.push('render')},
    captureDt:dt=>dt,renderTime:0,U:{uTime:{value:0},uCamFocus:{value:{set(){}}}},
    tod:{mode:'fixed',fixedP:0,p:0},TOD_TARGET:{},INDOOR:{on:false},SHADOW:{rt:null},
    camera:{position:{x:0,y:10,z:0},projectionMatrix:{},matrixWorldInverse:{},updateMatrixWorld(){},getWorldDirection(){}},
    CAM:{mode:'play'},projView:{multiplyMatrices(){}},frustum:{setFromProjectionMatrix(){}},
    skyU:{uInvVP:{value:{copy:()=>({invert(){}})}}},W:{heroTree:{x:0,z:0}},
    fxAdd:{flush(){}},fxAlpha:{flush(){}},treeCamX:0,treeCamZ:0,treeTick:15,_fwd:{x:0,z:1},
    dist2:(x,z,a,b)=>(x-a)**2+(z-b)**2,sceneRT:{},scene:{},composite:{uniforms:{uTime:{value:0},uFlash:{value:{w:0}}}},REDUCE_MOTION:false,
    lastNow:100,requestAnimationFrame:fn=>{calls.frames.push(fn);return calls.frames.length;},reportError:error=>calls.errors.push(error),
    saveNow:()=>{calls.saves++;return Promise.resolve();},saveSoon:()=>calls.saves++,LORE:{pro:prologue?{replay:false}:null},loreNote:id=>calls.notes.push(id),
    resizeTimer:0,TITLE_FRAME_PROMISE:null,TITLE_START_PROMISE:null,INPUT:{keys:new Set(),joy:null},INV:{potions:3,gold:10},
    createPlayer:()=>{calls.created++;c.GAME.player={...P};c.GAME.prog=prog;return c.GAME.player;},
    savePartsLoad(){},rescaleWar(){},buildHUD(){},uiLog(){},zoneAt:()=>({name:'Home'}),
    realmRank:()=>1,CLASSES:{warrior:{name:'Warrior'}},
    sfx(){},loreOnStart:save=>{c.UI.modal=save.fresh?'prologue':null;c.LORE.pro=save.fresh?{replay:false}:null;},
    giftsOnStart(){},buildOnStart(){},survivalOnStart(){},depthOnStart(){},
    renderMenu(){},menuReturnFocus:null,
  });
  const noopNames=['throneRtsGuard','applyTimeOfDay','updateWeather','seasonsFrame','applyWeather','applyIndoor',
    'updateNightSky','wxCloudsFrame','netPump','updateCamera','captureCamera','wxCloudsScreen','drawActors','drawDragon',
    'drawBrand','drawTargetAndMarks','drawRelicsAndPortals','drawTownLife','drawHouses','drawFires','drawNature','drawGifts',
    'drawWater','drawHall','drawBuild','drawClasses','look5Frame','drawLate4','loopsDraw','look6Frame','drawFarming',
    'drawAnimals','drawDepth','updateAmbientLife','drawSurvival','drawProjectiles','drawWalls','updateSpellFX','drawLoot',
    'renderDecals','stepTrail','updateGrassCenters','updateTreeVisibility','updateNearTrees','updateFireflies','updateLod',
    'updateMountains','gatherLights','arrowFlush','glowFlush','regroupOutdoors','renderPost','updateHUD','updateLore',
    'classHUD','netUiFrame','hudLayout','updateAudio','adaptQuality'];
  for(const name of noopNames)c[name]=()=>calls.cold.push(name);
  c.simStep=dt=>{calls.cold.push('simStep');c.GAME.t+=dt;};
  window.__hm={UI:c.UI};
  vm.runInContext(presentation+'\n'+read('14m_liveplay.js')+'\n'+actual(main,['startGame','tick','frame'])+'\n'
    +actual(lore,['closePrologue'])+'\n'+actual(ui,['openMenu'])+'\n'+actual(render,['graphicsFailureTakeover'])
    +'\nglobalThis.feedback=()=>ENTRY_FEEDBACK;globalThis.human=NET_HUMAN_PLAY;',c);
  const flush=()=>{while(microtasks.length)microtasks.shift()();};
  return {c,calls,nodes,document,window,canvas,timers,
    get now(){return now;},set now(value){now=value;},set focused(value){focused=value;},
    flush,input(trusted=true){c.netHumanInput({type:'click',isTrusted:trusted});flush();},
    prepare(){c.entryFeedbackPrepare();},frame(){now+=16.7;c.frame(now);},
    clearCold(){calls.cold.length=0;},snapshot(){return JSON.stringify({prog:c.GAME.prog,activity:c.human.activity,pending:c.human.pendingAt,accepted:c.human.acceptedAt});}};
}

test('returning entry yields exactly one ordinary callback then renders normally without renewing activity',()=>{
  const f=fixture();f.input();f.prepare();const before=f.snapshot();f.frame();
  assert.equal(f.nodes['entry-feedback'].hidden,false);assert.equal(f.c.feedback().phase,'paint');
  assert.equal(f.c.GAME.t,0);assert(!f.calls.cold.includes('reset'));assert.equal(f.calls.frames.length,1);
  const accepted=f.c.human.acceptedAt;f.frame();
  assert(f.calls.cold.includes('simStep')&&f.calls.cold.includes('render')&&f.calls.cold.includes('updateAudio'));
  assert.equal(f.c.feedback(),null);assert.equal(f.nodes['entry-feedback'].hidden,true);
  assert.equal(f.c.human.activity,1);assert.equal(f.c.human.acceptedAt,accepted);
  assert.equal(f.snapshot(),before,'Presentation changes no earned facts or accepted-input time');
  f.clearCold();f.frame();assert(f.calls.cold.includes('render'),'Later frames are not gated again');
});

test('fresh prologue waits for its real nonreplay close, preserving seen/save/note effects',()=>{
  const f=fixture({prologue:true});f.prepare();f.input();f.frame();
  assert.equal(f.c.feedback().phase,'prologue');assert.equal(f.nodes['entry-feedback'].hidden,true);
  const seen=JSON.stringify(f.c.GAME.prog.lore.seen),done=JSON.stringify(f.c.GAME.prog.lore.done);
  f.c.netHumanInput({type:'click',isTrusted:true});f.c.closePrologue();f.flush();
  assert.equal(f.c.GAME.prog.lore.pro,1);assert.equal(f.calls.saves,1);assert.deepEqual(f.calls.notes,['start']);
  f.frame();assert.equal(f.nodes['entry-feedback'].hidden,false);f.frame();
  assert.equal(f.c.feedback(),null);assert.equal(JSON.stringify(f.c.GAME.prog.lore.seen),seen);
  assert.equal(JSON.stringify(f.c.GAME.prog.lore.done),done);assert.equal(f.c.human.activity,2);
});

test('replay and null prologue closes cannot create or reactivate entry presentation',()=>{
  for(const pro of [null,{replay:true}]){
    const f=fixture();f.c.LORE.pro=pro;f.c.UI.modal=pro?'prologue':null;f.c.closePrologue();
    assert.equal(f.c.feedback(),null);assert.equal(f.nodes['entry-feedback'].hidden,true);
  }
});

test('the original five-second pending input bridge still expires without presentation, input or a trapped veil',()=>{
  const f=fixture();f.c.GAME.started=false;f.input();f.now+=5001;f.c.GAME.started=true;f.prepare();f.frame();
  assert.equal(f.c.human.pendingAt,null);assert.equal(f.c.human.acceptedAt,null);assert.equal(f.c.human.activity,1);
  assert.equal(f.c.feedback(),null);assert.equal(f.nodes['entry-feedback'].hidden,true);assert(!f.calls.cold.includes('render'));
  f.input();f.frame();assert(f.calls.cold.includes('render'),'Only a new actual input resumes the original game');
});

test('pending input inside the original bridge can paint once; untrusted input cannot activate anything',()=>{
  const f=fixture();f.c.GAME.started=false;f.input();f.now+=4900;f.c.GAME.started=true;f.prepare();f.frame();
  assert.equal(f.c.human.acceptedAt,100);assert.equal(f.nodes['entry-feedback'].hidden,false);
  const untrusted=fixture();untrusted.input(false);untrusted.prepare();untrusted.frame();
  assert.equal(untrusted.c.human.activity,0);assert.equal(untrusted.c.feedback(),null);assert(untrusted.nodes['entry-feedback'].hidden);
});

test('same-owner repeated preparation coalesces without restarting a painted status or adding listeners',()=>{
  const f=fixture();f.input();f.prepare();const record=f.c.feedback();f.frame();
  f.prepare();assert.equal(f.c.feedback(),record);assert.equal(record.phase,'paint');
  assert.equal(f.canvas.listeners.get('webglcontextlost').length,1);assert.equal(f.window.listeners.get('pagehide').length,2);
  f.frame();assert.equal(f.c.feedback(),null);
});

test('owner/player/save replacement and revoked native confirmation cancel before any cold work',()=>{
  const changes=[f=>f.c.NETWS.acct.id='other',f=>f.c.NETWS.host='other',f=>f.c.NATIVE_PLAYER.profile={},
    f=>f.c.SAVE.ref={},f=>f.c.SAVE.lsKey='other',f=>f.c.GAME.player={...f.c.GAME.player},f=>f.c.GAME.prog={...f.c.GAME.prog},
    f=>f.c.NATIVE_PLAYER.status.verified=false,f=>f.c.NATIVE_PLAYER.switching=true];
  for(const change of changes){const f=fixture({native:true});f.input();f.prepare();f.frame();change(f);
    f.c.entryFeedbackSync();assert.equal(f.c.feedback(),null);assert.equal(f.nodes['entry-feedback'].hidden,true);}
});

test('menu/modal, blur, hidden page, pagehide and context loss clear the status without focus or input changes',()=>{
  for(const cancel of [f=>f.c.openMenu(),f=>{f.c.UI.modal='dialog';f.c.entryFeedbackSync();},
    f=>f.window.emit('blur'),f=>{f.document.hidden=true;f.document.emit('visibilitychange');},
    f=>f.window.emit('pagehide'),f=>f.canvas.emit('webglcontextlost')]){
    const f=fixture();f.input();f.prepare();f.frame();const activity=f.c.human.activity;cancel(f);
    assert.equal(f.c.feedback(),null);assert.equal(f.nodes['entry-feedback'].hidden,true);assert.equal(f.c.human.activity,activity);
  }
});

test('graphics stopped and a real tick error clear presentation while preserving original error handling',()=>{
  const stopped=fixture();stopped.input();stopped.prepare();stopped.frame();stopped.c.GRAPHICS_STARTUP.stopped=true;stopped.frame();
  assert.equal(stopped.c.feedback(),null);assert.equal(stopped.calls.frames.length,1);
  const f=fixture(),original=Error('Original cold tick failure');f.input();f.prepare();f.frame();f.c.seasonsFrame=()=>{throw original;};f.frame();
  assert.equal(f.nodes['entry-feedback'].hidden,true);assert.equal(f.c.feedback(),null);assert.equal(f.calls.errors[0],original);
  const takeover=fixture();takeover.input();takeover.prepare();takeover.frame();const notice={hidden:true,inert:true};
  takeover.c.graphicsFailureTakeover(notice);assert.equal(takeover.c.feedback(),null);assert.equal(notice.hidden,false);assert.equal(notice.inert,false);
});

test('missing or replaced presentation DOM never skips an otherwise live frame or touches a replacement owner',()=>{
  const missing=fixture();delete missing.nodes['entry-feedback'];missing.input();missing.prepare();missing.frame();
  assert.equal(missing.c.feedback(),null);assert(missing.calls.cold.includes('render'));
  const f=fixture();f.input();f.prepare();f.frame();const old=f.nodes['entry-feedback'];
  f.nodes['entry-feedback']={hidden:true,isConnected:true};f.c.entryFeedbackSync();
  assert.equal(f.c.feedback(),null);assert.equal(old.hidden,true);assert.equal(f.nodes['entry-feedback'].hidden,true);
});

test('actual startGame preserves title-resize coalescing and waits until original ownership admits the start',async()=>{
  const f=fixture();f.c.GAME.started=false;let resolve;f.c.TITLE_FRAME_PROMISE=new Promise(r=>{resolve=r;});
  const save={fresh:false,gold:10,cls:'warrior'},a=f.c.startGame(save),b=f.c.startGame(save);
  assert.equal(a,b);assert.equal(f.calls.created,0);assert.equal(f.c.feedback(),null);
  f.c.TITLE_FRAME_PROMISE=null;resolve();await a;assert.equal(f.calls.created,1);assert.equal(f.c.feedback().phase,'pending');
  const refused=fixture();refused.c.GAME.started=false;refused.c.startGame(save,()=>false);
  assert.equal(refused.calls.created,0);assert.equal(refused.c.feedback(),null);
  const fresh=fixture();fresh.c.GAME.started=false;fresh.c.startGame({fresh:true,cls:'warrior'});
  assert.equal(fresh.c.feedback().phase,'prologue');assert.equal(fresh.nodes['entry-feedback'].hidden,true);
});

test('original live-guard source, accessible nonmodal markup and reduced-motion path remain explicit',()=>{
  assert.equal(createHash('sha256').update(read('14m_liveplay.js')).digest('hex'),'0513a8d76d14c09862d40ad288825b5801f21b311786dd120d103de2a283541b');
  assert(!/netHumanInput|netHumanSync|NET_HUMAN_PLAY|setTimeout|requestAnimationFrame|Math\.random|new THREE|saveSoon|saveNow/.test(presentation));
  const html=read('page.html'),element=html.match(/<div id="entry-feedback"[^\n]+/)[0];
  assert.match(element,/role="status" aria-live="polite" aria-atomic="true" hidden/);
  assert.match(element,/Entering Hallowmarch…/);assert(!/button|tabindex|progressbar/.test(element));
  assert.match(html,/#entry-feedback \{[^}]*pointer-events: none/);
  assert.match(html,/:root\[data-reduced-motion="true"\] #entry-feedback i \{ animation: none !important/);
  assert.match(html,/@media \(prefers-reduced-motion: reduce\) \{ #entry-feedback i \{ animation: none/);
});
