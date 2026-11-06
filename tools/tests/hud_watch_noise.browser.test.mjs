/** Actual hudWatch/native observers on fixed-size fictional DOM panels. No game, WebGL,
 * production-layout, physical-touch, timing or performance claim. All requests blocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parse} from 'acorn';

const source = (await readFile(new URL('../../src/10p_hud.js', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const previous = String.raw`  const noise = (m) => m.attributeName === 'class' && String(m.oldValue || '').replace(/\s*\bhl-[a-z]+\b/g, '').trim() === String(m.target.className || '').replace(/\s*\bhl-[a-z]+\b/g, '').trim();`;
const replacement = String.raw`  const ownedClasses = new Set(['hl-compact', 'hl-off', 'hl-brief', 'hl-brief1', 'hl-old']);
  const unownedClasses = (value) => String(value || '').split(/[\t\n\f\r ]+/).filter((token) => token && !ownedClasses.has(token)).join(' ');
  const noise = (m) => m.attributeName === 'class' && unownedClasses(m.oldValue) === unownedClasses(m.target.className);`;
const original = source.replace(replacement, previous);
assert.equal(source.split(replacement).length, 2);
assert.equal(createHash('sha256').update(original).digest('hex'), '4f55cdd3f3a26d99fe2b617e7f351f4a442f6813ee9995f75c9a7f48eeadcb27');
function declarations(input) {
  const wanted = new Set(['HUDL', 'HUD_ORDER', 'HUDL5', 'HUD_WATCH', 'hudReset', 'hudWatch']);
  const rows = parse(input, {ecmaVersion: 'latest'}).body.filter(node => node.type === 'FunctionDeclaration' && wanted.has(node.id.name)
    || node.type === 'VariableDeclaration' && node.declarations.some(row => wanted.has(row.id.name)));
  assert.equal(rows.length, wanted.size); return rows.map(node => input.slice(node.start, node.end)).join('\n');
}
const playwrightPath = process.env.HM_PLAYWRIGHT_MODULE || fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url));
const {chromium} = await import(pathToFileURL(playwrightPath));
const bounded = (promise, ms, name) => {let timer;
  return Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(Error(name + ' timed out')), ms);})])
    .finally(() => clearTimeout(timer));
};
async function browserFixture() {
  const channel = process.env.HM_BROWSER_CHANNEL;
  return chromium.launch({headless: true, chromiumSandbox: true, timeout: 10000, ...(channel ? {channel} : {})});
}
async function fixture(browser, old = false) {
  const page = await browser.newPage({viewport: {width: 390, height: 780}}), requests = [], errors = [];
  page.setDefaultTimeout(3000); page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {requests.push(route.request().url()); return route.abort();});
  // Fixed sizes intentionally isolate class-observer classification from legitimate
  // ResizeObserver invalidation. This is not the production placement/CSS fixture.
  await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:8px}#hud{display:grid;grid-template-columns:repeat(3,100px);gap:2px}.panel{box-sizing:border-box;width:100px;height:16px;overflow:hidden;font:10px sans-serif}</style><body><button id="focus-witness">Fictional focus witness</button><div id="hud"></div></body>');
  await page.addScriptTag({content: `
    const $ = id => document.getElementById(id);
    ${declarations(old ? original : source)}
    const hud = $('hud');
    for (const selector of HUD_WATCH) {
      if (document.querySelector(selector)) continue;
      if (selector === '#topright > .iconbtns') {
        let top = $('topright'); if (!top) {top = document.createElement('div'); top.id = 'topright'; hud.appendChild(top);}
        const child = document.createElement('div'); child.className = 'iconbtns panel'; top.appendChild(child);
      } else {
        const node = document.createElement('div'); node.id = selector.slice(1); node.className = 'panel'; node.textContent = node.id; hud.appendChild(node);
      }
    }
    const caption = document.createElement('span'); caption.className = 'caption'; caption.textContent = 'Fictional note'; $('banners').appendChild(caption);
    const flush = async () => {await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); await new Promise(resolve => setTimeout(resolve, 0));};
    const arm = () => {HUDL5.dirty = false; HUDL5.why = 'armed';};
    const state = () => ({dirty: HUDL5.dirty, why: HUDL5.why, className: $('banners').className,
      focus: document.activeElement?.id, nativeMO: HUDL5.mo instanceof MutationObserver, nativeRO: HUDL5.ro instanceof ResizeObserver,
      rectangles: HUD_WATCH.map(selector => {const e = document.querySelector(selector), r = e.getBoundingClientRect(); return {selector,x:r.x,y:r.y,w:r.width,h:r.height};})});
    hudWatch(); $('focus-witness').focus();
    window.hudFixture = {
      async ready(){await flush(); arm(); return state();},
      async cycle(){
        $('banners').className = 'panel hl-brief1'; await flush(); arm(); const before = state();
        hudReset(); $('banners').classList.add('hl-brief'); $('banners').classList.remove('hl-brief'); $('banners').classList.add('hl-brief1');
        await flush(); return {before,after:state()};
      },
      async change(kind, token){
        const el = $('banners'); el.className = kind === 'remove' ? 'panel ' + token : 'panel'; el.hidden = false; el.style.width = ''; await flush(); arm();
        if (kind === 'add') el.classList.add(token);
        else if (kind === 'remove') el.classList.remove(token);
        else if (kind === 'mixed') el.className = 'panel selected hl-brief1';
        else if (kind === 'hidden') {el.hidden = true; el.hidden = false;}
        else if (kind === 'childList') {const child = document.createElement('span'); child.textContent = 'temporary'; el.appendChild(child); child.remove();}
        else if (kind === 'resize') el.style.width = '102px';
        else throw Error('Unknown fictional DOM mutation');
        await flush(); return state();
      }
    };
  `});
  const initial = await bounded(page.evaluate(() => hudFixture.ready()), 3000, 'Initial native observer delivery');
  assert.equal(initial.nativeMO, true); assert.equal(initial.nativeRO, true); assert.equal(initial.focus, 'focus-witness');
  return {page, requests, errors};
}

test('actual native observer witnesses original brief1 feedback and keeps two candidate reset/reapply batches quiet', {timeout: 30000}, async () => {
  const browser = await browserFixture();
  try {
    for (const old of [true, false]) {
      const f = await fixture(browser, old);
      for (let pass = 0; pass < 2; pass++) {
        const result = await bounded(f.page.evaluate(() => hudFixture.cycle()), 3000, 'Native reset/reapply callback');
        assert.equal(result.after.dirty, old); assert.equal(result.after.why, old ? 'banners:class' : 'armed');
        assert.equal(result.after.className, result.before.className); assert.equal(result.after.focus, result.before.focus);
        assert.deepEqual(result.after.rectangles, result.before.rectangles, 'Same fixed fictional DOM geometry, not production layout proof');
      }
      assert.deepEqual(f.errors, []); assert.deepEqual(f.requests, []); await f.page.close();
    }
  } finally {await bounded(browser.close(), 5000, 'HUD observer DOM browser close');}
});
test('actual native observer ignores only five owned tokens and still responds to real/hidden/child-list/unowned-token changes', {timeout: 30000}, async () => {
  const browser = await browserFixture();
  try {
    const f = await fixture(browser);
    for (const token of ['hl-compact', 'hl-off', 'hl-brief', 'hl-brief1', 'hl-old']) for (const kind of ['add', 'remove']) {
      const state = await bounded(f.page.evaluate(({kind,token}) => hudFixture.change(kind, token), {kind,token}), 3000, 'Owned class delivery');
      assert.equal(state.dirty, false, token + ' ' + kind); assert.equal(state.why, 'armed'); assert.equal(state.focus, 'focus-witness');
    }
    for (const [kind, token] of [['mixed'], ['hidden'], ['childList'], ['resize'], ...['hl-brief11', 'hl-brief1-extra', 'hl-off2', 'hl-compactness', 'foo-hl-brief1', 'x\u00a0hl-brief1', 'x\vhl-brief1'].map(token => ['add', token])]) {
      const state = await bounded(f.page.evaluate(({kind,token}) => hudFixture.change(kind, token), {kind,token}), 3000, 'Real mutation delivery');
      assert.equal(state.dirty, true, JSON.stringify([kind,token])); assert.equal(state.focus, 'focus-witness');
      if (kind === 'resize') assert.equal(state.why, 'banners:size', 'Real size changes still reach the native ResizeObserver');
    }
    assert.deepEqual(f.errors, []); assert.deepEqual(f.requests, []);
  } finally {await bounded(browser.close(), 5000, 'HUD observer DOM browser close');}
});
