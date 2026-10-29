/** Actual menu edit handlers and save queue with local synthetic backends; no 3D context. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {chromium} from '../node_modules/playwright/index.mjs';

const read=name=>readFileSync(new URL('../../src/'+name,import.meta.url),'utf8');
const ui=read('10_ui.js'),lore=read('10c_lore.js'),sound=read('11c_sound.js'),save=read('12_save.js'),shell=read('page.html');
function declarations(source,names) {
  const nodes=parse(source,{ecmaVersion:'latest'}).body;
  return names.map(name=>{const node=nodes.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name||n.type==='VariableDeclaration'&&n.declarations.some(d=>d.id.name===name));assert(node,name);return source.slice(node.start,node.end);}).join('\n');
}
const saveNames=['SAVE','SAVE_MENU_REQUESTS','readLocal','saveSoon','saveMenuEditOwned','saveMenuEdit','nativeSavePending','saveNow'];
const saveCode=declarations(save,saveNames.filter(name=>save.includes('function '+name+'(')||save.includes('const '+name+' =')));
const menuCode=declarations(ui,['menuSettingsChoices','renderMenu']);
const pathCode=declarations(lore,['pathTrack']);
const soundCode=declarations(sound,['soundSettingsHTML','soundSettingsWire']);
const at=lore.indexOf("$('menu-body').addEventListener('click', (e) => {");
const trackHandler=lore.slice(at,lore.indexOf('\n});',at)+4);
const markup=shell.slice(shell.indexOf('<div class="overlay" id="menu"'),shell.indexOf('<div class="overlay" id="kit"'));
const style=[...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
let browser;
test.before(async()=>{browser=await chromium.launch({headless:true,args:['--disable-gpu']});});
test.after(async()=>{await browser?.close();});

async function fixture(t,mode) {
  const page=await browser.newPage({viewport:{width:390,height:780}});page.setDefaultTimeout(5000);t.after(()=>page.close());
  const errors=[],requests=[];let remote=null,writes=0;
  page.on('pageerror',error=>errors.push(error.message));
  const document=()=>`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style>${markup}
    <script>
    ${saveCode}
    const $=id=>window.document.getElementById(id), IS_TOUCH=false, CAPTURE={on:false};
    const UI={modal:'menu',menuTab:'settings'}, NETWS={host:'fixture',acct:{id:'same-owner'},reload:false};
    const NATIVE_PLAYER={profile:${mode==='native'?'{}':'null'},status:{verified:${mode==='native'}},state:'ready'};
    SAVE.native=${mode==='native'};SAVE.readConfirmed=SAVE.native;SAVE.server=${mode==='legacy'};
    const initial=${JSON.stringify(remote)};
    const restored=SAVE.native?initial:readLocal();
    const GAME={ready:true,started:true,player:{name:'Menu fixture',cls:'warrior',faction:0},prog:{level:1,xp:7,rp:0,lore:{done:[],...(restored?.char?.lore||{})}}};
    const quality={level:restored?.settings?.quality||'low'}, tod={mode:'cycle'},WEATHER={mode:'auto'},MOTION_MODE='system',REDUCE_MOTION=false;
    const QUALITY_PRESETS={low:{label:'Low'},medium:{label:'Medium'},high:{label:'High'}};
    const MUSIC_LEVELS=[['off','Off',0],['high','High',1]], SOUND_LEVELS=[['off','Off',0],['low','Low',.5],['high','High',1]];
    const SOUND_ROWS=[['set-s','Volume','master'],['set-fx','Effects','sfx'],['set-amb','Ambience','amb']];
    const AUDIO={on:true,lvl:{master:1,sfx:restored?.settings?.effects??1,amb:1}};
    const NET_HUMAN_PLAY={activity:0,acceptedAt:null}, GUIDE={},G2={},LORE={chronSec:'path'},PATH_BY_ID={cook:{}};
    const netHumanLive=()=>false, nativePlayerIsProvisional=()=>false;
    function nativePlayerRender(){} function nativePlayerError(code){return Object.assign(Error(code),{code});}
    function coreKey(value){return JSON.stringify(value);}
    function buildSave(){return {v:1,char:{v:1,name:GAME.player.name,realm:0,cls:'warrior',level:1,xp:GAME.prog.xp,rp:0,lore:structuredClone(GAME.prog.lore)},settings:{quality:quality.level,effects:AUDIO.lvl.sfx}};}
    SAVE.ref=${mode==='local'?'null':mode==='legacy'?"{set:async()=>{throw {code:'unavailable'};}}":"{set:async body=>{const r=await fetch('/checkpoint',{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw {code:'unavailable'};}}"};
    const setQuality=value=>{quality.level=value;},setTimeMode=value=>{tod.mode=value;},setWeatherMode=value=>{WEATHER.mode=value;},setMusicVolume=()=>{};
    const musicLevelKey=()=> 'high',captureSettingsHTML=()=>'',captureSettingsWire=()=>{};
    const soundLevelKey=value=>SOUND_LEVELS.find(row=>row[2]===value)?.[0]||'high',soundVolumeKey=()=> 'high';
    const setSoundLevel=(kind,value)=>{AUDIO.lvl[kind]=value;},sfx=()=>{};
    const pathDone=id=>GAME.prog.lore.done.includes(id),guideUpdateMark=()=>{},g2UpdatePointer=()=>{},renderPathHud=()=>{};
    function renderChronicle(body){body.innerHTML='<h3>Your path</h3><button type="button" class="btn" data-lore="track:cook">Track: Cook a meal</button><li class="cur" tabindex="-1">'+(GAME.prog.lore.track||'herald')+'</li>';}
    ${menuCode}
    ${pathCode}
    ${soundCode}
    ${trackHandler}
    $('menu-tab-settings').onclick=()=>renderMenu('settings');
    $('menu-tab-chronicle').onclick=()=>{UI.menuTab='chronicle';renderChronicle($('menu-body'));};
    $('menu').hidden=false;renderMenu('settings');
    window.menuFixture={snapshot:()=>buildSave(),state:()=>({modal:UI.modal,live:netHumanLive(),activity:NET_HUMAN_PLAY.activity,pending:!!SAVE.pending,nativeFlight:!!SAVE.nativeFlight}),saved:()=>readLocal()};
    </script>`;
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!=='http://menu-save.test'){requests.push(url.href);return route.abort();}
    if(url.pathname==='/checkpoint'&&route.request().method()==='POST') {remote=JSON.parse(route.request().postData());writes++;return route.fulfill({contentType:'application/json',body:'{}'});}
    return route.fulfill({contentType:'text/html',body:document()});
  });
  await page.goto('http://menu-save.test/');
  return {page,errors,requests,remote:()=>remote,writes:()=>writes};
}

for(const mode of ['local','legacy','native'])test(`trusted objective and settings edits survive direct open-menu reload with ${mode} storage`,async t=>{
  const f=await fixture(t,mode),{page}=f;
  const before=await page.evaluate(()=>({xp:menuFixture.snapshot().char.xp,done:menuFixture.snapshot().char.lore.done}));
  await page.locator('#set-q [data-v="high"]').click();
  await page.locator('#set-fx [data-v="low"]').click();
  await page.locator('#menu-tab-chronicle').click();
  await page.locator('[data-lore="track:cook"]').click();
  await page.waitForFunction(()=>{const state=menuFixture.state();return !state.pending&&!state.nativeFlight;});
  const snapshot=mode==='native'?f.remote():await page.evaluate(()=>menuFixture.saved());
  assert(snapshot,'The real menu handlers must checkpoint their edited state while the menu stays open.');
  assert.equal(snapshot.settings.quality,'high');assert.equal(snapshot.settings.effects,.5);assert.equal(snapshot.char.lore.track,'cook');
  assert.equal(snapshot.char.xp,before.xp);assert.deepEqual(snapshot.char.lore.done,before.done);
  assert.deepEqual(await page.evaluate(()=>menuFixture.state()),{modal:'menu',live:false,activity:0,pending:false,nativeFlight:false});
  if(mode==='native'){assert(f.writes()>0);assert.equal(await page.evaluate(()=>localStorage.length),0);}
  // A script-generated click may change the local control but cannot authorize a checkpoint.
  await page.locator('#menu-tab-settings').click();
  await page.evaluate(()=>$('set-q').querySelector('[data-v="medium"]').click());
  await page.reload({waitUntil:'domcontentloaded'});
  const loaded=await page.evaluate(()=>menuFixture.snapshot());
  assert.equal(loaded.settings.quality,'high');assert.equal(loaded.settings.effects,.5);assert.equal(loaded.char.lore.track,'cook');
  assert.equal(await page.locator('#set-q [data-v="high"]').getAttribute('aria-checked'),'true');
  assert.deepEqual(f.errors,[]);assert.deepEqual(f.requests,[]);
});
