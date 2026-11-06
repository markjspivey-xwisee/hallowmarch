/** Actual path/card renderers and all visibility CSS; DOM only, no WebGL/services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from '../node_modules/playwright/index.mjs';
import {chromiumSwitches} from '../node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js';
import {stateCode,pathCode,loreCSSCode,standaloneCode,shellCSS,rtsCSS,hudMarkup,layoutCode} from './fixtures/bounty_hud_view.mjs';
let server,browser;const owned=new Set();let killUsed=false;const runFile=promisify(execFile);
const closeEvents=[];const recordClose=(event,data={})=>{if(closeEvents.length<32)closeEvents.push({event,at:performance.now(),...data});};
async function inventory(){if(!server?.process()?.pid)return;owned.add(server.process().pid);if(process.platform!=='win32')return;
  const {stdout}=await bounded(runFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId FROM Win32_Process' | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"],{windowsHide:true,timeout:10000,maxBuffer:4*1024*1024}),12000);
  const rows=JSON.parse(stdout);for(let pass=0;pass<12;pass++)for(const row of rows)if(owned.has(row.ParentProcessId))owned.add(row.ProcessId);}
const present=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code==='ESRCH'?false:'unknown';}};
const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned DOM browser close timed out')),ms);})]).finally(()=>clearTimeout(timer));};
const channel=process.platform==='linux'?'chrome':process.platform==='win32'?'msedge':undefined;
test.before(async()=>{
  server=await chromium.launchServer({headless:true,chromiumSandbox:true,...(channel?{channel}:{}),timeout:25000,ignoreDefaultArgs:[...chromiumSwitches(false,channel),'--hide-scrollbars','--mute-audio','--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4']});
  const launched=server.process();
  launched.on('exit',(code,signal)=>recordClose('process-exit',{code,signal}));
  launched.on('close',(code,signal)=>recordClose('process-close',{code,signal}));
  server.on('close',(code,signal)=>recordClose('browser-server-close-event',{code,signal}));
  assert(!server.process().spawnargs.some(arg=>/^--(?:no-sandbox|disable-setuid-sandbox|disable-web-security|disable-gpu|ignore-gpu-blocklist|use-angle|use-gl|enable-unsafe-swiftshader|disable-features|disable-hang-monitor)(?:=|$)/.test(arg)));
  browser=await chromium.connect(server.wsEndpoint(),{timeout:10000});await inventory();
  console.log(JSON.stringify({kind:'bounty-hud-dom-owned-start',helperPid:process.pid,browserPid:server.process().pid,channel,sandbox:true,securityAndGpuDefaultsPreserved:true}));
},{timeout:45000});
// Cleanup is separate from every unchanged30s UI assertion. Playwright's public
// server.close has its own30s closeOrKill budget and awaits profile cleanup after
// process exit; a client obtained by connect only disconnects on browser.close.
test.after(async()=>{let failure,clientDisconnected=false,serverClosed=false,preFallback=null;
  try{await inventory();}catch(error){failure=error;recordClose('inventory-failed',{message:String(error.message).slice(0,300)});}
  try{if(browser){recordClose('client-disconnect-requested');await bounded(browser.close(),5000);clientDisconnected=true;recordClose('client-disconnect-returned');}}
  catch(error){failure??=error;recordClose('client-disconnect-failed',{message:String(error.message).slice(0,300)});}
  try{if(server){recordClose('server-close-requested');await bounded(server.close(),30000);serverClosed=true;recordClose('server-close-returned');}}
  catch(error){failure??=error;preFallback={at:performance.now(),exitCode:server?.process()?.exitCode??null,
    signalCode:server?.process()?.signalCode??null,pidState:server?.process()?.pid?present(server.process().pid):'missing'};
    recordClose('server-close-failed-before-fallback',{...preFallback,message:String(error.message).slice(0,300)});
    killUsed=true;recordClose('owned-fallback-kill-requested');
    try{await bounded(server.kill(),5000);recordClose('owned-fallback-kill-returned');}
    catch(killError){failure??=killError;recordClose('owned-fallback-kill-failed',{message:String(killError.message).slice(0,300)});}
  }
  const until=Date.now()+5000;let remaining=[...owned].filter(pid=>present(pid)!==false);
  while(remaining.length&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,100));remaining=remaining.filter(pid=>present(pid)!==false);}
  const allAbsent=owned.size>0&&remaining.length===0,exitCode=server?.process()?.exitCode;
  console.log(JSON.stringify({kind:'bounty-hud-dom-owned-closed',helperPid:process.pid,ownedPids:[...owned],clientDisconnected,serverClosed,exitCode,killUsed,allAbsent,remaining,preFallback,closeEvents}));
  assert(clientDisconnected&&serverClosed&&!killUsed&&allAbsent&&exitCode===0,'Owned DOM browser must close normally with every observed PID absent');if(failure)throw failure;
},{timeout:60000});

async function fixture(t,{width=1280,coarse=false}={}){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:coarse});t.after(()=>bounded(context.close(),5000));
  const page=await context.newPage(),requests=[],errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+shellCSS+'\n'+rtsCSS+'</style><body><div id="hud">'+hudMarkup+'</div></body>');
  await page.addScriptTag({content:`const $=id=>document.getElementById(id);${stateCode}\n${loreCSSCode}\n${layoutCode}\n${pathCode}\n${standaloneCode}
    const style=document.createElement('style');style.id='actual-lore-css';style.textContent=LORE_CSS;document.head.appendChild(style);
    buildPathHud();renderStandaloneBounty();
    window.view={GAME,LORE,render(){renderPathHud();renderStandaloneBounty();},layout(){HUDL.k=0;hudLayout(.25);},
      chooseOther(){selectedStep={id:'other',title:'Explore',short:'Explore',hint:()=> 'Explore',meter:()=>[.25,'1 of 4']};},
      chooseBounty(){selectedStep=PATH_STEPS[0];},
      state(){const shown=el=>!!el&&!el.closest('[hidden]')&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden'&&el.getClientRects().length>0;
        const path=$('lore-path'),meter=path.querySelector('.step > .meter'),card=$('bounty');
        return{path:shown(path),meter:shown(meter),card:shown(card),marked:path.hasAttribute('data-bounty-progress'),
          counts:{path:meter?.textContent||'',card:card.textContent},earned:JSON.stringify(GAME.prog),
          classes:path.className,display:getComputedStyle(card).display};}};
  `});
  return{page,requests,errors};
}
const state=page=>page.evaluate(()=>view.state());
const noErrors=f=>{assert.deepEqual(f.errors,[]);assert.deepEqual(f.requests,[]);};

test('expanded active bounty has one counter; actual fold/unfold and other objective preserve the alternative card',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f,original=await state(page);assert(original.meter&&!original.card&&original.marked);assert.match(original.counts.path,/2 \/ 6 slain/);
  await page.locator('#lore-path [data-act="min"]').click();let s=await state(page);assert(!s.meter&&s.card&&!s.marked);assert.equal(s.earned,original.earned);
  await page.locator('#lore-path [data-act="max"]').click();s=await state(page);assert(s.meter&&!s.card&&s.marked);
  await page.evaluate(()=>{view.chooseOther();view.render();});s=await state(page);assert(s.meter&&s.card&&!s.marked);assert.match(s.counts.card,/2 \/ 6/);assert.equal(s.earned,original.earned);noErrors(f);
});
test('compact/off/hidden path states restore the ordinary card and restore suppression when cleared',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f;
  for(const cls of['hl-compact','hl-off']){
    await page.evaluate(cls=>$('lore-path').classList.add(cls),cls);let s=await state(page);assert(!s.meter&&s.card,cls);
    await page.evaluate(cls=>$('lore-path').classList.remove(cls),cls);s=await state(page);assert(s.meter&&!s.card,cls+' cleared');
  }
  await page.evaluate(()=>$('lore-path').hidden=true);assert((await state(page)).card);
  await page.evaluate(()=>$('lore-path').hidden=false);assert(!(await state(page)).card);noErrors(f);
});
test('completed/no active bounty never reuses the active-path suppression marker',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f;
  await page.evaluate(()=>{view.GAME.prog.bounty.done=true;view.render();});let s=await state(page);assert(!s.marked&&!s.meter&&s.card);assert.match(s.counts.card,/return to the herald/);
  await page.evaluate(()=>{view.GAME.prog.bounty=null;view.render();});s=await state(page);assert(!s.marked&&!s.card&&!s.meter);noErrors(f);
});
for(const options of[{width:700},{width:1280,coarse:true}])test('target-only hiding restores bounty in the actual narrow/coarse media rule '+JSON.stringify(options),{timeout:30000},async t=>{
  const f=await fixture(t,options),{page}=f;
  assert(await page.evaluate(()=>matchMedia('(max-width: 760px), (pointer: coarse)').matches));
  await page.evaluate(()=>$('tf').hidden=false);let s=await state(page);assert(!s.path&&!s.meter&&s.card);
  await page.evaluate(()=>$('bounty').classList.add('hl-off'));s=await state(page);assert(!s.path&&!s.card,'target restoration must not override hl-off');
  await page.evaluate(()=>$('bounty').classList.remove('hl-off'));assert((await state(page)).card);
  await page.evaluate(()=>$('tf').hidden=true);s=await state(page);assert(s.meter&&!s.card);noErrors(f);
});
test('wide target alone keeps the meter; RTS mode restores card while the actual RTS CSS hides the path',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f;await page.evaluate(()=>$('tf').hidden=false);let s=await state(page);assert(s.meter&&!s.card);
  await page.evaluate(()=>document.body.classList.add('throne-rts-open'));s=await state(page);assert(!s.meter&&s.card);
  await page.evaluate(()=>document.body.classList.remove('throne-rts-open'));s=await state(page);assert(s.meter&&!s.card);noErrors(f);
});
test('touch world/tray contents and HUD-hidden boundary preserve existing visibility',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f;
  await page.evaluate(()=>document.body.classList.add('touch'));let s=await state(page);assert(!s.meter&&!s.card);
  await page.evaluate(()=>{const tray=document.createElement('div');tray.id='mobile-tray';document.body.appendChild(tray);tray.appendChild($('bounty'));});
  s=await state(page);assert(s.card&&!s.meter);assert.match(s.counts.card,/2 \/ 6/);
  await page.evaluate(()=>{$('hud').appendChild($('bounty'));document.body.classList.remove('touch');$('hud').hidden=true;});s=await state(page);assert(!s.meter&&!s.card);noErrors(f);
});
test('absence of has selector rules safely retains duplication (unsupported-parser emulation, not a legacy browser claim)',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f;
  await page.evaluate(()=>{const removeUnsupported=sheet=>{for(let i=sheet.cssRules.length-1;i>=0;i--){const rule=sheet.cssRules[i];if(rule.selectorText?.includes(':has('))sheet.deleteRule(i);else if(rule.cssRules)removeUnsupported(rule);}};removeUnsupported($('actual-lore-css').sheet);});
  const s=await state(page);assert(s.meter&&s.card);noErrors(f);
});
test('ordinary layout resets settle without bounty/path feedback or stronger-than-hl-off suppression',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f;const states=await page.evaluate(()=>Array.from({length:8},()=>{view.layout();return view.state();}));
  assert(states.every(s=>s.meter&&!s.card));assert(states.every(s=>s.classes===states[0].classes));
  await page.evaluate(()=>{$('lore-path').classList.add('hl-compact');$('bounty').classList.add('hl-off');});const s=await state(page);assert(!s.meter&&!s.card,'original layout may hide both when no space; new CSS cannot override hl-off');noErrors(f);
});

test('the actual meter descendant is required even when a stale marker is present',{timeout:30000},async t=>{
  const f=await fixture(t),{page}=f;await page.evaluate(()=>$('lore-path').querySelector('.step > .meter').remove());
  const s=await state(page);assert(s.marked&&!s.meter&&s.card);noErrors(f);
});
