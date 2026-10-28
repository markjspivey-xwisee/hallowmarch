/** Actual menu/modal handlers with synthetic saves; never calls a save or identity service. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../node_modules/playwright/index.mjs';

const read = name => readFile(new URL('../../' + name, import.meta.url), 'utf8');
const [ui, mobile, shell] = await Promise.all([read('src/10_ui.js'), read('src/10q_mobile.js'), read('src/page.html')]);
const menu = ui.slice(ui.indexOf('let menuReturnFocus = null;'), ui.indexOf('function uiDeath('));
const backdrop = ui.slice(ui.indexOf('function bgClose('), ui.indexOf('let mapReturnFocus = null;'));
const dialog = ui.slice(ui.indexOf('let dialogReturnFocus = null;'));
const menuMarkup = shell.slice(shell.indexOf('<div class="overlay" id="menu"'), shell.indexOf('<div class="overlay" id="kit"'));
const dialogMarkup = shell.slice(shell.indexOf('<div class="overlay" id="dialog"'), shell.indexOf('<div id="fade"'));
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

async function fixture(t) {
  const page = await browser.newPage({ viewport: { width: 390, height: 850 } });
  t.after(() => page.close());
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent(`<!doctype html><style>
    [hidden]{display:none!important}body{font:16px system-ui}button,summary{min-height:44px}
    .overlay{padding:12px;border:1px solid #555}.acts{display:flex;gap:12px}
  </style><div id="hud"><button id="btn-menu">Game menu</button><button id="talk">Talk</button></div>
    ${menuMarkup}${dialogMarkup}
    <div id="kit" hidden><button id="kit-first">First item</button><button id="kit-last">Close inventory</button></div>
    <div id="mapov" hidden><button id="map-first">First map action</button><button id="map-last">Close map</button></div>
    <div id="death" hidden><button id="death-first">Accept prayer</button><button id="death-last">Release</button></div>
    <button id="outside">Outside modal</button>`);
  await page.addScriptTag({ content: `
    window.__calls={replacement:0,inputCancelled:0};
    window.$=id=>document.getElementById(id);
    window.UI={modal:null,menuTab:null,confirmNew:false};
    window.GAME={player:{name:'Fixture hero',cls:'warrior',faction:0},
      prog:{rp:0,played:0,level:1,kills:0,realmKills:0,deaths:0}};
    window.__originalPlayer=GAME.player;window.__originalRef={id:'save-owner-a'};
    window.SAVE={ref:__originalRef,loading:{settled:true},pending:null,nativeFlight:null,wiping:false};
    window.NATIVE_PLAYER={busy:false,switching:false};window.IS_TOUCH=false;
    window.CLASSES={warrior:{name:'Warrior'}};window.REALMS=[{name:'Logres'}];
    window.RANK_TITLES=['Recruit'];window.REALM_RANKS=[0,100];
    window.realmRank=()=>1;window.late2Named=player=>player.name;window.fmtInt=String;
    window.esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.late2CharStats=()=>'';window.gsCharHTML=()=>'';window.gsCharWire=()=>{};
    window.guideHelpHTML=()=>'<p>How to play</p>';
    window.renderChronicle=body=>{body.innerHTML='<h3>Your path</h3><p>Your next step.</p>';};
    window.marchConsultingRender=()=>{ $('march-coach-mount').innerHTML='<button id="path-fixture">Continue your path</button>'; };
    window.newCharacter=()=>{__calls.replacement++;};
    window.cancelPlayerInput=()=>{__calls.inputCancelled++;};
  ` });
  await page.addScriptTag({ content: backdrop + '\n' + menu + '\n' + dialog + '\n' + mobile + '\nmobileBind();' });
  await page.locator('#btn-menu').focus();
  await page.evaluate(() => openMenu('char'));
  t.after(async () => { assert.deepEqual(errors, []); assert.deepEqual(requests, []); });
  return page;
}
async function confirmation(page) {
  await page.locator('.menu-options > summary').click();
  await page.locator('#btn-newchar').click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-new-cancel');
}
const calls = page => page.evaluate(() => __calls.replacement);

test('settled loading allows an explicit replacement while Keep preserves character and returns focus', async t => {
  const page = await fixture(t);
  await confirmation(page);
  assert.equal(await page.locator('#menu-new-confirm').isEnabled(), true);
  assert.equal(await page.locator('#menu-new-status').isVisible(), false);
  assert.equal(await calls(page), 0);
  await page.locator('#menu-new-cancel').click();
  assert.equal(await page.evaluate(() => GAME.player === __originalPlayer && SAVE.ref === __originalRef && !UI.confirmNew), true);
  assert.equal(await page.locator('.menu-options').evaluate(node => node.open), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'btn-newchar');
  await page.locator('#btn-newchar').click();
  await page.locator('#menu-new-confirm').click();
  assert.equal(await calls(page), 1);
  assert.equal(await page.locator('#menu').isVisible(), false);
  assert.equal(await page.evaluate(() => UI.confirmNew === false), true);
});

test('pending save settles in place without replacing controls or disturbing the safe default focus', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { SAVE.pending={operation:'fixture'}; });
  await confirmation(page);
  assert.equal(await page.locator('#menu-new-confirm').isDisabled(), true);
  await page.evaluate(() => {
    window.__keptButton=$('menu-new-cancel');window.__replaceButton=$('menu-new-confirm');
    SAVE.pending=null;menuReplacementSync();
  });
  assert.equal(await page.locator('#menu-new-confirm').isEnabled(), true);
  assert.equal(await page.locator('#menu-new-status').isVisible(), false);
  assert.equal(await page.evaluate(() => $('menu-new-cancel')===__keptButton && $('menu-new-confirm')===__replaceButton && document.activeElement===__keptButton), true);
  assert.equal(await calls(page), 0);
});

for (const field of ['pending', 'nativeFlight', 'wiping', 'loading', 'busy', 'switching']) {
  test(`${field} beginning after confirmation safely refuses the click and updates its explanation`, async t => {
    const page = await fixture(t);
    await confirmation(page);
    await page.evaluate(field => {
      if (field==='busy'||field==='switching') NATIVE_PLAYER[field]=true;
      else SAVE[field]=field==='loading'?{settled:false}:field==='wiping'?true:{operation:'fixture'};
    }, field);
    // Deliberately click before the next HUD synchronization: the click guard must also protect this race.
    await page.locator('#menu-new-confirm').click();
    assert.equal(await calls(page), 0);
    assert.equal(await page.locator('#menu-new-confirm').isDisabled(), true);
    assert.match(await page.locator('#menu-new-status').innerText(), /still pending/);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-new-cancel');
    assert.equal(await page.evaluate(() => GAME.player===__originalPlayer && UI.confirmNew.player===__originalPlayer), true);
    await page.evaluate(field => {
      if (field==='busy'||field==='switching') NATIVE_PLAYER[field]=false;
      else SAVE[field]=field==='loading'?{settled:true}:field==='wiping'?false:null;
      menuReplacementSync();
    }, field);
    assert.equal(await page.locator('#menu-new-confirm').isEnabled(), true);
  });
}

for (const changed of ['player', 'ref']) test(`${changed} change after rendering refuses replacement and leaves an available recovery`, async t => {
  const page = await fixture(t);
  await confirmation(page);
  await page.evaluate(changed => {
    if (changed==='player') GAME.player={...GAME.player,name:'Other fixture hero'};
    else SAVE.ref={id:'save-owner-b'};
    menuReplacementSync();
  }, changed);
  assert.equal(await page.locator('#menu-new-confirm').isDisabled(), true);
  assert.match(await page.locator('#menu-new-status').innerText(), /connection changed/);
  assert.equal(await page.locator('#menu-new-cancel').isEnabled(), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-new-cancel');
  await page.locator('#menu-new-cancel').click();
  assert.equal(await calls(page), 0);
  assert.equal(await page.evaluate(() => !UI.confirmNew && document.activeElement.id==='btn-newchar'), true);
});

test('a changed save reference is also refused before the next synchronization', async t => {
  const page = await fixture(t);
  await confirmation(page);
  await page.evaluate(() => { SAVE.ref={id:'save-owner-b'}; });
  await page.locator('#menu-new-confirm').click();
  assert.equal(await calls(page), 0);
  assert.equal(await page.locator('#menu').isVisible(), true);
  assert.equal(await page.locator('#menu-new-confirm').isDisabled(), true);
  assert.match(await page.locator('#menu-new-status').innerText(), /connection changed/);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-new-cancel');
});

test('programmatic content navigation focuses the selected destination tab and clears stale replacement consent', async t => {
  const page = await fixture(t);
  await confirmation(page);
  await page.evaluate(() => renderMenu('progress'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-tab-progress');
  assert.equal(await page.evaluate(() => UI.confirmNew), false);
  await page.locator('#path-fixture').focus();
  await page.evaluate(() => renderMenu('chronicle'));
  assert.equal(await page.evaluate(() => document.activeElement.id), 'menu-tab-chronicle');
  assert.equal(await page.locator('#menu-body').getAttribute('aria-labelledby'), 'menu-tab-chronicle');
});

test('NPC dialog opens at its heading, traps keyboard focus, and returns to its invoker', async t => {
  const page = await fixture(t);
  await page.evaluate(() => closeMenu());
  await page.locator('#talk').focus();
  await page.evaluate(() => {
    UI.modal='dialog';$('dialog').hidden=false;$('dlg-title').textContent='Fixture herald';
    $('dlg-actions').innerHTML='<button id="dialog-first">Ask for work</button><button id="dialog-last">Farewell</button>';
  });
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dlg-title');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-first');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-last');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'dialog-first');
  await page.evaluate(() => closeDialog());
  assert.equal(await page.evaluate(() => document.activeElement.id), 'talk');
});

for (const modal of ['kit', 'map', 'death']) test(`${modal} traps focus on keyboard desktop, including entry from outside the modal`, async t => {
  const page = await fixture(t);
  await page.evaluate(modal => {
    closeMenu();UI.modal=modal;$(modal==='map'?'mapov':modal).hidden=false;
    $('outside').focus();
  }, modal);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), modal+'-first');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), modal+'-last');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), modal+'-first');
});
