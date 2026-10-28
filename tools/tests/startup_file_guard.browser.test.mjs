import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from '../node_modules/playwright/index.mjs';

test('a real failed graphics dependency shows recovery and retry performs one normal reload',async()=>{
  const browser=await chromium.launch({headless:true});
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
    assert.match(await page.locator('#nogl').innerText(),/saved character is kept/);
    assert.equal(await page.evaluate(()=>!!window.__hm),false);
    assert.equal(visits,1);
    mkdirSync(new URL('../out/',import.meta.url),{recursive:true});
    await page.screenshot({path:fileURLToPath(new URL('../out/startup-file-recovery-390.png',import.meta.url))});
    await page.getByRole('button',{name:'Retry loading',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#nogl button') && !document.querySelector('#nogl').hidden);
    assert.equal(visits,2);
    assert.equal(await page.evaluate(()=>localStorage.length),0);
  } finally {await browser.close();}
});
