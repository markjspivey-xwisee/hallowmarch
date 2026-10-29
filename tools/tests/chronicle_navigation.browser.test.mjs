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
const [audit,ui]=await Promise.all([read('tools/tests/menu_usability.py'),read('src/10_ui.js')]);
const panelScroll=audit.match(/\nPANEL_SCROLL_QA=r"""([\s\S]*?)"""/)[1];
const renderMenuNode=parse(ui,{ecmaVersion:'latest'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='renderMenu');
const renderMenuCode=ui.slice(renderMenuNode.start,renderMenuNode.end);
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

// Use the same protected, GPU-free browser and actual menu shell/renderer as the
// navigation checks. Only the long page prose and character data are fixtures.
async function scrollFixture(t){
  const page=await browser.newPage({viewport:{width:320,height:740},hasTouch:true,isMobile:true});
  page.setDefaultTimeout(5000);t.after(()=>page.close());
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{requests.push(route.request().url());return route.abort();});
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style>
    <body class="touch mobile-modal-open">${markup}</body>`);
  await page.addScriptTag({content:`
    window.$=id=>document.getElementById(id);window.UI={modal:'menu',menuTab:null,confirmNew:false};
    window.GAME={player:{name:'Fixture hero',cls:'warrior',faction:0},prog:{rp:0,played:0,level:1,kills:0,realmKills:0,deaths:0}};
    window.CLASSES={warrior:{name:'Warrior'}};window.REALMS=[{name:'Fixture realm'}];
    window.RANK_TITLES=['Recruit'];window.REALM_RANKS=[0,100];window.realmRank=()=>1;
    window.late2Named=player=>player.name;window.fmtInt=String;window.esc=String;
    window.late2CharStats=()=>'';window.gsCharHTML=()=>'';window.gsCharWire=()=>{};
    window.guideHelpHTML=()=>Array.from({length:80},(_,i)=>'<p>Reading paragraph '+i+': movement, equipment and the March.</p>').join('')+'<p id="reading-end">End of the reading page</p>';
    ${renderMenuCode}
    ${panelScroll}
    $('menu').hidden=false;renderMenu('help');$('menu-body').focus();
  `});
  t.after(()=>{assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);});
  return page;
}
async function resetPanel(page){
  await page.evaluate(()=>__menuPanelScrollQA.reset());
  try{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForFunction(()=>__menuPanelScrollQA.settled(),undefined,{timeout:5000,polling:50});
    return await page.evaluate(()=>__menuPanelScrollQA.fixtureReceipt());
  }finally{await page.evaluate(()=>__menuPanelScrollQA.finish('fixture'));}
}
async function nativePanelKey(page,key,condition,moves=true){
  await page.evaluate(key=>__menuPanelScrollQA.startKey(key),key);
  try{
    await page.keyboard.press(key);
    await page.waitForFunction(condition,undefined,{timeout:5000,polling:50});
    await page.waitForFunction(moves=>__menuPanelScrollQA.keyComplete(moves),moves,{timeout:5000,polling:50});
    return await page.evaluate(()=>__menuPanelScrollQA.keyReceipt());
  }finally{await page.evaluate(()=>__menuPanelScrollQA.finish('key'));}
}
test('fixture reset accepts a true no-op without inventing a scrollend',async t=>{
  const page=await scrollFixture(t),receipt=await resetPanel(page);
  assert.equal(receipt.initial,0);assert.equal(receipt.top,0);assert.equal(receipt.ends,0);
  assert.equal(receipt.focus,'menu-body');assert.equal(receipt.tab,'help');
  assert.equal(await page.evaluate(()=>__menuPanelScrollQA.settled()),true);
});
test('fixture reset settles one instant movement and layout-clamped content',async t=>{
  const page=await scrollFixture(t);
  await page.evaluate(()=>{$('menu-body').scrollTop=400;});
  const moved=await resetPanel(page);assert(moved.initial>2);assert.equal(moved.written,0);assert.equal(moved.top,0);
  await page.evaluate(()=>{
    const body=$('menu-body');body.scrollTop=800;body.innerHTML='<p>Short replacement page.</p>';
  });
  const clamped=await resetPanel(page);assert.equal(clamped.top,0);assert(clamped.total<=clamped.height);
});
test('actual Help-to-Character rendering survives a pending touch scroll then reset',async t=>{
  const page=await scrollFixture(t),body=page.locator('#menu-body'),box=await body.boundingBox();
  const cdp=await page.context().newCDPSession(page);
  try{
    const x=box.x+box.width-20,y=box.y+box.height*.8;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
    for(let step=1;step<=6;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-20*step,id:1}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>$('menu-body').scrollTop>0,undefined,{timeout:5000,polling:50});
    await page.evaluate(()=>{renderMenu('char');$('menu-body').focus();});
    const receipt=await resetPanel(page);assert.equal(receipt.tab,'char');assert.equal(receipt.focus,'menu-body');assert.equal(receipt.top,0);
    assert.equal(await body.getAttribute('aria-labelledby'),'menu-tab-char');
  }finally{await cdp.detach();}
});
test('native PageDown, End and Home keep trusted key, movement and end receipts',async t=>{
  const page=await scrollFixture(t);await resetPanel(page);
  const down=await nativePanelKey(page,'PageDown',()=>$('menu-body').scrollTop>0);
  assert.equal(down.down.key,'PageDown');assert.equal(down.down.prevented,false);assert(down.moved&&down.ended);
  await resetPanel(page);
  const end=await nativePanelKey(page,'End',()=>{const e=$('menu-body');return e.scrollTop+e.clientHeight>=e.scrollHeight-2;});
  assert(end.moved&&end.ended);assert.equal(end.focus,'menu-body');
  assert(await page.evaluate(()=>{const e=$('reading-end').getBoundingClientRect(),body=$('menu-body').getBoundingClientRect();return e.bottom<=body.bottom&&e.top>=body.top;}));
  const home=await nativePanelKey(page,'Home',()=>$('menu-body').scrollTop<=2);
  assert(home.moved&&home.ended);assert.equal(home.focus,'menu-body');
  assert(home.events.some(e=>e.type==='keydown'&&e.trusted));
  assert(home.events.some(e=>e.type==='scrollend'&&e.trusted));
});
test('pre-key ends, synthetic keys and prevented native keys cannot satisfy native movement',async t=>{
  const page=await scrollFixture(t);await resetPanel(page);
  await page.evaluate(()=>{__menuPanelScrollQA.startKey('PageDown');$('menu-body').scrollTop=50;});
  await page.waitForFunction(()=>__menuPanelScrollQA.keyReceipt().ends>0,undefined,{timeout:5000,polling:50});
  assert.equal(await page.evaluate(()=>__menuPanelScrollQA.keyComplete(true)),false,'an earlier native scrollend has no matching key');
  await page.evaluate(()=>{
    const body=$('menu-body');body.dispatchEvent(new KeyboardEvent('keydown',{key:'PageDown',bubbles:true}));
    body.dispatchEvent(new Event('scrollend'));
  });
  assert.equal(await page.evaluate(()=>__menuPanelScrollQA.keyComplete(true)),false,'synthetic key/end has no trusted input receipt');
  await resetPanel(page);
  await page.evaluate(()=>{
    __menuPanelScrollQA.startKey('PageDown');
    $('menu-body').addEventListener('keydown',e=>e.preventDefault(),{once:true});
  });
  await page.keyboard.press('PageDown');
  const prevented=await page.evaluate(()=>__menuPanelScrollQA.keyReceipt());
  assert.equal(prevented.down.prevented,true);assert.equal(prevented.moved,false);
  assert.equal(await page.evaluate(()=>__menuPanelScrollQA.keyComplete(true)),false);
  const before=await page.evaluate(()=>__menuPanelScrollQA.finish('key'));
  await page.keyboard.press('PageDown');
  await page.waitForFunction(()=>$('menu-body').scrollTop>0,undefined,{timeout:5000,polling:50});
  const after=await page.evaluate(()=>__menuPanelScrollQA.keyReceipt());
  assert.equal(after.events.length,before.events.length,'finished observers ignore later input and scroll events');
  assert.equal(after.scrolls,before.scrolls);assert.equal(after.ends,before.ends);
});
