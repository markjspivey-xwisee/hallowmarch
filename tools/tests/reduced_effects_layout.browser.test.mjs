/** Immediate touch preference/inset geometry from the real shell CSS; no WebGL. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shell = await readFile(new URL('../../src/page.html', import.meta.url), 'utf8');
const style = [...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const playerFrame = shell.slice(shell.indexOf('<div class="frame panel" id="pf"'), shell.indexOf('<div class="frame panel" id="tf"'));
const mobile = await readFile(new URL('../../src/10q_mobile.js', import.meta.url), 'utf8');
const preferenceChoices = mobile.slice(mobile.indexOf('const MOBILE_PREFS ='), mobile.indexOf('\nfunction mobileMovementZone('));
const preferences = mobile.slice(mobile.indexOf('function mobileApplyPrefs('), mobile.indexOf('\nfunction mobilePreferences('));
assert(style && playerFrame && preferenceChoices && preferences, 'Exercise the actual shell CSS, player frame and preference function.');
const playwrightPath = process.env.HM_PLAYWRIGHT_MODULE || fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url));
const { chromium } = await import(pathToFileURL(playwrightPath));
let browser;

test.before(async () => { browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined }); });
test.after(async () => { await browser?.close(); });

async function fixture(t, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
  t.after(() => page.close());
  const requests = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  // The dock is mobileBuild's dynamic structure; its classes, sizes, order and
  // layout rules all come from the source stylesheet rather than fixture CSS.
  await page.setContent(`<!doctype html><html data-reduced-motion="true"><head>
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style>
    </head><body class="touch"><div id="hud">${playerFrame}<div id="touch">
      <div id="joyhint">Drag to walk</div><div id="tpad">
        <div class="mobile-class"><button class="cls-btn tech">Stance</button><button class="cls-btn hold">Block</button><button class="gslot">Gift</button></div>
        <div class="mobile-primary"><div class="mobile-main-action"><button class="slot" data-slot="0">Attack</button></div>
          <div class="mobile-skills">${Array.from({ length: 7 }, (_, i) => `<button class="slot" data-slot="${i + 1}">Skill</button>`).join('')}</div></div>
        <div class="wide mobile-utility"><button class="btn" id="t-target">Target</button><button class="btn" id="t-use">Use</button><button class="btn" id="t-jump">Jump</button><button class="btn" id="t-potion">Potion</button></div>
      </div></div></div></body></html>`);
  await page.addScriptTag({ content: `const IS_TOUCH=true, HUDL={k:0};
    ${preferenceChoices}
    const $=id=>document.getElementById(id); function mobileStopInput(){};
    ${preferences}
    window.layoutSnapshot=()=>{
      const box=selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom}};
      return {hud:box('#hud'),frame:box('#pf'),dock:box('#tpad'),joy:box('#joyhint'),main:box('[data-slot="0"]'),
        hold:box('.cls-btn.hold'),utility:box('#t-target'),left:document.body.classList.contains('mobile-left-handed'),
        large:document.body.classList.contains('mobile-large-ui'),
        transitions:[...document.querySelectorAll('#hud,#hud button,#joyhint')].map(el=>getComputedStyle(el).transitionProperty)};
    };` });
  return { page, requests, errors };
}

for (const [width, height] of [[360, 640], [844, 390]]) {
  test(`reduced effects apply control size, hand and safe insets immediately at ${width}x${height}`, async t => {
    const { page, requests, errors } = await fixture(t, width, height);
    const baseline = await page.evaluate(() => layoutSnapshot());
    assert.equal(baseline.hold.w, 48);
    assert.equal(baseline.frame.x, 8);
    assert.equal(baseline.frame.y, 8);
    // Mutation and measurement deliberately share one task. Reduced effects must
    // not invent an all-property transition that leaves controls at old bounds.
    const changed = await page.evaluate(() => {
      mobileApplyPrefs({ hand: 'left', size: 'large', text: 'large' }, false);
      for (const [edge, value] of Object.entries({ t: 24, b: 20, l: 44, r: 44 })) document.documentElement.style.setProperty('--safe-' + edge, value + 'px');
      return layoutSnapshot();
    });
    assert.equal(changed.large, true); assert.equal(changed.left, true);
    assert.equal(changed.hold.w, 52, 'Large controls must use the requested width in the same task.');
    assert.equal(changed.hold.h, 52);
    assert.equal(changed.main.w, width > height ? 64 : 72);
    assert.equal(changed.hud.x, 44); assert.equal(changed.hud.right, width - 44);
    assert.equal(changed.frame.x, 52); assert.equal(changed.frame.y, 32);
    assert.equal(changed.dock.x, 52, 'The action dock must move to the selected left hand.');
    assert(changed.main.x + changed.main.w / 2 < width / 2);
    assert.equal(changed.joy.right, width - 44 - 14, 'Movement must move to the opposite hand immediately.');
    assert.deepEqual([...new Set(changed.transitions)], ['none']);
    const reset = await page.evaluate(() => {
      mobileApplyPrefs({ hand: 'right', size: 'standard', text: 'standard' }, false);
      for (const edge of ['t', 'b', 'l', 'r']) document.documentElement.style.setProperty('--safe-' + edge, '0px');
      return layoutSnapshot();
    });
    assert.equal(reset.hold.w, 48); assert.equal(reset.hold.h, 48);
    assert.equal(reset.hud.x, 0); assert.equal(reset.hud.right, width);
    assert.equal(reset.frame.x, 8); assert.equal(reset.frame.y, 8);
    assert.equal(reset.dock.right, width - 8);
    assert.equal(reset.joy.x, 14);
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
  });
}

test('normal effects retain the authored health bar transition without adding control transitions', async t => {
  const { page, requests, errors } = await fixture(t, 360, 640);
  const result = await page.evaluate(() => {
    document.documentElement.setAttribute('data-reduced-motion', 'false');
    const duration = selector => getComputedStyle(document.querySelector(selector)).transitionDuration;
    return { health: duration('#pf-hp'), control: duration('.cls-btn.hold') };
  });
  assert.equal(result.health, '0.12s'); assert.equal(result.control, '0s');
  assert.deepEqual(errors, []); assert.deepEqual(requests, []);
});
