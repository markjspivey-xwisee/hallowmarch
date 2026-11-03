import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from '../node_modules/playwright/index.mjs';

const main=readFileSync(new URL('../../src/13_main.js',import.meta.url),'utf8');
const work=main.slice(main.indexOf('const BOOT_WORK_BUDGET_MS'),main.indexOf('async function boot()'));
test('loading construction lets an identity response and user input run before it finishes',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.route('http://startup.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('identity')?'application/json':'text/html',
    body:route.request().url().endsWith('identity')?'{}':'<button id="signin">Sign in</button>'}));
  await page.goto('http://startup.test/');
  await page.evaluate(work+`; window.runLoading = async () => {
    const state=window.loadingState={chunks:0,identityAt:null,clickedAt:null,complete:false};
    document.getElementById('signin').onclick=()=>{state.clickedAt=state.chunks;};
    function* chunks(){for(let i=0;i<500;i++){const until=performance.now()+3;while(performance.now()<until){}state.chunks++;yield;}}
    const receipt={completed:false,chunked:false,chunks:0,yields:0,workMs:0,maxChunkMs:0,maxSliceMs:0,elapsedMs:0};
    void fetch('/identity').then(()=>{state.identityAt=state.chunks;});
    await runBootWork(chunks,receipt);state.complete=true;
  }; function graphicsAssertActive(){};`);
  await page.evaluate(()=>{void window.runLoading();});
  await page.waitForFunction(()=>window.loadingState.identityAt!==null);
  await page.locator('#signin').click();
  const interactive=await page.evaluate(()=>window.loadingState);
  assert(Number.isInteger(interactive.identityAt)); assert(Number.isInteger(interactive.clickedAt));
  assert(interactive.identityAt<500,'A sign-in response must not wait behind every construction continuation.');
  assert(interactive.clickedAt<500,'A real browser click must run before construction finishes.');
  await page.waitForFunction(()=>window.loadingState.complete);
});
