// Transport regression against an isolated local server. Never connects to a public game or pod.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child=null, directory=null;
async function endpoint() {
  if(process.argv[2]) { const url=new URL(process.argv[2]);if(url.pathname==='/')url.pathname='/ws';return url.href; }
  directory=mkdtempSync(path.join(tmpdir(),'hallowmarch-shared-transport-'));
  const page=path.join(directory,'page.html');writeFileSync(page,'<!doctype html><title>Transport fixture</title>');
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('HM_')&&!key.startsWith('INTEREGO_')&&!key.startsWith('RAILWAY_')));
  Object.assign(env,{PORT:String(port),HM_DATA:directory,HM_PAGE:page,HM_SRC:path.join(root,'src'),
    HM_WORLD_PERSISTENCE_MODE:'legacy',HM_GAMING_ENABLED:'0',HM_GAMING_BOOTSTRAP:'0',HM_NATIVE_PLAYER_REQUIRED:'0',
    HM_NATIVE_AGENT_ENABLED:'0',HM_GAMING_MONITOR_ENABLED:'0',HM_PUBLIC_ORIGIN:'https://127.0.0.1:'+port});
  let output='';
  child=spawn(process.execPath,[path.join(root,'server','server.js')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{output+=b});child.stderr.on('data',b=>{output+=b});
  for(let i=0;i<150;i++){
    if(child.exitCode!==null)throw Error('Fixture server stopped: '+output);
    try{const response=await fetch('http://127.0.0.1:'+port+'/health');if(response.ok)return 'ws://127.0.0.1:'+port+'/ws'}catch{}
    await delay(100);
  }
  throw Error('Fixture did not become ready: '+output);
}
async function connect(url,room,name,sharedScene=2) {
  const ws=new WebSocket(url), client={ws,messages:[],peer:null,admission:null,authority:null,name};
  ws.addEventListener('message',event=>{
    const m=JSON.parse(event.data);client.messages.push(m);
    if(client.messages.length>2000)client.messages.shift();
    if(m.t==='welcome'){client.peer=m.peer;client.admission=m.worldAdmission;client.acct=m.acct}
    if(m.t==='activity'&&m.kind==='authority')client.authority=m.authority;
  });
  client.wait=async(fn,after=0)=>{
    for(let i=0;i<200;i++){const m=client.messages.slice(after).find(fn);if(m)return m;if(ws.readyState===3)throw Error(name+' closed before matching frame');await delay(25)}
    throw Error(name+' missing frame; latest '+JSON.stringify(client.messages.slice(-4)));
  };
  client.send=m=>ws.send(JSON.stringify(m));
  client.activity=m=>client.send({t:'activity',authority:client.authority,worldAdmission:client.admission,...m});
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  client.send({t:'hello',room});await client.wait(m=>m.t==='welcome');
  client.send({t:'slow',d:{on:1,humanLive:1,humanActivity:1,sharedScene,r:0,c:'warrior',l:20,n:name,dn:name}});
  await client.wait(m=>m.t==='activity'&&m.kind==='authority');
  client.send({t:'fast',d:{s:1,p:[0,0,0],y:0,v:[0,0],a:0,h:1,m:100,d:0,ev:[]}});
  return client;
}
const boat=()=>({id:1,x:0,z:0,yaw:0,vx:0,vz:0,wr:0,st:'free',ph:0,eff:0,grounded:0,char:0,rider:null,still:false,home:{j:0,b:0},launch:null});
const npcs=()=>[...Array(27)].map((_,i)=>({id:'town:'+Math.floor(i/9)+':villager:'+(i%9),role:'villager',
  n:'A worker with a persistent shared identity '+i,r:Math.floor(i/9),c:null,l:1,p:[i,2,0],y:0,a:21,ph:2,am:0,h:100,m:100,d:0,g:0,
  lk:[1.123456789,1.123456789,1.123456789,1.123456789,1.123456789,1.123456789,0.123456789,0.123456789,65536,0,1.0123456789,0,0,0,0.23456789],
  st:null,fm:[Math.floor(i/9),1,0],hm:0,bt:null}));
function publish(client,kind,payload,seq) {
  const text=JSON.stringify(payload),total=Math.ceil(text.length/3500);
  for(let part=0;part<total;part++)client.activity({kind,op:'snapshot',seq,part,total,data:text.slice(part*3500,(part+1)*3500)});
  return total;
}
async function stream(client,kind,after=0,seq=null) {
  for(let n=0;n<200;n++){
    const rows=client.messages.slice(after).filter(m=>m.t==='activity'&&m.kind===kind&&m.op==='snapshot'&&(seq===null||m.seq===seq));
    const last=rows.at(-1);
    if(last){const same=rows.filter(m=>m.seq===last.seq&&m.authority===last.authority),parts=new Map(same.map(m=>[m.part,m.data]));
      if(parts.size===last.total)return JSON.parse([...Array(last.total)].map((_,i)=>parts.get(i)).join(''))}
    await delay(25);
  }
  throw Error('Incomplete '+kind+' stream for '+client.name);
}
const clients=[];
try {
  const url=await endpoint(), parsed=new URL(url);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname),'Transport regression is local-only');
  const healthUrl=(parsed.protocol==='wss:'?'https:':'http:')+'//'+parsed.host+'/health';
  const baseline=await(await fetch(healthUrl)).json();
  const room=('scene-proof-'+Date.now().toString(36)).slice(0,32);
  const a=await connect(url,room,'Desktop fixture');clients.push(a);
  const b=await connect(url,room,'Phone fixture');clients.push(b);
  assert.equal(a.authority,b.authority);
  const hostFrame=await b.wait(m=>m.t==='activity'&&m.kind==='authority');assert.equal(hostFrame.peer,a.peer);
  a.activity({kind:'boats',op:'snapshot',seq:1,boats:[boat()]});
  await b.wait(m=>m.kind==='boats'&&m.op==='snapshot'&&m.boats?.length===1);
  const beforeRaceA=a.messages.length,beforeRaceB=b.messages.length;
  b.activity({kind:'boats',op:'board',id:1});a.activity({kind:'boats',op:'board',id:1});
  const granted=await b.wait(m=>m.kind==='boats'&&m.op==='board'&&m.ok===true,beforeRaceB);
  const winner=granted.boats[0].rider===a.peer?a:b,loser=winner===a?b:a;
  await loser.wait(m=>m.kind==='boats'&&m.op==='board'&&m.ok===false,loser===a?beforeRaceA:beforeRaceB);
  const movedFrom=b.messages.length;
  winner.activity({kind:'boats',op:'state',seq:100,boats:[{...boat(),x:3,vx:2}]});
  await loser.wait(m=>m.kind==='boats'&&m.op==='state'&&m.boats?.[0]?.x===3);
  a.activity({kind:'boats',op:'snapshot',seq:2,boats:[{...boat(),x:400}]});
  const canonical=await b.wait(m=>m.kind==='boats'&&m.op==='snapshot'&&m.seq===2,movedFrom);
  assert.equal(canonical.boats[0].x,3);assert.equal(canonical.boats[0].rider,winner.peer);
  const workers=npcs();
  const workerEnvelope={t:'activity',kind:'npcs',op:'snapshot',seq:1,authority:a.authority,worldAdmission:a.admission,npcs:workers};
  assert.ok(JSON.stringify(workerEnvelope).length>8192);
  a.send(workerEnvelope);
  const workerFrame=await b.wait(m=>m.kind==='npcs'&&m.op==='snapshot');
  assert.equal(workerFrame.npcs.length,27);assert.deepEqual(workerFrame.npcs.map(r=>r.id),workers.map(r=>r.id));
  const fullEntities={v:1,full:true,rows:[...Array(100)].map((_,i)=>({id:'scene:fixture:'+i,p:[i,2,0],descriptor:'x'.repeat(2500)})),remove:[],meta:{warbands:[],caravans:[]}};
  fullEntities.meta.thrones=[{id:15,realm:0,x:0,y:0,z:0,ready:true}];
  const chunks=publish(a,'entities',fullEntities,1);assert.ok(chunks>60);
  assert.equal((await stream(b,'entities',0,1)).rows.length,100);
  const throneFrom=b.messages.length;
  b.send({t:'fast',d:{s:2,p:[0,0,0],y:0,v:[0,0],a:0,h:1,m:100,d:0,st:0.53,ev:[]}});
  b.activity({kind:'thrones',op:'claim',id:15,seq:1});
  const throne=await b.wait(m=>m.kind==='thrones'&&m.request===1&&m.ok===true,throneFrom);
  assert.equal(throne.seats[0].peer,b.peer);
  const deniedFrom=a.messages.length;
  a.activity({kind:'thrones',op:'claim',id:15,seq:1});
  await a.wait(m=>m.kind==='thrones'&&m.request===1&&m.ok===false,deniedFrom);
  const worldFrom=b.messages.length;
  publish(a,'worldparts',{v:1,full:true,parts:{farm:{plots:[{id:1,stage:3}]},build:{pieces:[{id:1,st:'built'}]}},remove:[],receipts:[]},1);
  const world=await stream(b,'worldparts',worldFrom,1);assert.equal(world.parts.farm.plots[0].stage,3);
  const receipt={id:b.peer+':proof',to:b.peer,ownerAccount:b.acct.id,digest:'settlement-proof',ok:true,goods:[],result:{pieceId:1}};
  const receiptFrom=b.messages.length;
  publish(a,'worldparts',{v:1,full:false,parts:{},remove:[],receipts:[receipt]},2);
  assert.equal((await stream(b,'worldparts',receiptFrom,2)).receipts[0].settled,undefined);
  const settledFrom=a.messages.length;
  b.activity({kind:'worldparts',op:'settled',id:receipt.id,digest:receipt.digest,ownerAccount:'spoofed'});
  const settled=await a.wait(m=>m.kind==='worldparts'&&m.op==='settled',settledFrom);
  assert.equal(settled.ownerAccount,b.acct.id);
  await b.wait(m=>m.kind==='worldparts'&&m.op==='settled'&&m.digest===receipt.digest&&m.ownerAccount===b.acct.id,receiptFrom);
  const confirmedFrom=b.messages.length;
  publish(a,'worldparts',{v:1,full:false,parts:{},remove:[],receipts:[receipt]},3);
  assert.equal((await stream(b,'worldparts',confirmedFrom,3)).receipts[0].settled,true);
  const oldAuthority=b.authority,afterHandoff=b.messages.length;
  a.ws.close();await b.wait(m=>m.kind==='authority'&&m.peer===b.peer&&m.authority!==oldAuthority,afterHandoff);
  const takeover=await b.wait(m=>m.kind==='authority'&&m.authority!==oldAuthority,afterHandoff);
  assert.equal(takeover.boats[0].x,3);assert.equal(takeover.npcs.length,27);
  assert.equal(takeover.thrones.seats[0].peer,b.peer,'throne occupant survives keeper departure');
  assert.equal((await stream(b,'entities',afterHandoff)).rows.length,100);
  assert.equal((await stream(b,'worldparts',afterHandoff)).parts.build.pieces[0].st,'built');
  const c=await connect(url,room,'Late join fixture');clients.push(c);
  assert.equal((await c.wait(m=>m.kind==='authority')).boats[0].x,3);
  assert.equal((await c.wait(m=>m.kind==='authority')).thrones.seats[0].peer,b.peer);
  const releaseFrom=b.messages.length;
  b.activity({kind:'thrones',op:'release',id:15,seq:2});
  const released=await b.wait(m=>m.kind==='thrones'&&m.request===2&&m.ok===true,releaseFrom);
  assert.equal(released.seats.length,0);
  assert.equal((await stream(c,'entities')).rows.length,100);
  assert.equal((await stream(c,'worldparts')).parts.farm.plots[0].stage,3);
  for(const client of clients)client.ws.close();
  let health=null;
  for(let i=0;i<100;i++){health=await(await fetch(healthUrl)).json();if(health.players===baseline.players)break;await delay(50)}
  assert.equal(health.players,baseline.players);
  if(baseline.players===0)assert.equal(health.livePlay.mode,'standby');
  const mixedRoom=('mixed-proof-'+Date.now().toString(36)).slice(0,32);
  const old=await connect(url,mixedRoom,'Old page fixture',1);clients.push(old);
  const oldToken=old.authority, mark=old.messages.length;
  const modern=await connect(url,mixedRoom,'Updated page fixture',2);clients.push(modern);
  const upgraded=await old.wait(m=>m.kind==='authority'&&m.authority!==oldToken,mark);
  assert.equal(upgraded.peer,modern.peer,'version-two scene page displaces an earlier version-one host');
  modern.activity({kind:'boats',op:'snapshot',seq:1,boats:[{...boat(),x:7}]});
  await old.wait(m=>m.kind==='boats'&&m.op==='snapshot'&&m.boats?.[0]?.x===7,mark);
  old.ws.close();modern.ws.close();
  for(let i=0;i<100;i++){health=await(await fetch(healthUrl)).json();if(health.players===baseline.players)break;await delay(50)}
  assert.equal(health.players,baseline.players);
  const legacyRoom=('legacy-proof-'+Date.now().toString(36)).slice(0,32);
  const standalone=await connect(url,legacyRoom,'Standalone fixture',0);clients.push(standalone);
  assert.equal((await standalone.wait(m=>m.kind==='authority')).peer,standalone.peer,'standalone version-zero fixtures remain compatible');
  standalone.ws.close();
  for(let i=0;i<100;i++){health=await(await fetch(healthUrl)).json();if(health.players===baseline.players)break;await delay(50)}
  assert.equal(health.players,baseline.players);
  const farRoom=('far-proof-'+Date.now().toString(36)).slice(0,32);
  const keeper=await connect(url,farRoom,'Far keeper fixture');clients.push(keeper);
  const far=await connect(url,farRoom,'Far actor fixture');clients.push(far);
  const observer=await connect(url,farRoom,'Normal observer fixture');clients.push(observer);
  const keeperFrom=keeper.messages.length,observerFrom=observer.messages.length;
  far.send({t:'fast',d:{s:200,p:[1500,0,0],y:0,v:[0,0],a:0,h:1,m:100,d:0,ev:[]}});
  await keeper.wait(m=>m.t==='peer'&&m.peer===far.peer&&m.fast?.p?.[0]===1500&&!m.far,keeperFrom);
  far.send({t:'fast',d:{s:201,p:[1501,0,0],y:0,v:[1,0],a:0,h:1,m:100,d:0,ev:[]}});
  await keeper.wait(m=>m.t==='peer'&&m.peer===far.peer&&m.fast?.p?.[0]===1501&&!m.far,keeperFrom);
  await delay(100);
  assert.equal(observer.messages.slice(observerFrom).some(m=>m.peer===far.peer&&m.fast&&!m.far),false,'distant nonkeepers retain map-only throttled updates');
  assert.equal(observer.messages.slice(observerFrom).some(m=>m.peer===far.peer&&m.fast?.p?.[0]===1501),false,'the ordinary far observer does not receive each fast frame');
  keeper.ws.close();far.ws.close();observer.ws.close();
  for(let i=0;i<100;i++){health=await(await fetch(healthUrl)).json();if(health.players===baseline.players)break;await delay(50)}
  assert.equal(health.players,baseline.players);
  console.log(JSON.stringify({ok:true,boatRace:'exclusive',boatX:3,workers:27,entityChunks:chunks,entities:100,lateJoin:true,hostHandoff:true,mixedCapabilityHost:true,privateSettlement:true,keeperReceivesDistant:true,playersAfter:health.players,idleMode:health.livePlay.mode}));
} finally {
  for(const client of clients){try{client.ws.close()}catch{}}
  if(child){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)])}
  if(directory){assert.ok(directory.startsWith(tmpdir()));rmSync(directory,{recursive:true,force:true})}
}
