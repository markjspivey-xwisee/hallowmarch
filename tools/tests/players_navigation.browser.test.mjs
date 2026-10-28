/** Real Players/chat handlers and game CSS; all identities, peers and transport calls are local fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../node_modules/playwright/index.mjs';
const read = name => readFile(new URL('../../' + name, import.meta.url), 'utf8');
const [playersSource, mobile, network, shell] = await Promise.all([
  read('src/14o_netui.js'), read('src/10q_mobile.js'), read('src/14n_net.js'), read('src/page.html')]);
const players = playersSource.split('Object.assign(FIELD_NOTES,')[0];
const peerLeft = network.slice(network.indexOf('function netPeerLeft('), network.indexOf('const netSize ='));
const connected = network.match(/^const netOn =.*$/m)[0];
const styles = shell.match(/<style>([\s\S]*?)<\/style>/)[1];
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function fixture(t, width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  t.after(() => page.close());
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}
    #hud{position:static;pointer-events:auto}#hud button{pointer-events:auto}#log{display:none}
  </style><body class="touch"><div id="hud"><div><button id="btn-map">Map</button><button id="btn-menu">Game menu</button></div></div><div id="log"></div></body>`);
  await page.addScriptTag({ content: `
    window.$=id=>document.getElementById(id);window.IS_TOUCH=false;
    window.__connected=true;window.__packets=[];window.__errors=[];
    window.GAME={started:true,player:{name:'Fixture hero',faction:0,x:0,y:0,z:0}};
    window.UI={modal:null,frame:32};window.INPUT={keys:new Set()};window.BUILD={mode:false};
    window.NET={state:'on',link:{kind:'ws',connected:()=>__connected},peers:new Map(),party:'',invites:[],partyMax:6,
      stats:{chatOut:0,chatIn:0},host:'',self:'self'};
    window.NETWS={state:'on',worldPauseReason:'',acct:{id:'fixture-account',name:'Fixture account',guest:true},
      host:'game.example',worldRoom:'fixture-room',link:{kind:'ws'}};
    window.NATIVE_PLAYER={status:null};window.REALMS=[{name:'Logres',color:'#a33',light:'#faa'}];
    window.CLASSES={warrior:{name:'Warrior'}};
    window.__HM_GAMING={mainWorldAgents:{enabled:true}};
    window.typing=()=>['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    window.gameplayKeyIgnored=()=>false;window.gameplayControlKey=()=>false;
    window.cancelPlayerInput=()=>{};window.uiLog=()=>{};window.uiToast=()=>{};window.sfx=()=>{};
    window.uiError=text=>__errors.push(text);window.netStr=(text,n)=>typeof text==='string'?text.trim().slice(0,n):'';
    window.netEvent=(...packet)=>__packets.push(structuredClone(packet));
    window.netStubId=()=> 'fixtureparty';window.netCompanionDrop=()=>{};window.netGhostDrop=()=>{};
    window.dist=(x,z,px,pz)=>Math.hypot(x-px,z-pz);window.screenOf=()=>null;
    window.closeMenu=()=>{UI.modal=null};window.openCompanion=()=>{};window.openMenu=()=>{};
    window.nativePlayerRender=()=>{
      const box=$('netsheet-acct');if(box&&!box.querySelector('.native-player')){
        const section=document.createElement('section');section.className='native-player';
        section.innerHTML='<input aria-label="Fixture recovery phrase" value="" type="password">';box.appendChild(section);
      }
    };
    window.__peer=(id,name)=>({peer:id,slow:{on:1,dn:name,n:name,r:0,c:'warrior',l:2,pt:''},fast:null});
  ` });
  await page.addScriptTag({ content: connected + '\n' + players + '\n' + peerLeft + '\n' + mobile + `
    netUiOn();mobileBind();$('btn-net').hidden=false;
    window.__tick=()=>{NETUI.rosterAt=0;UI.frame=32;netUiFrame()};
    const outside=document.createElement('button');outside.id='after-sheet';outside.textContent='Outside sheet';document.body.append(outside);
  ` });
  t.after(async () => { assert.deepEqual(errors, []); assert.deepEqual(requests, []); });
  return page;
}
const packets = page => page.evaluate(() => __packets);
async function open(page) { await page.locator('#btn-net').click(); }
async function chat(page, channel = 'r') { await page.evaluate(channel => netChatOpen(channel), channel); }

test('Players has one return action, starts inside its modal, traps Tab and returns to its invoker', async t => {
  const page = await fixture(t);
  await open(page);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'netsheet-close');
  assert.equal(await page.locator('#netsheet [role=dialog]').getAttribute('aria-modal'), 'true');
  await page.locator('#netsheet [data-act=say]').focus();
  // The account section follows Chat, so exercise the actual last focusable input.
  await page.locator('#netsheet .native-player input').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'netsheet-close');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Fixture recovery phrase');
  await page.locator('#netsheet-close').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-net');
  assert.equal(await page.evaluate(() => UI.modal), null);
  assert.deepEqual(await packets(page), []);
});

test('Escape closes Players while a recovery field is focused without clearing its text', async t => {
  const page = await fixture(t);
  await open(page);
  const recovery = page.locator('#netsheet .native-player input');
  await recovery.fill('fixture recovery text');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#netsheet').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-net');
  await open(page);
  assert.equal(await recovery.inputValue(), 'fixture recovery text');
});

test('roster joins and departures refresh through the existing frame loop and remove obsolete Invite controls', async t => {
  const page = await fixture(t);
  await page.evaluate(() => NET.peers.set('ally-a', __peer('ally-a', 'Fixture ally A')));
  await open(page);
  await page.locator('[data-act=inv][data-peer=ally-a]').focus();
  await page.evaluate(() => { netPeerLeft('ally-a');NET.peers.set('ally-b',__peer('ally-b','Fixture ally B'));__tick(); });
  assert.equal(await page.locator('[data-act=inv][data-peer=ally-a]').count(), 0);
  assert.equal(await page.locator('[data-act=inv][data-peer=ally-b]').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'netsheet-close');
  assert.equal(await page.locator('#netsheet-body').innerText().then(text => text.includes('Fixture ally A')), false);
  await page.evaluate(() => {window.__unchangedBody=$('netsheet-body').firstChild;__tick()});
  assert.equal(await page.evaluate(() => $('netsheet-body').firstChild===__unchangedBody), true, 'unchanged roster does not rebuild controls');
  assert.deepEqual(await packets(page), []);
});

test('incoming chat redraw preserves the exact social action and account/recovery input values', async t => {
  const page = await fixture(t);
  await page.evaluate(() => NET.peers.set('ally-a',__peer('ally-a','Fixture ally A')));
  await open(page);
  await page.locator('#netacct-name').fill('fixture name');await page.locator('#netacct-pass').fill('fixture password');
  await page.locator('#netsheet .native-player input').fill('fixture recovery text');
  await page.locator('[data-act=inv][data-peer=ally-a]').focus();
  await page.evaluate(() => netChatShow('Fixture sender',0,'r','Received locally in the fixture',null));
  assert.equal(await page.evaluate(() => document.activeElement.dataset.act+':'+document.activeElement.dataset.peer), 'inv:ally-a');
  assert.equal(await page.locator('#netacct-name').inputValue(), 'fixture name');
  assert.equal(await page.locator('#netacct-pass').inputValue(), 'fixture password');
  assert.equal(await page.locator('#netsheet .native-player input').inputValue(), 'fixture recovery text');
  await page.locator('#netsheet .native-player input').focus();
  await page.evaluate(() => netChatShow('Fixture sender',0,'r','Another fixture message',null));
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Fixture recovery phrase');
  assert.deepEqual(await packets(page), []);
});

test('failed disconnected send retains its draft, reconnection sends nothing, and explicit retry sends exactly once', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {__connected=false;NETUI.sayAt=-2000});
  await chat(page);await page.locator('#netchat-in').fill('Unsent fixture message');
  await page.locator('#netchat-go').click();
  assert.equal(await page.locator('#netchat').isVisible(), true);
  assert.equal(await page.locator('#netchat-in').inputValue(), 'Unsent fixture message');
  assert.match(await page.locator('#netchat-status').innerText(), /Not sent.*disconnected/);
  assert.deepEqual(await packets(page), []);
  await page.evaluate(() => {__connected=true;__tick()});
  assert.deepEqual(await packets(page), []);
  assert.match(await page.locator('#netchat-status').innerText(), /draft has not been sent/);
  await page.locator('#netchat-go').click();
  assert.deepEqual(await packets(page), [['say',0,['r','Unsent fixture message','']]]);
  assert.equal(await page.locator('#netchat').isVisible(), false);
  await chat(page);assert.equal(await page.locator('#netchat-in').inputValue(), '');
});

test('Escape and explicit Close retain unsent text only for the same audience', async t => {
  const page = await fixture(t);
  await page.locator('#btn-menu').focus();await chat(page);
  await page.locator('#netchat-in').fill('Realm draft');await page.keyboard.press('Escape');
  assert.equal(await page.locator('#netchat').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-menu');
  await chat(page);assert.equal(await page.locator('#netchat-in').inputValue(), 'Realm draft');
  await page.locator('#netchat-close').click();await chat(page);
  assert.equal(await page.locator('#netchat-in').inputValue(), 'Realm draft');
  assert.deepEqual(await packets(page), []);
});

for (const marker of ['isComposing','legacy229']) for (const key of ['Enter','Escape']) {
  test(`${marker} ${key} leaves a composing draft open, unchanged and unsent`, async t => {
    const page = await fixture(t);
    await page.evaluate(() => { NETUI.sayAt=-2000; });
    await chat(page);await page.locator('#netchat-in').fill('Draft while composing');
    const untouched = await page.evaluate(({marker,key}) => {
      const event = new KeyboardEvent('keydown',{key,code:key,bubbles:true,cancelable:true,
        isComposing:marker==='isComposing',keyCode:marker==='legacy229'?229:key==='Enter'?13:27});
      $('netchat-in').dispatchEvent(event);
      return !event.defaultPrevented;
    },{marker,key});
    assert.equal(untouched,true,'the IME retains the composition key');
    assert.equal(await page.locator('#netchat').isVisible(),true);
    assert.equal(await page.locator('#netchat-in').inputValue(),'Draft while composing');
    assert.equal(await page.evaluate(() => document.activeElement.id),'netchat-in');
    assert.deepEqual(await packets(page),[]);
    // Once composition has ended, the same ordinary keyboard actions still work.
    await page.keyboard.press(key);
    assert.equal(await page.locator('#netchat').isVisible(),false);
    assert.deepEqual(await packets(page),key==='Enter'?[['say',0,['r','Draft while composing','']]]:[]);
  });
}

for (const marker of ['isComposing','legacy229']) test(`${marker} Escape also keeps Players and its focused recovery draft open`, async t => {
  const page = await fixture(t);await open(page);
  const recovery=page.locator('#netsheet .native-player input');await recovery.fill('Recovery draft while composing');
  await page.evaluate(marker => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true,
      isComposing:marker==='isComposing',keyCode:marker==='legacy229'?229:27}));
  },marker);
  assert.equal(await page.locator('#netsheet').isVisible(),true);
  assert.equal(await recovery.inputValue(),'Recovery draft while composing');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')),'Fixture recovery phrase');
  assert.deepEqual(await packets(page),[]);
});

test('realm and party channel switches never copy text into the other audience and party changes discard old party text', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {NET.party='partyalpha'});await chat(page);
  await page.locator('#netchat-in').fill('Realm-only draft');await page.locator('#netchat-ch').click();
  assert.equal(await page.locator('#netchat-ch').innerText(), 'Party');
  assert.equal(await page.locator('#netchat-in').inputValue(), '');
  await page.locator('#netchat-in').fill('Party-alpha draft');await page.locator('#netchat-ch').click();
  assert.equal(await page.locator('#netchat-in').inputValue(), 'Realm-only draft');
  await page.locator('#netchat-ch').click();assert.equal(await page.locator('#netchat-in').inputValue(), 'Party-alpha draft');
  await page.evaluate(() => {NET.party='partybravo';__tick()});
  assert.equal(await page.locator('#netchat').isVisible(), false);
  await chat(page,'p');assert.equal(await page.locator('#netchat-in').inputValue(), '');
  assert.deepEqual(await packets(page), []);
});

for (const scope of ['account','room','realm','player']) test(`${scope} change cannot send or reopen a previous audience's private draft`, async t => {
  const page = await fixture(t);
  await chat(page);await page.locator('#netchat-in').fill('Private fixture draft');
  await page.evaluate(scope => {
    if(scope==='account')NETWS.acct={...NETWS.acct,id:'different-fixture-account'};
    else if(scope==='room')NETWS.worldRoom='different-fixture-room';
    else if(scope==='realm')GAME.player.faction=1;
    else GAME.player={...GAME.player,name:'Different fixture hero'};
  }, scope);
  await page.locator('#netchat-go').click();
  assert.deepEqual(await packets(page), []);
  assert.equal(await page.locator('#netchat').isVisible(), false);
  assert.match(await page.evaluate(() => __errors.at(-1)), /audience changed/);
  await chat(page);assert.equal(await page.locator('#netchat-in').inputValue(), '');
});

test('disconnected party invitations are disabled and a click race cannot create or join a party', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {
    NET.peers.set('ally-a',__peer('ally-a','Fixture ally A'));
    NET.invites=[{peer:'ally-a',pt:'partyalpha'}];
  });
  await open(page);
  await page.evaluate(() => {__connected=false});
  // The action was enabled when rendered; the actual click guard must reject this race.
  await page.locator('[data-act=inv]').click();
  assert.equal(await page.evaluate(() => NET.party), '');
  assert.equal(await page.locator('[data-act=inv]').isDisabled(), true);
  assert.equal(await page.locator('[data-act=join]').isDisabled(), true);
  assert.match(await page.locator('#netsheet-body').innerText(), /Not connected/);
  assert.equal(await page.evaluate(() => netInviteAnswer('ally-a',true)), false);
  assert.equal(await page.evaluate(() => NET.invites.length), 1);
  assert.deepEqual(await packets(page), []);
});

for (const width of [320,390]) test(`Players and a retained failed draft fit at ${width}px, with one party-chat entry`, async t => {
  const page = await fixture(t,width);
  await page.evaluate(() => {NET.party='partyalpha';NET.peers.set('ally-a',__peer('ally-a','An exceptionally long fixture ally name'))});
  await open(page);
  assert.equal(await page.locator('#netsheet [data-act=say][data-ch=p]').count(),1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('#netsheet [data-act=say][data-ch=p]').click();
  await page.evaluate(() => {__connected=false});await page.locator('#netchat-in').fill('Unsent fixture message');
  await page.locator('#netchat-go').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
  const small = await page.locator('#netchat button:visible,#netchat input:visible').evaluateAll(nodes => nodes.filter(node=>node.getBoundingClientRect().height<44).map(node=>node.id));
  assert.deepEqual(small,[]);assert.deepEqual(await packets(page),[]);
});
