import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../../src/14q_netseason.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const extract=name=>{const at=source.indexOf('function '+name+'(');assert.ok(at>=0,name);return source.slice(at,source.indexOf('\n}',at)+2);};
const logistics=source.slice(source.indexOf('const NETR_LOGISTICS=new Map();'),source.indexOf('Object.assign(window.__hm.netseason,{logistics'));
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const state={live:true,keeper:true,seated:false,connected:true,sent:[],timers:[],projections:0,
  admission:{origin:'https://world.test',epoch:1}};
 const NETS={q:0,waits:new Map(),s:{n:1,management:{v:1,realm:0,revision:0},logistics:null}};
 const NETPARTS={authority:'authority-one',admission:state.admission};
 const context=vm.createContext({NETS,NETPARTS,NETWS:{acct:{id:'owner-one'},generation:1},NET:{self:'peer-one'},HALL:{sit:null},GAME:{player:{faction:0}},
  netsOn:()=>state.connected,netHumanLive:()=>state.live,netEntityCanSimulateWorld:()=>state.keeper,hallThroneGrant:()=>state.seated,
  netCurrentWorldAdmission:()=>state.admission,netRealmManagementRead:v=>v?.v===1?v:null,
  realmLogisticsApplyProjection(){state.projections++;},crypto:{randomUUID:()=>String(state.sent.length)},
  netWsSend:message=>{state.sent.push(clone(message));return state.connected;},setTimeout:run=>{state.timers.push(run);return state.timers.length;}});
 vm.runInContext(extract('netsAsk')+'\n'+extract('netSeasonMsg')+'\n'+logistics+'\nthis.pending=NETR_LOGISTICS;',context);
 return{state,context,NETS,NETPARTS,pending:context.pending,
  command:(args,nonce)=>context.netRealmLogisticsCommand(args,nonce),
  admission(value){state.admission=value;NETPARTS.admission=value;},
  reply(index,value={}){const request=state.sent[index];const reply={t:'order',kind:'logistics',q:request.q,nonce:request.o.nonce,ok:false,pending:true,...value};context.netSeasonMsg(reply);return reply;},
  receive:message=>context.netRealmLogisticsReceive(message)};
}
const mount=n=>({op:'mount.issue',actorId:'scene:test:'+n});
const view=(epoch=1,season=1)=>({v:1,scope:{origin:'https://world.test',epoch},season,revision:1,time:100,jobs:[],mounts:[],repairs:[],donations:[]});

test('eight uncertain old-world requests cannot block initialization after an admission and season reset',async()=>{
 const f=fixture();
 for(let n=0;n<8;n++){const waiting=f.command(mount(n),'old-nonce-'+n);f.reply(n);await waiting;}
 assert.equal(f.pending.size,8);
 const full=await f.command({op:'convoy.dispatch',keep:0},'same-world-nine');
 assert.equal(full.pending,true);assert.equal(f.state.sent.length,8,'the current-world cap remains enforced');
 f.NETS.s.n=2;f.admission({origin:'https://world.test',epoch:2});
 const fresh=f.command({op:'convoy.dispatch',keep:0},'fresh-world-nonce');
 assert.equal(f.state.sent.length,9);assert.equal(f.pending.size,1);
 assert.equal(f.state.sent[8].o.season,2);assert.equal(f.state.sent[8].o.worldAdmission.epoch,2);
 f.reply(8,{ok:true,pending:false,confirmed:true,logistics:view(2,2)});assert.equal((await fresh).confirmed,true);
 assert.equal(f.pending.size,0);assert.equal(f.NETS.s.logistics.scope.epoch,2);
});

test('same-world reconnects retain the accepted nonce and revision without another simulated native charge',async()=>{
 const f=fixture(),charged=new Set();let charges=0;
 const answer=(index,confirmed)=>{const nonce=f.state.sent[index].o.nonce;if(!charged.has(nonce)){charged.add(nonce);charges++;}
  f.reply(index,{ok:true,pending:!confirmed,confirmed,...(confirmed?{logistics:view()}:{} )});};
 const first=f.command({op:'repair.issue',keep:0,kind:'gate'},'uncertain-repair');answer(0,false);await first;
 const entry=f.pending.get('uncertain-repair');
 f.context.NETWS.generation++;f.context.NET.self='reconnected-peer';f.NETPARTS.authority='new-keeper-authority';f.NETS.s.management.revision=9;
 const retry=f.command({op:'repair.issue',keep:0,kind:'gate'},'uncertain-repair');
 assert.equal(f.pending.get('uncertain-repair'),entry);assert.equal(f.state.sent[1].o.nonce,'uncertain-repair');
 assert.equal(f.state.sent[1].o.revision,0);assert.equal(f.state.sent[1].o.authority,'new-keeper-authority');
 answer(1,true);assert.equal((await retry).confirmed,true);assert.equal(charges,1);assert.equal(f.pending.size,0);
});

test('temporarily missing admission preserves uncertain entries and ignores their unverified replies',async()=>{
 const f=fixture(),first=f.command(mount(1),'uncertain-mount'),entry=f.pending.get('uncertain-mount');
 f.admission(null);
 f.reply(0,{ok:true,pending:false,confirmed:true,logistics:view()});
 const pending=await first;assert.equal(pending.pending,true);assert.equal(f.pending.get('uncertain-mount'),entry);
 assert.equal(f.NETS.s.logistics,null);assert.equal(f.state.projections,0);
 const unavailable=await f.command(mount(2),'new-unverified');
 assert.equal(unavailable.pending,true);assert.equal(f.state.sent.length,1);assert.equal(f.pending.size,1);
 f.admission({origin:'https://world.test',epoch:1});
 const retry=f.command(mount(1),'uncertain-mount');assert.equal(f.state.sent[1].o.nonce,'uncertain-mount');
 f.reply(1,{ok:true,pending:false,confirmed:true,logistics:view()});assert.equal((await retry).confirmed,true);
});

test('obsolete account and realm queues are retired without discarding an unrelated current request',async()=>{
 for(const change of [f=>f.context.NETWS.acct.id='owner-two',f=>f.context.GAME.player.faction=1]){
  const f=fixture(),old=f.command(mount(1),'old-owner-nonce');f.reply(0);await old;
  change(f);const next=f.command(mount(2),'new-owner-nonce');
  assert.equal(f.pending.has('old-owner-nonce'),false);assert.equal(f.pending.size,1);
  f.reply(1,{ok:true,pending:false,confirmed:true});await next;assert.equal(f.pending.size,0);
 }
});

test('late old replies and awaited results cannot project or settle a new entry that reuses its nonce',async()=>{
 for(const late of [{ok:false,pending:false,why:'Retired request refused'},
   {ok:true,pending:false,confirmed:true,logistics:view(),management:{v:1,realm:0,revision:99}}]){
  const f=fixture(),old=f.command({op:'repair.issue',keep:0,kind:'gate'},'reused-nonce');
  f.NETS.s.n=2;f.admission({origin:'https://world.test',epoch:2});
  f.NETS.s.logistics=view(2,2);const current=f.NETS.s.logistics;
  const next=f.command({op:'repair.issue',keep:1,kind:'gate'},'reused-nonce'),entry=f.pending.get('reused-nonce');
  f.reply(0,late);const retired=await old;
  assert.equal(retired.code,'stale_context');assert.equal(retired.pending,false);
  assert.equal(f.pending.get('reused-nonce'),entry);assert.equal(entry.sending,true);
  assert.equal(f.NETS.s.logistics,current);assert.equal(f.NETS.s.management.revision,0);assert.equal(f.state.projections,0);
  f.reply(1,{ok:true,pending:false,confirmed:true,logistics:view(2,2)});
  assert.equal((await next).confirmed,true);assert.equal(f.pending.size,0);assert.equal(f.state.projections,1);
 }
});

test('a current pending nonce cannot be rebound to different input',async()=>{
 const f=fixture(),first=f.command(mount(1),'stable-input-nonce');f.reply(0);await first;
 const refused=await f.command(mount(2),'stable-input-nonce');
 assert.equal(refused.ok,false);assert.match(refused.why,/different action/);
 assert.equal(f.state.sent.length,1);assert.equal(f.pending.size,1);
});
