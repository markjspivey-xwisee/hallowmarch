/** Actual prologue CSS/render/navigation in an isolated DOM; fictional prose/art, no game or WebGL. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const [lore, shell] = await Promise.all(['10c_lore.js', 'page.html'].map(name => readFile(new URL('../../src/' + name, import.meta.url), 'utf8')));
const nodes = parse(lore, { ecmaVersion: 'latest' }).body;
const actual = name => {
  const matches = nodes.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name
    || node.type === 'VariableDeclaration' && node.declarations.some(row => row.id.name === name));
  assert.equal(matches.length, 1, 'One actual declaration: ' + name);
  return lore.slice(matches[0].start, matches[0].end);
};
const handlers = nodes.filter(node => node.type === 'ExpressionStatement'
  && node.expression.callee?.object?.name === 'window' && node.expression.callee?.property?.name === 'addEventListener'
  && node.expression.arguments[0]?.value === 'keydown' && node.expression.arguments[2]?.value === true
  && lore.slice(node.start, node.end).includes("UI.modal !== 'prologue'"));
assert.equal(handlers.length, 1, 'Use the actual window-capture prologue handler');
const handler = lore.slice(handlers[0].start, handlers[0].end);
const declarations = ['LORE_CSS', 'openPrologue', 'renderPrologue', 'prologueGo', 'closePrologue'].map(actual).join('\n');
const style = [...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const playwrightPath = process.env.HM_PLAYWRIGHT_MODULE || fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url));
const { chromium } = await import(pathToFileURL(playwrightPath));
const bounded = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out')), ms); })])
    .finally(() => clearTimeout(timer));
};

test('normal-motion prologue settles and suppresses only held arrow/page navigation', { timeout: 30000 }, async () => {
  const channel = process.env.HM_BROWSER_CHANNEL;
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 10000, ...(channel ? { channel } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
    page.setDefaultTimeout(3000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent('<!doctype html><meta charset="utf-8"><style>' + style + '</style><body></body>');
    await page.addScriptTag({ content: `
      const UI = {modal:null}, LORE = {pro:null}, INPUT = {keys:new Set(),joy:null}, IS_TOUCH = false;
      const GAME = {player:{faction:0,cls:'warrior'},prog:{lore:{pro:0}}};
      const effects = {input:0,saves:0,notes:[],sounds:[],leaked:0};
      const $ = id => document.getElementById(id);
      function hideJoystick(){} function closeMenu(){UI.modal=null;}
      function prologuePages(){return Array.from({length:5},(_,i)=>({k:'Page '+(i+1),t:'Fixture page '+(i+1),art:'fixture',p:['Fictional prose for the actual entrance and navigation contract.']}));}
      function loreArt(){return '<svg viewBox="0 0 600 600" aria-label="Fictional illustration"><rect width="600" height="600" fill="#514834"/></svg>';}
      function saveSoon(){effects.saves++;} function loreNote(id){effects.notes.push(id);}
      function sfx(id){effects.sounds.push(id);} function netHumanInput(){effects.input++;}
      ${declarations}
      ${handler}
      document.addEventListener('keydown',()=>{effects.leaked++;});
      const st=document.createElement('style');st.textContent=LORE_CSS;document.head.appendChild(st);
      window.prologueFixture={
        state(){return {index:LORE.pro?.i??null,modal:UI.modal,effects:structuredClone(effects)};},
        view(index){LORE.pro.i=index;renderPrologue();},
        key(code,repeat){const e=new KeyboardEvent('keydown',{code,repeat,bubbles:true,cancelable:true});
          document.querySelector('#lore-pro [data-pro="next"]').dispatchEvent(e);
          return {defaultPrevented:e.defaultPrevented,...this.state()};}
      };
      if(!openPrologue(false))throw Error('Fixture prologue did not open');
    ` });

    const settle = () => bounded(page.evaluate(async () => {
      const selectors = ['#lore-pro .art svg', '#lore-pro .head', '#lore-pro h2', '#lore-pro .text'];
      const elements = selectors.map(selector => document.querySelector(selector));
      const animations = elements.map(element => element.getAnimations());
      const timings = animations.map(rows => rows.map(animation => ({ name: animation.animationName,
        duration: animation.effect.getTiming().duration, delay: animation.effect.getTiming().delay })));
      await Promise.all(animations.flat().map(animation => animation.finished));
      const next = document.querySelector('#lore-pro [data-pro="next"]');
      return { reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, dataReduced: document.documentElement.dataset.reducedMotion,
        timings, opacity: elements.map(element => getComputedStyle(element).opacity),
        footerOpacity: getComputedStyle(next.closest('.foot')).opacity, enabled: !next.disabled, state: prologueFixture.state() };
    }), 3000, 'Finite prologue entrance');
    const expectedTimings = [[{ name: 'lore-art', duration: 700, delay: 0 }], [{ name: 'lore-in', duration: 450, delay: 0 }],
      [{ name: 'lore-in', duration: 500, delay: 50 }], [{ name: 'lore-in', duration: 550, delay: 100 }]];
    const first = await settle();
    assert.equal(first.reduced, false); assert.notEqual(first.dataReduced, 'true');
    assert.deepEqual(first.timings, expectedTimings); assert.deepEqual(first.opacity, ['1', '1', '1', '1']);
    assert.equal(first.footerOpacity, '1'); assert.equal(first.enabled, true); assert.equal(first.state.index, 0);

    await page.evaluate(() => prologueFixture.view(4));
    const before = await page.locator('#lore-pro').innerHTML();
    for (const code of ['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp']) {
      const repeated = await page.evaluate(code => prologueFixture.key(code, true), code);
      assert.equal(repeated.defaultPrevented, true); assert.equal(repeated.index, 4); assert.equal(repeated.modal, 'prologue');
      assert.equal(repeated.effects.leaked, 0); assert.equal(repeated.effects.saves, 0); assert.deepEqual(repeated.effects.notes, []);
      assert.equal(await page.locator('#lore-pro').innerHTML(), before, 'Ignored repeat retains the exact current DOM');
    }
    const last = await settle();
    assert.deepEqual(last.timings, expectedTimings); assert.deepEqual(last.opacity, ['1', '1', '1', '1']);
    const back = await page.evaluate(() => prologueFixture.key('PageUp', false)); assert.equal(back.index, 3);
    const forward = await page.evaluate(() => prologueFixture.key('PageDown', false)); assert.equal(forward.index, 4);
    const finished = await page.evaluate(() => prologueFixture.key('ArrowRight', false));
    assert.equal(finished.index, null); assert.equal(finished.modal, null); assert.equal(finished.effects.saves, 1);
    assert.deepEqual(finished.effects.notes, ['start']); assert.equal(finished.effects.leaked, 0);
    assert.equal(finished.effects.input, 7, 'Every modal event reaches the existing hook once; synthetic events prove no physical trust');
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
  } finally {
    await bounded(browser.close(), 5000, 'DOM browser close');
  }
});
