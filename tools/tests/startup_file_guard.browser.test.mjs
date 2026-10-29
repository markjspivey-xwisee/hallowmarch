import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from '../node_modules/playwright/index.mjs';

test('a real failed graphics dependency shows recovery and retry performs one normal reload',async()=>{
  const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  try {
    const page=await browser.newPage({viewport:{width:390,height:780}});
    let visits=0;
    const html=readFileSync(new URL('../../hallowmarch.html',import.meta.url),'utf8');
    await page.route('**/*',route=>{
      if(route.request().url()==='http://hm-file.test/') {visits++;return route.fulfill({contentType:'text/html',body:html});}
      return route.abort();
    });
    await page.goto('http://hm-file.test/',{waitUntil:'commit'});
    await page.getByRole('button',{name:'Retry loading',exact:true}).waitFor({state:'visible'});
    assert.equal(await page.locator('#loading').isVisible(),false);
    assert.equal(await page.locator('#nogl').getAttribute('role'),'alert');
    assert.match(await page.locator('#nogl').innerText(),/required game file could not load/);
    assert.match(await page.locator('#nogl').innerText(),/saved character is kept/);
    assert.equal(await page.evaluate(()=>!!window.__hm),false);
    assert.equal(visits,1);
    mkdirSync(new URL('../out/',import.meta.url),{recursive:true});
    await page.screenshot({path:fileURLToPath(new URL('../out/startup-file-recovery-390.png',import.meta.url))});
    await Promise.all([
      page.waitForNavigation({waitUntil:'domcontentloaded'}),
      page.getByRole('button',{name:'Retry loading',exact:true}).click(),
    ]);
    await page.waitForFunction(()=>document.querySelector('#nogl button') && !document.querySelector('#nogl').hidden);
    assert.equal(visits,2);
    assert.equal(await page.evaluate(()=>localStorage.length),0);
  } finally {await browser.close();}
});

const shell=readFileSync(new URL('../../src/page.html',import.meta.url),'utf8');
const guard=shell.match(/<script>\s*(\/\* startup-file-guard[\s\S]*?)<\/script>/)[1];
const style=[...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match=>match[1]).join('\n');
const notice=shell.match(/<section id="nogl"[^>]*>[\s\S]*?<\/section>/)[0];

async function slowFixture(t) {
  const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:320,height:560}});
  page.setDefaultTimeout(5000);
  let visits=0;
  // Exercise the actual guard and DOM with a controlled watchdog, without
  // waiting 20 seconds or executing the game's graphics module.
  const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${style}</style><div id="loading">Loading</div>${notice}<script id="dependency" type="module"></script>
    <script>((setTimeout,clearTimeout)=>{${guard}})(
      (fn,delay)=>{window.slowWatchdog=fn;window.watchdogDelay=delay;return 1;},
      ()=>{window.watchdogCleared=true;});
      window.moduleError=()=>document.getElementById('dependency').dispatchEvent(new Event('error'));
    </script>`;
  await page.route('**/*',route=>{
    if(route.request().isNavigationRequest())visits++;
    return route.fulfill({contentType:'text/html',body:html});
  });
  await page.goto('http://hm-file-slow.test/?server=wss%3A%2F%2Frelay.example%2Fws#return');
  await page.evaluate(()=>localStorage.setItem('hallowmarch.save.v1','character-sentinel'));
  assert.equal(await page.evaluate(()=>watchdogDelay),20000,'The existing watchdog duration stays unchanged.');
  return {page,visits:()=>visits};
}

test('a slow dependency stays pending and late success restores the loader without a reload',async t=>{
  const {page,visits}=await slowFixture(t);
  await page.evaluate(()=>slowWatchdog());
  const panel=page.locator('#nogl');
  assert.equal(await panel.getAttribute('role'),'status');
  assert.match(await panel.innerText(),/Game files are taking longer than expected/);
  assert.match(await panel.innerText(),/keep waiting/);
  assert.doesNotMatch(await panel.innerText(),/could not (load|finish loading)/);
  assert.equal(await panel.locator('button').count(),1);
  assert.equal(await page.locator('#loading').isVisible(),false);
  assert.equal(visits(),1);
  await page.evaluate(()=>__hmFileBoot.ready());
  assert.equal(await panel.isVisible(),false);assert.equal(await page.locator('#loading').isVisible(),true);
  assert.equal(await page.evaluate(()=>watchdogCleared),true);
  await page.evaluate(()=>{slowWatchdog();moduleError();});
  assert.equal(await panel.isVisible(),false);assert.equal(visits(),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.save.v1')),'character-sentinel');
});

test('a module error after a slow notice updates the existing notice and retry still reloads exactly once',async t=>{
  const {page,visits}=await slowFixture(t);
  await page.evaluate(()=>{slowWatchdog();window.originalRetry=document.querySelector('#nogl button');window.originalRetryHandler=originalRetry.onclick;});
  assert.equal(await page.locator('#nogl').getAttribute('role'),'status');
  assert.match(await page.locator('#nogl').innerText(),/keep waiting/);
  await page.evaluate(()=>moduleError());
  const panel=page.locator('#nogl');
  assert.equal(await panel.getAttribute('role'),'alert');
  assert.match(await panel.innerText(),/required game file could not load/);
  assert.doesNotMatch(await panel.innerText(),/keep waiting/);
  await page.evaluate(()=>{slowWatchdog();moduleError();});
  assert.equal(await page.locator('#nogl').count(),1);assert.equal(await panel.locator('button').count(),1);
  assert.equal(await page.evaluate(()=>originalRetry===document.querySelector('#nogl button')&&originalRetryHandler===originalRetry.onclick),true);
  assert.equal(visits(),1,'No state transition may automatically reload.');
  const url=page.url();
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),panel.getByRole('button',{name:'Retry loading',exact:true}).click()]);
  assert.equal(page.url(),url);assert.equal(visits(),2);
  assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.save.v1')),'character-sentinel');
});
