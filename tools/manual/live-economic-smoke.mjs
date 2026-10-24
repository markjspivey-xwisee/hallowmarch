/** PREVIEW-only native economic acceptance. Uses a new disposable guest.
 * No grants, teleportation, simulated frames, world reset or existing-character writes. */
import fs from 'node:fs/promises';
import { chromium } from '../node_modules/playwright/index.mjs';
const origin='https://march-native-preview-production.up.railway.app';
const out='tools/out/live-economic-smoke', end=Date.now()+600000;
let browser,page,stage='preflight',pass=false;const checks=[],navigation={samples:[]};
const ensure=(ok,code)=>{if(!ok)throw Error(code)};
const remaining=max=>{const n=Math.min(max,end-Date.now());ensure(n>0,'acceptance_deadline');return n};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(fn,code,max=45000)=>{const deadline=Date.now()+remaining(max);while(Date.now()<deadline){if(await fn())return;await pause(150)}throw Error(code)};
const frames=new Map(),receipts=new Map();
function observe(socket){
  if(new URL(socket.url()).origin.replace('wss:','https:')!==origin)return;
  socket.on('framereceived',data=>{try{
    const m=JSON.parse(String(data));if(m.t!=='activity'||m.kind!=='worldparts')return;
    if(m.op==='result'&&typeof m.id==='string'){receipts.set(m.id,m);return}
    if(m.op!=='snapshot'||typeof m.data!=='string'||!Number.isInteger(m.part)||!Number.isInteger(m.total)||m.total<1||m.total>128)return;
    const key=m.authority+':'+m.seq;let a=frames.get(key);
    if(!a)frames.set(key,a={total:m.total,parts:new Map()});
    if(a.total!==m.total)return;a.parts.set(m.part,m.data);
    if(a.parts.size===a.total){const v=JSON.parse([...Array(a.total)].map((_,i)=>a.parts.get(i)).join(''));
      for(const r of v.receipts||[])if(typeof r.id==='string')receipts.set(r.id,r);frames.delete(key)}
    while(frames.size>4)frames.delete(frames.keys().next().value);
    while(receipts.size>128)receipts.delete(receipts.keys().next().value);
  }catch{/* Never log a raw frame, token or profile. */}});
}
async function json(path){const r=await fetch(origin+path,{signal:AbortSignal.timeout(remaining(10000)),redirect:'error',cache:'no-store'});ensure(r.ok,'public_status_unavailable');return r.json()}
async function redacted(){
  const status=await json('/gaming/world-state'),stats=await json('/stats');
  ensure(status.mode==='native'&&Number.isSafeInteger(status.confirmedVersion)&&status.confirmedVersion>0&&!status.fenced&&!status.error,'native_world_not_ready');
  const forbidden=new Set(['activity','worldparts','receipts','char','credentials','sharedWorldReservations']);
  const scan=v=>v&&typeof v==='object'&&(Object.keys(v).some(k=>forbidden.has(k))||Object.values(v).some(scan));
  ensure(!scan(status)&&!scan(stats),'public_checkpoint_body_leak');
  for(const room of stats.rooms||[])if(room.world)ensure(Object.keys(room.world).every(k=>['k','g','td','tm','cn','cl','at'].includes(k)),'unbounded_world_stats');
  return status;
}
async function active(){
  await page.waitForFunction(()=>{const h=__hm,w=h.net?.NETWS,p=h.worldparts?.NETPARTS;
    return h.GAME.started&&h.GAME.player?.alive&&h.SAVE.native&&h.SAVE.ref?.get
      &&w?.state==='on'&&w.acct?.nativeBound&&w.worldInitialized&&!w.worldPauseReason
      &&p?.ready&&!p.paused&&!!p.authority&&h.nativePlayerStatus?.().readConfirmed;
  },undefined,{timeout:remaining(70000)});
}
async function privateRecord(){return page.evaluate(async()=>{const s=await __hm.SAVE.ref.get();if(!s?.exists)throw Error('private_readback_missing');return s.data()})}
async function pauseAndSave(){
  await page.locator('#btn-menu').click();
  await page.waitForFunction(()=>__hm.UI.modal==='menu'&&__hm.net.NETWS.humanSuspended
    &&!__hm.SAVE.pending&&!__hm.SAVE.nativeFlight,undefined,{timeout:remaining(45000)});
}
try{
  await fs.mkdir(out,{recursive:true});ensure((await json('/health')).ok===true,'preview_not_ready');
  await redacted();checks.push('public status is native and excludes checkpoint bodies');
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:1000,height:700}});
  page=await context.newPage();let errors=0;page.on('pageerror',()=>errors++);page.on('websocket',observe);
  stage='fresh-guest';await page.goto(origin+'/?safe=1',{waitUntil:'domcontentloaded',timeout:remaining(60000)});
  await page.waitForFunction(()=>window.__hm?.ready&&!document.querySelector('#btn-begin')?.disabled,undefined,{timeout:remaining(120000)});
  await page.getByRole('textbox',{name:'Character name',exact:true}).fill('EconomicQA');
  await page.getByRole('button',{name:'Play now',exact:true}).click();
  await page.waitForFunction(()=>__hm.GAME.started&&__hm.GAME.player?.name==='EconomicQA',undefined,{timeout:remaining(90000)});
  const skip=page.getByRole('button',{name:'Skip the prologue',exact:true});if(await skip.isVisible())await skip.click();
  await page.locator('#scene').click({position:{x:500,y:350}});await page.keyboard.press('Shift');await active();
  await page.waitForFunction(()=>!__hm.SAVE.pending&&!__hm.SAVE.nativeFlight&&!__hm.worldparts.NETPARTS.pending.size,undefined,{timeout:remaining(45000)});
  const identity=await page.evaluate(()=>({id:__hm.SAVE.loaded?.nativePlay?.characterId,expiry:__hm.SAVE.loaded?.nativePlay?.guestExpiresAt}));
  ensure(typeof identity.id==='string','fresh_character_missing');
  stage='walk-to-rock';
  await page.evaluate(()=>__hm.fn.setQuality('low'));
  const rock=await page.evaluate(()=>{const h=__hm,p=h.GAME.player;
    const depleted=new Map((h.worldparts.capture().parts.resources?.rocks||[]).map(row=>[row[0],row]));
    const candidates=h.fn.W.rocks.map((r,i)=>{
      const d=Math.hypot(r.x-p.x,r.z-p.z),walk=Math.max(0,d-3.5),u=walk/(d||1);
      return {i,x:r.x,z:r.z,s:r.s,d,ax:p.x+(r.x-p.x)*u,az:p.z+(r.z-p.z)*u,walk};
    }).filter(r=>r.s>=.55&&r.s<2&&r.d<=75&&depleted.get(r.i)?.[1]!==0)
      .filter(r=>{const n=Math.max(1,Math.ceil(r.walk));
        for(let j=0;j<=n;j++){const t=j/n;
          if(!h.fn.isWalkable(p.x+(r.ax-p.x)*t,p.z+(r.az-p.z)*t))return false}
        return true}).sort((a,b)=>a.d-b.d);
    return candidates.find(r=>r.d<=25)||candidates[0]||null});
  ensure(rock,'no_nearby_walkable_resource');
  navigation.resource={index:rock.i,scale:rock.s,initialDistance:Math.round(rock.d*100)/100};
  const walkStarted=Date.now(),walkUntil=walkStarted+remaining(120000);
  let reached=false,best=Infinity,lastProgressGame=0,startGame=null,previous=null,lastSample=0;
  try{while(Date.now()<walkUntil){
    const at=await page.evaluate(()=>{const h=__hm,p=h.GAME.player;
      return {x:p.x,z:p.z,t:h.GAME.t,yaw:h.CAM.yaw,alive:p.alive,
        forward:h.INPUT.keys.has('KeyW'),modal:!!h.UI.modal}});
    ensure(at.alive,'fresh_guest_died');
    if(startGame===null){startGame=at.t;lastProgressGame=at.t}
    const d=Math.hypot(rock.x-at.x,rock.z-at.z),now=Date.now();
    if(d<best-.05){best=d;lastProgressGame=at.t}
    if(now-lastSample>=5000||d<=4.1){
      const rounded=v=>Number.isFinite(v)?Math.round(v*100)/100:null;
      const dx=previous?at.x-previous.x:0,dz=previous?at.z-previous.z:0;
      navigation.samples.push({wallSeconds:rounded((now-walkStarted)/1000),
        gameSeconds:rounded(at.t-startGame),x:rounded(at.x),z:rounded(at.z),
        distance:rounded(d),moved:rounded(Math.hypot(dx,dz)),
        forwardProjection:rounded(Math.sin(at.yaw)*dx+Math.cos(at.yaw)*dz),
        yaw:rounded(at.yaw),forward:at.forward,modalOpen:at.modal});
      if(navigation.samples.length>8)navigation.samples.splice(1,1);
      previous=at;lastSample=now;
    }
    if(d<=4.1){reached=true;break}
    ensure(at.t-lastProgressGame<2,'resource_approach_blocked');
    await page.evaluate(y=>__hm.look(y,.2),Math.atan2(rock.ax-at.x,rock.az-at.z));
    await page.keyboard.down('w');await pause(220);
  }}finally{await page.keyboard.up('w')}
  ensure(reached,'resource_approach_timeout');await pause(400);await active();
  const before=await page.evaluate(()=>__hm.fn.goodsCount('stone')),baseline=await redacted();
  stage='real-economic-action';
  const request=await page.evaluate(i=>{
    const h=__hm,p=h.worldparts.NETPARTS,ws=h.net.NETWS.ws;
    const q=window.__economicQA={id:null,commands:0,reservationValid:true,ws,generation:h.net.NETWS.generation};
    const descriptor=Object.getOwnPropertyDescriptor(ws,'send'),send=ws.send;
    q.restore=()=>descriptor?Object.defineProperty(ws,'send',descriptor):delete ws.send;
    ws.send=function(data){
      try{const m=JSON.parse(String(data));if(m.t==='activity'&&m.kind==='worldparts'&&m.op==='command'&&m.command?.id===q.id){
        q.commands++;const pending=p.pending.get(q.id);let saved;try{saved=JSON.parse(h.SAVE.lastBody||'null')}catch{}
        const row=saved?.char?.x?.sharedWorldReservations?.pending?.find(r=>r.id===q.id);
        q.reservationValid=q.reservationValid&&!!(pending?.durable&&pending.privateConfirmed&&pending.phase==='reserved'
          &&row?.ownerAccount===pending.ownerAccount&&row.op==='resource.mine'&&row.args?.i===i&&row.args?.pick===false);
      }}catch{q.reservationValid=false}
      return Reflect.apply(send,this,[data]);
    };
    const old=new Set(p.pending.keys()),accepted=h.worldparts.request('resource.mine',{i,pick:false});
    const entry=[...p.pending].find(([id,r])=>!old.has(id)&&r.op==='resource.mine'&&r.args.i===i);
    q.id=entry?.[0];return {accepted,id:q.id,durable:entry?.[1].durable,reserved:entry?.[1].phase==='reserved'};
  },rock.i);
  ensure(request.accepted&&request.id&&request.durable&&request.reserved,'economic_reservation_missing');
  await until(()=>receipts.has(request.id),'canonical_economic_receipt_missing',60000);
  const receipt=receipts.get(request.id);ensure(receipt.ok===true&&typeof receipt.digest==='string','economic_action_refused');
  const gained=(receipt.goods||[]).filter(([id])=>id==='stone').reduce((n,[,k])=>n+k,0);
  ensure(gained>=1&&gained<=2,'unexpected_barehand_yield');
  await page.waitForFunction(id=>{const h=__hm,q=window.__economicQA,p=h.worldparts.NETPARTS,s=p.settled.get(id);
    return q.commands>=1&&q.reservationValid&&q.ws===h.net.NETWS.ws&&q.generation===h.net.NETWS.generation
      &&!p.pending.has(id)&&s?.confirmed&&!h.SAVE.pending&&!h.SAVE.nativeFlight;
  },request.id,{timeout:remaining(60000)});
  const owned=await privateRecord(),journal=owned.char?.x?.sharedWorldReservations;
  ensure((owned.char?.x?.goods?.stone||0)===before+gained,'private_inventory_readback_mismatch');
  ensure(journal?.settled?.some(r=>r.id===request.id&&r.digest===receipt.digest)
    &&!(journal.pending||[]).some(r=>r.id===request.id),'private_outcome_tombstone_missing');
  ensure(await page.evaluate(n=>__hm.fn.goodsCount('stone')===n,before+gained),'live_inventory_mismatch');
  const depletion=await page.evaluate(i=>__hm.worldparts.capture().parts.resources?.rocks.find(row=>row[0]===i)?.slice(0,2),rock.i);
  ensure(depletion&&depletion[1]>=0&&depletion[1]<=2,'shared_depletion_missing');
  const durable=await redacted();ensure(durable.confirmedLiveVersion>baseline.confirmedLiveVersion,'native_world_version_did_not_advance');
  await page.evaluate(()=>window.__economicQA.restore());
  checks.push('real resource action used a confirmed native reservation, canonical receipt and private outcome readback');
  stage='reload-exactly-once';await pauseAndSave();
  await page.reload({waitUntil:'domcontentloaded',timeout:remaining(60000)});
  await page.waitForFunction(()=>window.__hm?.ready&&__hm.nativePlayerStatus?.().readConfirmed&&!document.querySelector('#btn-continue')?.disabled,undefined,{timeout:remaining(90000)});
  const same=await page.evaluate(()=>({id:__hm.SAVE.loaded?.nativePlay?.characterId,expiry:__hm.SAVE.loaded?.nativePlay?.guestExpiresAt}));
  ensure(same.id===identity.id&&same.expiry===identity.expiry,'guest_binding_changed');
  await page.getByRole('button',{name:'Return to the march',exact:true}).click();if(await skip.isVisible())await skip.click();
  await page.locator('#scene').click({position:{x:500,y:350}});await page.keyboard.press('Shift');await active();await pause(3500);
  ensure(await page.evaluate(n=>__hm.fn.goodsCount('stone')===n,before+gained),'reload_duplicated_or_lost_outcome');
  const reloadedDepletion=await page.evaluate(i=>__hm.worldparts.capture().parts.resources?.rocks.find(row=>row[0]===i)?.slice(0,2),rock.i);
  ensure(reloadedDepletion&&reloadedDepletion[1]===depletion[1],'native_reload_restored_mined_resource');
  const restored=await privateRecord();ensure((restored.char?.x?.goods?.stone||0)===before+gained
    &&restored.char?.x?.sharedWorldReservations?.settled?.some(r=>r.id===request.id&&r.digest===receipt.digest),'reloaded_private_readback_missing');
  await redacted();await pauseAndSave();ensure(errors===0,'browser_runtime_error');
  checks.push('same guest reloaded the confirmed outcome and mineral depletion without another award');pass=true;
}catch(error){
  const code=/^[a-z0-9_]+$/.test(error?.message||'')?error.message:'browser_step_failed';
  console.error(JSON.stringify({passed:false,stage,code,navigation}));process.exitCode=1;
}finally{
  try{await page?.evaluate(()=>window.__economicQA?.restore?.())}catch{}
  await page?.keyboard.up('w').catch(()=>{});
  await browser?.close();await fs.mkdir(out,{recursive:true});
  console.log(JSON.stringify({passed:pass,stage,checks,navigation}));
  await fs.writeFile(out+'/result.json',JSON.stringify({passed:pass,stage,checks,navigation},null,2));
}
