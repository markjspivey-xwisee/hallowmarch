import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=['14n_net.js','14p_netws.js'].map(name=>fs.readFileSync(new URL('../../src/'+name,import.meta.url),'utf8')).join('\n');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve()};
function harness() {
  let clock=1000,next=0,suspended=0;
  const timers=new Map(), sockets=[], notices=[];
  class Socket {
    constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this)}
    send(text){this.sent.push(JSON.parse(text))}
    close(){this.readyState=3;this.onclose?.({code:1000,reason:'closed'})}
    open(){this.readyState=1;this.onopen?.({})}
    message(m){this.onmessage?.({data:JSON.stringify(m)})}
    serverClose(code,reason){this.readyState=3;this.onclose?.({code,reason})}
  }
  const context=vm.createContext({console,URL,URLSearchParams,Map,Set,Object,Array,JSON,Math,Date,AbortSignal,
    performance:{now:()=>clock},GAME:{ready:false,started:false,player:null,prog:null},
    NET_HUMAN_PLAY:{activity:1},netHumanLive:()=>true,netHumanSync(){},netHumanSuspend(){suspended++},
    netWxTake(){},netWxResume(){},netWorldCapture(){},dist2:(x,z,px,pz)=>(x-px)**2+(z-pz)**2,reportError(e){throw e},
    uiLog:(...args)=>notices.push(args),uiToast:(...args)=>notices.push(args),
    netStr:s=>String(s||''),clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),WebSocket:Socket,
    location:{search:'?server='+encodeURIComponent('wss://game.test/ws'),reload(){throw Error('unexpected automatic reload')}},
    window:{addEventListener(){}},document:{addEventListener(){}},
    SAVE:{ref:{character:'same-owner'},kind:'native'},NATIVE_PLAYER:{binding:{subjectDid:'did:web:identity.test:owner'}},
    localStorage:{getItem:()=>'',setItem(){},removeItem(){throw Error('identity storage must be preserved')}},
    setTimeout(fn,ms){const id=++next;timers.set(id,{fn,ms});return id},clearTimeout(id){timers.delete(id)},
    setInterval(fn,ms){const id=++next;timers.set(id,{fn,ms});return id},clearInterval(id){timers.delete(id)},
    queueMicrotask(){},withTimeout:p=>p});
  vm.runInContext(source,context);
  vm.runInContext('globalThis.api={NET,NETWS,netSlowObj,netHostElect,netGhosts,netSharedSceneMessage,netSharedSceneReset,netSceneReloadRequired,netWsOpen,netWsReconnect,netWsRetryLater,netWsSend,netSendFast,netActivityPosition};',context);
  const api=context.api;
  Object.assign(api.NETWS,{url:'wss://game.test/ws',host:'game.test',token:'same-issued-session',acct:{id:'same-account'},state:'off'});
  return {api,context,timers,sockets,notices,suspended:()=>suspended};
}

test('stationary shared actions send one fresh validated pose before the command without an idle heartbeat',()=>{
  const h=harness(); let now=10000;
  h.context.performance.now=()=>now;
  h.context.GAME.started=true;h.context.GAME.player={id:'local',x:1,y:2,z:3};
  const socket={readyState:1,sent:[],send(text){this.sent.push(JSON.parse(text))}};
  h.api.NETWS.ws=socket;h.api.NETWS.state='on';
  Object.assign(h.api.NET,{state:'on',fastAt:now,lastFast:{t:now-6000},link:{kind:'ws',
    setFast:d=>h.api.netWsSend({t:'fast',d}),connected:()=>true}});
  vm.runInContext('netFastObj=now=>({t:now,p:[GAME.player.x,GAME.player.y,GAME.player.z],y:0,v:[0,0],a:0,h:1,m:100,d:0,mo:0,ph:0,sw:0,st:0,cs:0,fl:0,tg:""})',h.context);
  const command={t:'activity',kind:'worldparts',op:'command',command:{id:'rune',op:'combat.rune'}};
  assert.equal(h.api.netWsSend(command),true);
  assert.deepEqual(socket.sent.map(m=>m.t),['fast','activity']);
  assert.deepEqual(socket.sent[0].d.p,[1,2,3]);
  for(const kind of ['worldparts','entities','boats'])
    assert.equal(h.api.netWsSend({...command,kind,op:kind==='boats'?'board':'command'}),true);
  assert.equal(socket.sent.filter(m=>m.t==='fast').length,1,'a burst of actions reuses the fresh pose');
  now+=200;h.context.GAME.player.x=4;
  assert.equal(h.api.netWsSend(command),true);
  assert.deepEqual(socket.sent.at(-2).d.p,[4,2,3],'an action after movement carries the changed position first');
  assert.equal(socket.sent.filter(m=>m.t==='fast').length,2);
  h.api.netWsSend(command);
  assert.equal(socket.sent.filter(m=>m.t==='fast').length,2,'repeated actions cannot exceed the configured pose rate');
  now+=6000;
  h.api.netSendFast(now);
  assert.equal(socket.sent.filter(m=>m.t==='fast').length,2,'standing still produces no periodic pose uploads');
  assert.equal(h.api.netWsSend({...command,kind:'boats',op:'launch'}),true);
  assert.deepEqual(socket.sent.slice(-2).map(m=>m.t),['fast','activity']);
  assert.equal(socket.sent.filter(m=>m.t==='fast').length,3);
  h.context.netHumanLive=()=>false;
  now+=6000;
  assert.equal(h.api.netWsSend({...command,kind:'boats',op:'ignite'}),false);
  assert.equal(socket.sent.filter(m=>m.t==='fast').length,3,'inactive pages cannot refresh or send shared actions');
});

test('updated WebSocket profiles advertise shared-scene capability while standalone profiles remain compatible',()=>{
  const h=harness();
  assert.equal(h.api.netSlowObj().sharedScene,1);
  assert.equal(h.api.netSlowObj().humanActivity,1);
  h.api.NETWS.url='';assert.equal(h.api.netSlowObj().sharedScene,0);
});

test('one server authority overrides skewed local clocks on every character page',()=>{
  const a=harness(),b=harness();
  for(const [h,self,since,other,otherSince]of[[a,'a',100,'b',101],[b,'b',0,'a',100]]){
    Object.assign(h.context.GAME,{started:true,player:{id:self}});
    Object.assign(h.api.NET,{self,since,serverSceneHost:'a'});
    h.api.NET.peers.set(other,{peer:other,slow:{on:1,sharedScene:1,since:otherSince}});
    h.api.NETWS.state='on';h.api.netHostElect();
  }
  assert.equal(a.api.NET.host,'a');assert.equal(a.api.NET.isHost,true);
  assert.equal(b.api.NET.host,'a');assert.equal(b.api.NET.isHost,false,'an earlier local clock cannot elect a second simulator');
});

test('capable local pages do not elect an earlier legacy peer while awaiting server authority',()=>{
  const h=harness();
  Object.assign(h.context.GAME,{started:true,player:{id:'new'}});
  Object.assign(h.api.NET,{self:'new',since:100});
  h.api.NET.peers.set('old',{peer:'old',slow:{on:1,since:0}});
  h.api.NETWS.state='on';h.api.netHostElect();
  assert.equal(h.api.NET.host,'new');assert.equal(h.api.NET.isHost,true);
});

test('authority and reset stay scoped to the admitted world and preserve character identity',()=>{
  const h=harness(),admission={origin:'https://game.test',epoch:4};
  h.api.NETWS.worldAdmission=admission;
  const account=h.api.NETWS.acct,ref=h.context.SAVE.ref,principal=h.context.NATIVE_PLAYER.binding;
  h.api.netSharedSceneMessage({kind:'authority',peer:'host-1',authority:'token',worldAdmission:admission});
  assert.equal(h.api.NET.serverSceneHost,'host-1');
  h.api.netSharedSceneMessage({kind:'authority',peer:'wrong',authority:'token',worldAdmission:{origin:'https://other.test',epoch:4}});
  assert.equal(h.api.NET.serverSceneHost,'host-1');
  h.api.netSharedSceneMessage({kind:'authority',peer:'wrong',authority:'token',worldAdmission:{origin:'https://game.test',epoch:3}});
  assert.equal(h.api.NET.serverSceneHost,'host-1');
  assert.doesNotThrow(()=>h.api.netSharedSceneReset(),'old transport-only VMs may omit every optional scene module');
  assert.equal(h.api.NET.serverSceneHost,'');
  assert.equal(h.api.NETWS.acct,account);assert.equal(h.context.SAVE.ref,ref);
  assert.equal(h.context.NATIVE_PLAYER.binding,principal);assert.equal(h.api.NETWS.token,'same-issued-session');
});

test('reload-required websocket message preserves identity and permanently stops reconnect attempts',async()=>{
  const h=harness(),account=h.api.NETWS.acct,ref=h.context.SAVE.ref,principal=h.context.NATIVE_PLAYER.binding;
  const opening=h.api.netWsOpen();await flush();
  const ws=h.sockets[0];ws.open();
  ws.message({t:'welcome',peer:'me',acct:account,token:'same-issued-session',room:'march',worldAuthority:{mode:'legacy',enabled:false,scope:'world-and-season'}});
  assert.equal(await opening,true);
  const connectedAccount=h.api.NETWS.acct; assert.equal(connectedAccount.id,account.id);
  Object.assign(h.context.GAME,{started:true,player:{id:'same-character'}});
  ws.message({t:'reload-required',code:'shared_scene_upgrade_required',why:'Reload Hallowmarch. Your saved character is preserved.'});
  assert.equal(h.api.NETWS.reload,true);assert.equal(h.api.NETWS.worldReloadRequired,true);
  assert.equal(h.api.NETWS.acct,connectedAccount);assert.equal(h.context.SAVE.ref,ref);assert.equal(h.context.NATIVE_PLAYER.binding,principal);
  assert.equal(h.api.NETWS.token,'same-issued-session');assert.equal(h.suspended(),1);
  await h.api.netWsReconnect();h.api.netWsRetryLater();
  assert.equal(h.sockets.length,1);assert.equal(h.timers.size,0,'upgrade refusal must not create a reconnect loop');
  assert.ok(h.notices.some(args=>args[0].includes('saved character')));
});

test('upgrade close code 4006 preserves the same account and creates no replacement socket',async()=>{
  const h=harness(),account=h.api.NETWS.acct,ref=h.context.SAVE.ref;
  const opening=h.api.netWsOpen();await flush();
  const ws=h.sockets[0];ws.open();ws.message({t:'welcome',peer:'me',acct:account,token:'same-issued-session',room:'march',worldAuthority:{mode:'legacy',enabled:false,scope:'world-and-season'}});
  await opening;const connectedAccount=h.api.NETWS.acct;assert.equal(connectedAccount.id,account.id);
  ws.serverClose(4006,'Reload Hallowmarch to join the shared world.');
  assert.equal(h.api.NETWS.reload,true);assert.equal(h.api.NETWS.acct,connectedAccount);assert.equal(h.context.SAVE.ref,ref);
  await h.api.netWsReconnect();h.api.netWsRetryLater();
  assert.equal(h.sockets.length,1);assert.equal(h.timers.size,0);
});

test('the admitted keeper materializes distant live bodies while other viewers retain distance culling',()=>{
  const h=harness();
  vm.runInContext("netGhostMake = R => R.ghost = { alive:true, removed:false }; netGhostDrop = R => R.ghost = null; globalThis.netCompanionSync = () => {};",h.context);
  Object.assign(h.context.GAME,{started:true,player:{id:'keeper',x:0,z:0}});
  Object.assign(h.api.NET,{self:'keeper',serverSceneHost:'keeper'});
  h.api.NETWS.state='on';
  const remote={peer:'far',slow:{on:1},fast:{x:1500,z:0,fl:0},ghost:null};
  h.api.NET.peers.set('far',remote);
  h.api.netGhosts();assert.equal(remote.ghost?.alive,true,'AI owner needs distant admitted bodies for shared targeting');
  h.api.NET.serverSceneHost='another-host';
  h.api.netGhosts();assert.equal(remote.ghost,null,'ordinary viewer keeps the normal interest radius');
  h.api.NET.serverSceneHost='keeper';h.api.NETWS.state='off';
  h.api.netGhosts();assert.equal(remote.ghost,null,'an offline page cannot keep simulation-only bodies');
});
