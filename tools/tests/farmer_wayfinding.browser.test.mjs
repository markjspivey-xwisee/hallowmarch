/** Actual map shell/CSS and service sidebar. DOM-only repository unit test;
 * not the protected native gameplay acceptance controller. No game or services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse} from 'acorn';
import {chromium} from '../node_modules/playwright/index.mjs';
import {chromiumSwitches} from '../node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js';

const read = file => readFile(new URL('../../src/' + file, import.meta.url), 'utf8');
const [shell, farming, drawing, guide] = await Promise.all(['page.html', '08h_farming.js', '08i_farm_draw.js', '10e_guide.js'].map(read));
function actual(source, names) {
  return parse(source, {ecmaVersion: 'latest'}).body.filter(n => n.type === 'FunctionDeclaration' && names.includes(n.id.name)
    || n.type === 'VariableDeclaration' && n.declarations.some(d => names.includes(d.id.name))).map(n => source.slice(n.start, n.end)).join('\n');
}
const code = [actual(farming, ['farmSeedSeller']), actual(drawing, ['farmMapSide']), actual(guide, ['GUIDE_DIRS'])].join('\n');
const style = [...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
const markup = shell.slice(shell.indexOf('<div class="overlay" id="mapov"'), shell.indexOf('<div class="overlay" id="kit"'));
assert(markup.startsWith('<div class="overlay" id="mapov"') && markup.includes('id="mapside"'));
let server, browser;
const bounded = (value, ms) => {let timer; return Promise.race([value, new Promise((_, reject) => {
  timer = setTimeout(() => reject(Error('DOM browser cleanup timed out')), ms);
})]).finally(() => clearTimeout(timer));};
test.before(async () => {
  const channel = process.platform === 'win32' ? 'msedge' : 'chrome';
  server = await chromium.launchServer({channel, headless: true, chromiumSandbox: true,
    ignoreDefaultArgs: [...chromiumSwitches(false, channel), '--hide-scrollbars', '--mute-audio',
      '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'], args: ['--disable-gpu']});
  assert(!server.process().spawnargs.some(arg => /^--(?:no-sandbox|disable-setuid-sandbox|disable-web-security|disable-features|disable-gpu-watchdog|ignore-gpu-blocklist)(?:=|$)/.test(arg)));
  browser = await chromium.connect(server.wsEndpoint());
});
test.after(async () => {try {await bounded(browser?.close(), 5000);} finally {await bounded(server?.close(), 30000);}});

for (const width of [320, 390]) test(`service location and vector legend fit the actual ${width}px touch map sidebar`, async t => {
  const page = await browser.newPage({viewport: {width, height: 780}, hasTouch: true, isMobile: true}); t.after(() => page.close());
  const requests = [], errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {requests.push(route.request().url()); return route.abort();});
  await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style><body class="touch">${markup}</body>`);
  await page.addScriptTag({content: `
    const seller={id:2,name:'Ailith Rowan',role:'villager',alive:true,x:160,z:0,farmTown:0,ai:{seedSeller:true}};
    const GAME={player:{faction:0,x:0,z:0}},FARM={built:true,farmers:[2],plots:[]},SEASON={temp:12},TAU=Math.PI*2;
    const getEnt=id=>id===2?seller:null,farmTempAt=()=>12,seasonLabel=()=> 'Spring',dist=(x,z,a,b)=>Math.hypot(a-x,b-z);
    const esc=x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    ${code}
    document.getElementById('mapov').hidden=false;
    document.getElementById('mapside').innerHTML='<h3>The Hallowmarch</h3>'+farmMapSide()+'<button class="btn" id="btn-mapclose">Close map</button>';
  `});
  const state = await page.evaluate(() => {
    const side = document.getElementById('mapside'), box = side.getBoundingClientRect(), svg = side.querySelector('svg'), leaf = svg.getBoundingClientRect();
    return {width: innerWidth, side: {left: box.left, right: box.right, scroll: side.scrollWidth, client: side.clientWidth},
      leaf: {width: leaf.width, height: leaf.height, length: svg.querySelector('path').getTotalLength()}, text: side.textContent,
      hiddenFromAT: svg.getAttribute('aria-hidden'), buttons: side.querySelectorAll('button').length};
  });
  assert(state.side.left >= 0 && state.side.right <= width); assert(state.side.scroll <= state.side.client + 1);
  assert(state.leaf.width === 18 && state.leaf.height === 18 && state.leaf.length > 0);
  assert.match(state.text, /Seeds & tools/); assert.match(state.text, /Ailith Rowan/); assert.match(state.text, /160 m east/);
  assert.equal(state.hiddenFromAT, 'true'); assert.equal(state.buttons, 1); assert.deepEqual(errors, []); assert.deepEqual(requests, []);
});
