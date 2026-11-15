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

const layouts = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, touch: false },
  { name: 'phone', viewport: { width: 390, height: 780 }, touch: true },
];
const motionModes = [
  { name: 'normal', reducedMotion: 'no-preference', appReduced: false },
  { name: 'OS reduced', reducedMotion: 'reduce', appReduced: false },
  { name: 'app reduced', reducedMotion: 'no-preference', appReduced: true },
];

for (const layout of layouts) for (const mode of motionModes) test(layout.name + ' / ' + mode.name + ' prologue is immediately readable and retains navigation', { timeout: 30000 }, async () => {
  const channel = process.env.HM_BROWSER_CHANNEL;
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 10000, ...(channel ? { channel } : {}) });
  try {
    const page = await browser.newPage({ viewport: layout.viewport, hasTouch: layout.touch, reducedMotion: mode.reducedMotion });
    page.setDefaultTimeout(3000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + style + '</style><body></body>');
    await page.addScriptTag({ content: `
      const UI = {modal:null}, LORE = {pro:null}, INPUT = {keys:new Set(),joy:null}, IS_TOUCH = ${layout.touch};
      if (IS_TOUCH) document.body.classList.add('touch');
      if (${mode.appReduced}) document.documentElement.dataset.reducedMotion='true';
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
        view(index){LORE.pro.i=index;renderPrologue();return this.immediate();},
        immediate(){
          const describe=element=>{
            const rect=element.getBoundingClientRect(),ancestry=[];
            for(let owner=element;owner;owner=owner.parentElement){const css=getComputedStyle(owner);
              ancestry.push({opacity:css.opacity,display:css.display,visibility:css.visibility,hidden:owner.hidden===true});}
            return {opacity:getComputedStyle(element).opacity,animations:element.getAnimations().map(animation=>animation.animationName),
              disabled:element.disabled===true,rect:{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height},ancestry};
          };
          const art=document.querySelector('#lore-pro .art svg');
          return {state:this.state(),width:innerWidth,height:innerHeight,
            essential:['.head','h2','.text'].map(selector=>describe(document.querySelector('#lore-pro '+selector))),
            footer:describe(document.querySelector('#lore-pro .foot')),
            controls:[...document.querySelectorAll('#lore-pro .skip,#lore-pro [data-pro="back"],#lore-pro [data-pro="next"]')].map(describe),
            art:art.getAnimations().map(animation=>{const timing=animation.effect.getTiming(),first=animation.effect.getKeyframes()[0];
              return {name:animation.animationName,duration:timing.duration,delay:timing.delay,firstOpacity:first.opacity,firstTransform:first.transform};})};
        },
        key(code,repeat){const e=new KeyboardEvent('keydown',{code,repeat,bubbles:true,cancelable:true});
          document.querySelector('#lore-pro [data-pro="next"]').dispatchEvent(e);
          return {defaultPrevented:e.defaultPrevented,...this.state()};}
      };
      if(!openPrologue(false))throw Error('Fixture prologue did not open');
      prologueFixture.initialImmediate=prologueFixture.immediate();
    ` });

    const expectedArt = mode.reducedMotion === 'reduce' ? [] : [{ name: 'lore-art', duration: mode.appReduced ? 0.01 : 700, delay: 0 }];
    const assertImmediate = (snapshot, index) => {
      assert.equal(snapshot.state.index, index); assert.equal(snapshot.state.modal, 'prologue');
      assert.equal(snapshot.width, layout.viewport.width); assert.equal(snapshot.height, layout.viewport.height);
      assert.equal(snapshot.essential.length, 3); assert(snapshot.controls.length >= 1);
      for (const element of [...snapshot.essential, snapshot.footer, ...snapshot.controls]) {
        assert.equal(element.opacity, '1'); assert.deepEqual(element.animations, []);
        assert(element.rect.width > 0 && element.rect.height > 0);
        assert(element.rect.left >= 0 && element.rect.top >= 0 && element.rect.right <= snapshot.width && element.rect.bottom <= snapshot.height);
        for (const ancestor of element.ancestry) {
          assert.equal(ancestor.opacity, '1'); assert.notEqual(ancestor.display, 'none');
          assert.equal(ancestor.visibility, 'visible'); assert.equal(ancestor.hidden, false);
        }
      }
      assert(snapshot.controls.every(element => !element.disabled));
      assert.deepEqual(snapshot.art.map(({name,duration,delay}) => ({name,duration,delay})), expectedArt);
      for (const animation of snapshot.art) {
        assert.equal(animation.firstOpacity, '0'); assert.match(animation.firstTransform, /1\.03/);
      }
    };
    // The snapshot is created in the same task as actual open/render, before any
    // animation.finished, requestAnimationFrame, screenshot or artificial sleep.
    assertImmediate(await page.evaluate(() => prologueFixture.initialImmediate), 0);
    for (const index of [2, 4, 0]) assertImmediate(await page.evaluate(index => prologueFixture.view(index), index), index);

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
    const expectedTimings = [expectedArt, [], [], []];
    const first = await settle();
    assert.equal(first.reduced, mode.reducedMotion === 'reduce');
    if (mode.appReduced) assert.equal(first.dataReduced, 'true'); else assert.notEqual(first.dataReduced, 'true');
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
