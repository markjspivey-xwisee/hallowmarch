import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';

const source=readFileSync(new URL('../../src/12_save.js',import.meta.url),'utf8');
const nodes=parse(source,{ecmaVersion:'latest'}).body;
const declarations=names=>names.map(name=>{
  const node=nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name));
  assert(node,name);return source.slice(node.start,node.end);
}).join('\n');
const functions=declarations(['SAVE_MENU_REQUESTS','saveSoon','saveMenuEditOwned','saveMenuEdit','nativeSavePending','saveNow']);
const freshSave=()=>({v:1,char:{v:1,name:'Local reviewer',realm:0,cls:'warrior',level:1,xp:0,lore:{track:'cook'}},settings:{quality:'low'}});
const base=()=>({ref:null,backend:'local',lsKey:'hallowmarch.save.v1',timer:0,chain:Promise.resolve(),lastBody:'',lastCore:'',loaded:null,
  wiping:false,native:false,pending:null,readConfirmed:false,nativeFlight:null,nativePaused:false,nativeFinal:null,loading:null,guestWriteAt:0,guestTimer:0});
class MenuEvent {
  constructor(type='click',trusted=true,target){this.type=type;this.isTrusted=trusted;this.target=target;}
}
function fixture({native=false,queued=false,fail=false}={}) {
  let now=1000,release,releaseWrite,holdWrite=false;
  const calls=[],local=new Map(),timers=new Map();let timer=0;
  const button={disabled:false,hidden:false,inert:false,visible:true,inside:true,
    closest(selector){return selector.startsWith('button')?this:this.hidden||this.inert?this:null;},getClientRects(){return this.visible?[1]:[];}};
  const doc={hidden:false,focused:true,hasFocus(){return this.focused;},getElementById:()=>({contains:node=>node.inside})};
  const ref={set:async(value,options)=>{calls.push({value:structuredClone(value),options});if(holdWrite)await new Promise(resolve=>{releaseWrite=resolve;});if(fail)throw {code:typeof fail==='string'?fail:'unavailable'};}};
  const SAVE={...base(),native,readConfirmed:native,ref:native?ref:null,chain:queued?new Promise(resolve=>{release=resolve;}):Promise.resolve()};
  const NATIVE_PLAYER={profile:native?{}:null,status:{verified:native},state:'ready'};
  const c=vm.createContext({SAVE,NATIVE_PLAYER,GAME:{started:true,ready:true,player:{}},UI:{modal:'menu'},CAPTURE:{on:false},
    NETWS:{host:'fixture',acct:{id:'owner'},reload:false},Event:MenuEvent,document:doc,
    performance:{now:()=>now},Date:{now:()=>now},Promise,JSON,Math,
    setTimeout(fn){const id=++timer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    buildSave:freshSave,coreKey:s=>JSON.stringify(s.char),netHumanLive:()=>false,nativePlayerIsProvisional:()=>false,
    nativePlayerRender(){},nativePlayerError:code=>Object.assign(Error(code),{code}),
    localStorage:{getItem:key=>local.get(key)||null,setItem:(key,value)=>local.set(key,value)}});
  vm.runInContext(functions+'\nglobalThis.H={saveMenuEdit,saveNow,saveSoon,nativeSavePending};',c);
  return {c,SAVE,button,doc,ref,calls,local,timers,event:(type='click',trusted=true)=>new MenuEvent(type,trusted,button),
    edit:event=>c.H.saveMenuEdit(event||new MenuEvent('click',true,button)),advance:ms=>{now+=ms;},release:()=>release(),
    hold:()=>{holdWrite=true;},releaseWrite:()=>{holdWrite=false;releaseWrite();},async drain(){for(let n=0;n<12;n++)await Promise.resolve();}};
}

test('one trusted visible menu edit persists locally while ordinary paused saves remain paused',async()=>{
  const f=fixture();f.c.H.saveSoon();assert.equal(f.timers.size,0);
  await f.edit();assert.equal(JSON.parse(f.local.get(f.SAVE.lsKey)).char.lore.track,'cook');
  assert.equal(f.c.netHumanLive(),false);assert.equal(f.c.UI.modal,'menu');assert.equal(f.timers.size,0);
});

test('only genuine trusted edit events on enabled visible menu controls receive a checkpoint',async()=>{
  for(const condition of ['fake','untrusted','wrong-event','disabled','hidden','inert','invisible','outside','document-hidden','unfocused','other-modal','not-started','not-ready','wiping','capture']) {
    const f=fixture();let event=f.event();
    if(condition==='fake')event={type:'click',isTrusted:true,target:f.button};
    if(condition==='untrusted')event=f.event('click',false);
    if(condition==='wrong-event')event=f.event('pointermove');
    if(condition==='disabled')f.button.disabled=true;
    if(condition==='hidden')f.button.hidden=true;
    if(condition==='inert')f.button.inert=true;
    if(condition==='invisible')f.button.visible=false;
    if(condition==='outside')f.button.inside=false;
    if(condition==='document-hidden')f.doc.hidden=true;
    if(condition==='unfocused')f.doc.focused=false;
    if(condition==='other-modal')f.c.UI.modal=null;
    if(condition==='not-started')f.c.GAME.started=false;
    if(condition==='not-ready')f.c.GAME.ready=false;
    if(condition==='wiping')f.SAVE.wiping=true;
    if(condition==='capture')f.c.CAPTURE.on=true;
    await f.edit(event);assert.equal(f.local.size,0,condition);assert.equal(f.calls.length,0,condition);
  }
  for(const type of ['input','change']) {const f=fixture();await f.edit(f.event(type));assert.equal(f.local.size,1,type);}
});

test('queued menu snapshots cannot follow player, reference, identity, pause, or expiry changes',async()=>{
  for(const native of [false,true])for(const condition of ['player','ref','null-ref','key','host','account','profile','switching','paused','expired','wiping','reload']) {
    const f=fixture({native,queued:true});if(condition==='null-ref')f.SAVE.ref=f.ref;const pending=f.edit();
    if(condition==='player')f.c.GAME.player={};
    if(condition==='ref')f.SAVE.ref={set:async()=>assert.fail('Wrong reference')};
    if(condition==='null-ref')f.SAVE.ref=null;
    if(condition==='key')f.SAVE.lsKey='another-character';
    if(condition==='host')f.c.NETWS.host='other';
    if(condition==='account')f.c.NETWS.acct.id='other';
    if(condition==='profile')f.c.NATIVE_PLAYER.profile={};
    if(condition==='switching')f.c.NATIVE_PLAYER.switching=true;
    if(condition==='paused')f.SAVE.nativePaused=true;
    if(condition==='expired')f.advance(10001);
    if(condition==='wiping')f.SAVE.wiping=true;
    if(condition==='reload')f.c.NETWS.reload=true;
    f.release();await pending;await f.drain();
    assert.equal(f.calls.length,0,native+':'+condition);assert.equal(f.local.size,0,native+':'+condition);
    if(native)assert.equal(f.SAVE.pending.char.lore.track,'cook','An unconfirmed native body stays pending.');
  }
});

test('an expired local request cannot mark its unsaved body as confirmed or suppress a fresh edit',async()=>{
  const f=fixture({queued:true});const pending=f.edit();f.advance(10001);f.release();await pending;
  assert.equal(f.local.size,0);assert.equal(f.SAVE.lastBody,'');
  await f.edit();assert.equal(f.local.size,1);assert.equal(JSON.parse(f.SAVE.lastBody).char.lore.track,'cook');
});

test('unconfirmed, paused, blocked, or switching native owners cannot create explicit menu requests',async()=>{
  for(const condition of ['unconfirmed','unverified','no-profile','blocked','paused','switching','claim','opening','busy']) {
    const f=fixture({native:true});
    if(condition==='unconfirmed')f.SAVE.readConfirmed=false;
    if(condition==='unverified')f.c.NATIVE_PLAYER.status.verified=false;
    if(condition==='no-profile')f.c.NATIVE_PLAYER.profile=null;
    if(condition==='blocked')f.SAVE.ref.blocked=true;
    if(condition==='paused')f.SAVE.nativePaused=true;
    if(condition==='switching')f.c.NATIVE_PLAYER.switching=true;
    if(condition==='claim')f.c.NATIVE_PLAYER.claimConfirmationPending=true;
    if(condition==='opening')f.c.NATIVE_PLAYER.openExistingPending=true;
    if(condition==='busy')f.c.NATIVE_PLAYER.busy=true;
    await f.edit();assert.equal(f.calls.length,0,condition);assert.equal(f.local.size,0,condition);assert.equal(f.SAVE.pending,null,condition);
  }
});

test('a failed native menu save stays private and pending without any local fallback or idle retry',async()=>{
  const f=fixture({native:true,fail:true});await f.edit();await f.drain();
  assert.equal(f.calls.length,1);assert.equal(f.SAVE.pending.char.lore.track,'cook');assert.equal(f.local.size,0);
  assert.equal(f.SAVE.lastBody,'');assert.equal(f.timers.size,0);assert.equal(f.c.NATIVE_PLAYER.state,'unavailable');
});

test('the actual confirmed provisional session reference can save a trusted menu edit without weakening verification',async()=>{
  const f=fixture({native:true}),native=readFileSync(new URL('../../src/14v_nativeidentity.js',import.meta.url),'utf8');
  const ast=parse(native,{ecmaVersion:'latest'}).body;
  const actual=names=>names.map(name=>{const node=ast.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);assert(node,name);return native.slice(node.start,node.end);}).join('\n');
  const session={status:()=>({provisional:true}),profile:()=>f.c.NATIVE_PLAYER.profile,set:f.ref.set};
  Object.assign(f.c.NATIVE_PLAYER,{provisional:session,provisionalContext:{host:'fixture',accountId:'owner'},status:{verified:true,provisional:true,enabled:true}});
  vm.runInContext(actual(['nativePlayerIsProvisional','nativePlayerProvisionalRef'])+'\nSAVE.ref=nativePlayerProvisionalRef(NATIVE_PLAYER.provisional);',f.c);
  assert.equal(f.c.nativePlayerIsProvisional(),true);assert.equal(f.SAVE.ref.native,true);
  await f.edit();await f.drain();
  assert.equal(f.calls.length,1);assert.equal(f.SAVE.pending,null);assert.equal(f.local.size,0);
  f.c.NATIVE_PLAYER.status.verified=false;f.c.buildSave=()=>({...freshSave(),settings:{quality:'high'}});
  await f.edit();assert.equal(f.calls.length,1,'Provisional identity does not bypass the existing verified gate.');
});

test('an owned native menu edit confirms through the existing single flight without granting later idle bodies',async()=>{
  const f=fixture({native:true});f.hold();const first=f.edit();await f.drain();assert.equal(f.calls.length,1);
  f.c.buildSave=()=>({...freshSave(),settings:{quality:'high'}});const next=f.edit();
  assert.equal(first,next,'One publication owns both explicit snapshots.');
  f.c.buildSave=()=>({...freshSave(),settings:{quality:'medium'}});f.c.H.saveNow();
  f.releaseWrite();await first;await f.drain();
  assert.equal(f.calls.length,1,'The later ordinary idle body cannot use an earlier edit request.');
  assert.equal(f.SAVE.pending.settings.quality,'medium');assert.equal(f.local.size,0);
});

test('the latest explicit edit drains behind one native flight, including a paced provisional character',async()=>{
  for(const provisional of [false,true]) {
    const f=fixture({native:true});f.c.nativePlayerIsProvisional=()=>provisional;f.SAVE.guestWriteAt=30000;
    f.hold();const first=f.edit();await f.drain();assert.equal(f.calls.length,1);
    f.c.buildSave=()=>({...freshSave(),settings:{quality:'high'}});const next=f.edit();assert.equal(first,next);
    f.releaseWrite();await first;await f.drain();
    assert.deepEqual(f.calls.map(call=>call.value.settings.quality),['low','high']);
    assert.equal(f.SAVE.pending,null);assert.equal(f.SAVE.nativeFlight,null);assert.equal(f.timers.size,0);
  }
});

test('identity changes during a native menu write cannot acknowledge a different owner or use plaintext fallback',async()=>{
  const f=fixture({native:true});f.hold();const pending=f.edit();await f.drain();
  f.c.NATIVE_PLAYER.profile={};f.SAVE.ref={set:async()=>assert.fail('Wrong owner')};
  f.releaseWrite();await pending;await f.drain();
  assert.equal(f.SAVE.lastBody,'');assert.equal(f.local.size,0);assert.equal(f.SAVE.pending.char.lore.track,'cook');
});

test('a dispatched native edit accepts a late successful confirmation from its unchanged owner',async()=>{
  const f=fixture({native:true});f.hold();const pending=f.edit();await f.drain();assert.equal(f.calls.length,1);
  f.advance(10001);f.releaseWrite();await pending;await f.drain();
  assert.equal(f.SAVE.pending,null);assert.equal(JSON.parse(f.SAVE.lastBody).char.lore.track,'cook');
  assert.equal(f.calls.length,1);assert.equal(f.local.size,0);
});

test('legacy refusal uses the owned browser checkpoint, and actual reload checks it before reopening the remote backend',async()=>{
  const f=fixture({fail:true});f.SAVE.ref=f.ref;f.SAVE.server=true;
  await f.edit();assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.final,true);
  assert.equal(f.local.size,1);let remoteLookups=0;
  Object.assign(f.c,{CLASSES:{warrior:{}},LEVEL_CAP:50,window:{},nativePlayerSaveRef:async()=>null,
    netServerSaveRef:async()=>{remoteLookups++;throw Error('A valid local checkpoint must be considered first');},netServerUrl:()=>'',
    setupTitle(){},applySettings(){},applyWorldSave(){}});
  f.c.SAVE=base();f.c.GAME.started=false;f.c.GAME.ready=false;f.c.GAME.player=null;
  vm.runInContext(declarations(['withTimeout','initSaveBackend','readLocal','validSave','saveLoadOwned','saveLoadTitle','loadSave'])+'\nglobalThis.reloadSave=loadSave;',f.c);
  const loaded=await f.c.reloadSave();
  assert.equal(remoteLookups,0);assert.equal(loaded.char.lore.track,'cook');assert.equal(loaded.settings.quality,'low');assert.equal(f.c.SAVE.backend,'local');
});

for(const code of ['revoked','not_granted','invalid_argument','capability_disabled'])test(`owned legacy ${code} fallback preserves already-queued edits without granting native fallback`,async()=>{
  const f=fixture({fail:code,queued:true});f.SAVE.ref=f.ref;
  const first=f.edit();f.c.buildSave=()=>({...freshSave(),settings:{quality:'high'}});const last=f.edit();
  f.release();await first;await last;
  assert.equal(f.calls.length,1);assert.equal(f.SAVE.ref,null);assert.equal(f.SAVE.backend,'local');
  assert.equal(JSON.parse(f.local.get(f.SAVE.lsKey)).settings.quality,'high');
  assert.equal(JSON.parse(f.SAVE.lastBody).settings.quality,'high');
  const n=fixture({native:true,fail:code});await n.edit();
  assert.equal(n.local.size,0);assert.equal(n.SAVE.pending.char.lore.track,'cook');assert.equal(n.SAVE.menuFallback??null,null);
});

test('a previous legacy fallback receipt cannot authorize a later arbitrary removal or changed owner',async()=>{
  for(const change of ['ref','owner','expired']) {
    const f=fixture({fail:'revoked'});f.SAVE.ref=f.ref;await f.edit();
    assert.equal(f.local.size,1);f.local.clear();f.SAVE.ref=f.ref;
    let release;f.SAVE.chain=new Promise(resolve=>{release=resolve;});
    f.c.buildSave=()=>({...freshSave(),settings:{quality:'high'}});const next=f.edit();
    if(change==='ref')f.SAVE.ref=null;
    if(change==='owner')f.c.NETWS.acct.id='different-owner';
    if(change==='expired')f.advance(10001);
    release();await next;assert.equal(f.local.size,0,change);assert.equal(f.calls.length,1,change);
  }
});
