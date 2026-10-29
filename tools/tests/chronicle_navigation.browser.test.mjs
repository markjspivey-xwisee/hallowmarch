/** Actual Chronicle navigation, handlers and shell CSS; page prose is synthetic. No game or services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parse} from 'acorn';
import {chromium} from '../node_modules/playwright/index.mjs';

const read=name=>readFile(new URL('../../'+name,import.meta.url),'utf8');
const [lore,shell,...extensions]=await Promise.all(['src/10c_lore.js','src/page.html','src/10e_guide.js',
  'src/10f_guide2.js','src/10l_late.js','src/14x_consulting.js'].map(read));
const tree=parse(lore,{ecmaVersion:'latest'});
const names=['LORE_CSS','CHRON_SECTIONS','CHRON_GROUPS','CHRON_FN','chronGroupOf','chronAdd','renderChronicle','openChronicle'];
const declarations=tree.body.filter(node=>node.type==='FunctionDeclaration'&&names.includes(node.id.name)
  ||node.type==='VariableDeclaration'&&node.declarations.some(d=>names.includes(d.id.name))).map(node=>lore.slice(node.start,node.end)).join('\n');
const handler=tree.body.find(node=>node.type==='ExpressionStatement'&&node.expression.callee?.property?.name==='addEventListener'
  &&node.expression.callee.object?.callee?.name==='$'&&node.expression.callee.object.arguments[0]?.value==='menu-body'
  &&node.expression.arguments[0]?.value==='click'&&lore.slice(node.start,node.end).includes('.chron-nav [data-sec]'));
assert(handler,'Use the actual delegated Chronicle navigation handler');
const added=extensions.flatMap(source=>parse(source,{ecmaVersion:'latest'}).body.filter(node=>node.type==='ExpressionStatement'
  &&node.expression.callee?.name==='chronAdd').map(node=>({source:source.slice(node.start,node.end),fn:node.expression.arguments[3]})));
const pageNames=['chronMarch','chronRealms','chronClasses','chronGifts','chronWar','chronOrders','chronHalls','chronWilds',
  'chronDragon','chronBarrow','chronWater','chronLiving','chronFields','chronHerbal','chronAnimals','chronBuilding','chronPath',
  ...added.filter(row=>row.fn.type==='Identifier').map(row=>row.fn.name)];
const style=[...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n');
const markup=shell.slice(shell.indexOf('<div class="overlay" id="menu"'),shell.indexOf('<div class="overlay" id="kit"'));
let server,browser;
const bounded=(promise,ms)=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DOM browser close timed out')),ms);})]).finally(()=>clearTimeout(timer));};
// Ubuntu's AppArmor profile covers vendor Chrome at /opt/google/chrome/chrome,
// not the downloaded headless_shell. Keep the sandbox enabled and fail if absent.
// https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
const browserChannel=process.platform==='linux'?'chrome':undefined;
test.before(async()=>{
  server=await chromium.launchServer({headless:true,chromiumSandbox:true,args:['--disable-gpu'],...(browserChannel?{channel:browserChannel}:{})});
  const launched=server.process();
  assert(!launched.spawnargs.some(arg=>/^--(?:no-sandbox|disable-setuid-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox|disable-web-security)(?:=|$)/.test(arg)),'DOM test must retain the browser security boundaries');
  if(process.platform==='linux')assert.equal(launched.spawnfile,'/opt/google/chrome/chrome','Use the vendor path covered by the Ubuntu policy');
  console.log(JSON.stringify({kind:'chronicle-dom-browser',channel:browserChannel||'bundled-chromium',executable:launched.spawnfile,sandbox:true}));
  browser=await chromium.connect(server.wsEndpoint());
});
test.after(async()=>{try{await bounded(browser?.close(),10000);}finally{try{await bounded(server?.close(),10000);}catch{await server?.kill();}}});

async function fixture(t,width,largeText){
  const page=await browser.newPage({viewport:{width,height:780},hasTouch:true,isMobile:true});t.after(()=>page.close());
  const requests=[],errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style>
    <body class="touch mobile-modal-open ${largeText?'mobile-large-text':''}">${markup}</body>`);
  await page.addScriptTag({content:`
    window.$=id=>document.getElementById(id);window.LORE={chronSec:'path'};window.UI={modal:'menu',menuTab:'chronicle'};
    window.__routes=[];window.sfx=()=>{};window.chronFold=()=>{};
    window.openMenu=tab=>{UI.menuTab=tab;__routes.push(tab);};window.renderMenu=openMenu;
    ${pageNames.map(name=>`window.${name}=()=>'<h3>Fixture page</h3><p>Read-only navigation fixture.</p>';`).join('\n')}
    ${declarations}
    ${added.map(row=>row.source).join('\n')}
    ${lore.slice(handler.start,handler.end)}
    const style=document.createElement('style');style.textContent=LORE_CSS;document.head.appendChild(style);
    document.body.style.setProperty('--caps','"Courier New",monospace');
    document.body.style.setProperty('--ui','system-ui');
    $('menu').hidden=false;
    for(const button of $('menu-tabs').querySelectorAll('button'))button.setAttribute('aria-selected',String(button.dataset.tab==='chronicle'));
    renderChronicle($('menu-body'));
    window.__navKeys=()=>({sections:CHRON_SECTIONS.map(([key])=>key),groups:CHRON_GROUPS.map(([key,label,pages])=>({key,label,pages}))});
  `});
  await page.evaluate(()=>document.fonts.ready);
  return{page,requests,errors};
}

for(const width of[320,390])for(const largeText of[false,true])test(`compact section/page navigation stays reachable at ${width}px${largeText?' large text':''}`,async t=>{
  const {page,requests,errors}=await fixture(t,width,largeText);
  const sections=page.getByRole('group',{name:'Guide sections',exact:true});
  const pages=page.getByRole('group',{name:'Pages in this section',exact:true});
  assert.equal(await sections.count(),1);assert.equal(await pages.count(),1);
  assert.deepEqual(await sections.locator('button').allTextContents(),['World','Your guide','Warfare','Life skills']);
  const keys=await page.evaluate(()=>__navKeys());
  assert.deepEqual(keys.groups.map(g=>[g.key,g.pages[0]]),[['land','march'],['you','path'],['war','war'],['life','living']]);
  const reached=new Set(),measurements=[];
  for(const group of keys.groups){
    const button=sections.locator(`[data-grp="${group.key}"]`);await button.click();
    assert.equal(await page.evaluate(()=>LORE.chronSec),group.pages[0]);
    assert.equal(await button.getAttribute('aria-current'),'true');
    assert.notEqual(await button.innerText(),await pages.locator('[aria-current="true"]').innerText(),'section and default page have distinct labels');
    for(const key of group.pages.filter(key=>key!=='coach')){
      const child=pages.locator(`[data-sec="${key}"]`);await child.click();
      assert.equal(await page.evaluate(()=>LORE.chronSec),key);reached.add(key);
      assert.equal(await sections.locator('[aria-current="true"]').count(),1);
      assert.equal(await pages.locator('[aria-current="true"]').count(),1);
      assert.equal(await page.evaluate(()=>document.activeElement?.dataset.sec),key,'page replacement retains keyboard focus');
      const box=await child.evaluate(node=>{const r=node.getBoundingClientRect(),row=node.parentElement.getBoundingClientRect();return{height:r.height,left:r.left,right:r.right,rowLeft:row.left,rowRight:row.right};});
      assert(box.height>=44&&box.left>=box.rowLeft-1&&box.right<=box.rowRight+1,'complete page target scrolls into the row: '+key+' '+JSON.stringify(box));
    }
    const box=await button.evaluate(node=>{const r=node.getBoundingClientRect(),row=node.parentElement.getBoundingClientRect();return{label:node.textContent,height:r.height,left:r.left,right:r.right,rowLeft:row.left,rowRight:row.right,scrollWidth:node.parentElement.scrollWidth,clientWidth:node.parentElement.clientWidth};});
    assert(box.height>=44&&box.left>=box.rowLeft-1&&box.right<=box.rowRight+1,'complete section target remains reachable: '+JSON.stringify(box));measurements.push(box);
  }
  assert.deepEqual([...reached].sort(),keys.sections.filter(key=>key!=='coach').sort(),'every existing page destination remains available');
  assert.deepEqual(await page.evaluate(()=>__routes),[],'normal guide navigation stays in the Chronicle');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // At narrow widths the section row may scroll; native horizontal input must
  // reveal it without making the whole menu overflow or hiding any destination.
  const row=await sections.evaluate(node=>({scrollWidth:node.scrollWidth,clientWidth:node.clientWidth}));
  if(width>=390)assert(row.scrollWidth<=row.clientWidth,'all four compact sections fit a 390px menu even with the wide fallback font');
  if(row.scrollWidth>row.clientWidth){
    await sections.evaluate(node=>{node.scrollLeft=0;});const box=await sections.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(300,0);
    await page.waitForFunction(()=>document.querySelector('.chron-grps').scrollLeft>0,undefined,{timeout:2000});
  }
  await page.evaluate(()=>openChronicle('coach'));assert.deepEqual(await page.evaluate(()=>__routes),['progress'],'old coach route still opens Progress');
  if(process.env.HM_CHRONICLE_QA_OUT){
    const out=process.env.HM_CHRONICLE_QA_OUT;await mkdir(out,{recursive:true});
    await page.screenshot({path:resolve(out,`chronicle-${width}${largeText?'-large':''}.png`),fullPage:true});
    await writeFile(resolve(out,`chronicle-${width}${largeText?'-large':''}.json`),JSON.stringify(measurements,null,2));
  }
  assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);
});
