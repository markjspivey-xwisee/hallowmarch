/** Real shell geometry with a wide local font; no game, identity or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { parse } from 'acorn';

const shell = await readFile(new URL('../../src/page.html', import.meta.url), 'utf8');
const style = [...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const menu = shell.slice(shell.indexOf('<div class="overlay" id="menu"'), shell.indexOf('<div class="overlay" id="kit"'));
const nav = shell.match(/<nav id="mobile-nav"[\s\S]*?<\/nav>/)?.[0];
assert(style && menu && nav, 'Use the actual shell styles and complete menu/navigation markup.');
const [guideSource, uiSource] = await Promise.all(['10e_guide.js', '10_ui.js'].map(name => readFile(new URL('../../src/' + name, import.meta.url), 'utf8')));
function actualDeclaration(source, name) {
  const matches = parse(source, {ecmaVersion: 'latest', sourceType: 'script'}).body.filter(node =>
    node.type === 'FunctionDeclaration' && node.id.name === name || node.type === 'VariableDeclaration' && node.declarations.some(row => row.id.name === name));
  assert.equal(matches.length, 1, 'One actual declaration: ' + name);
  return source.slice(matches[0].start, matches[0].end);
}
const guideDeclaration = actualDeclaration(guideSource, 'guideKeysHTML'), capFirstDeclaration = actualDeclaration(uiSource, 'capFirst');
function firstTouchGuidance(hand) {
  // Execute the actual function/helper. Class-only suffix rows are outside this
  // three-row fixture; none of the handed wording is replaced or stubbed.
  const html = vm.runInNewContext(capFirstDeclaration + '\n' + guideDeclaration + '\nguideKeysHTML();', {
    IS_TOUCH: true, MOBILE_PREFS: Object.freeze({hand}), classHelpKeys: () => ''
  }, {timeout: 1000});
  const rows = html.match(/<kbd>[\s\S]*?<\/kbd><span>[\s\S]*?<\/span>/g) || [];
  assert(rows.length >= 3, 'Actual first three touch rows exist');
  return '<div class="keys" data-guidance-fixture>' + rows.slice(0, 3).join('') + '</div>';
}
const playwrightPath = process.env.HM_PLAYWRIGHT_MODULE || fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url));
const { chromium } = await import(pathToFileURL(playwrightPath));
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined }); });
test.after(async () => { await browser?.close(); });

async function geometry(page, selector, minFont) {
  return page.evaluate(({ selector, minFont }) => {
    const group = document.querySelector(selector), failures = [], fonts = [], labels = [];
    const rect = node => node.getBoundingClientRect();
    const box = r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    const inside = (r, b) => r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    const fail = (id, reason, detail = {}) => failures.push({ id, reason, ...detail });
    const bounds = rect(group);
    if (!inside(bounds, { left: 0, right: innerWidth, top: 0, bottom: innerHeight })) fail(group.id, 'group outside viewport', box(bounds));
    if (group.scrollWidth > group.clientWidth + 1) fail(group.id, 'group has horizontal overflow');
    for (const button of group.querySelectorAll(':scope > button')) {
      const r = rect(button), cs = getComputedStyle(button), id = button.id;
      const content = {
        left: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
        right: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
        top: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop),
        bottom: r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom)
      };
      labels.push(button.textContent.trim().replace(/\s+/g, ' ')); fonts.push(cs.fontFamily);
      if (r.width < 47.5 || r.height < 47.5) fail(id, 'target smaller than 48px', { width: r.width, height: r.height });
      if (!inside(r, bounds)) fail(id, 'button outside navigation group', box(r));
      if (button.scrollWidth > button.clientWidth + 1) fail(id, 'button has horizontal overflow', { client: button.clientWidth, scroll: button.scrollWidth });
      const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        const ranges = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
        if (!ranges.length) fail(id, 'label is not rendered');
        if (parseFloat(getComputedStyle(node.parentElement).fontSize) < minFont - 0.1) fail(id, 'label font was reduced', { minimum: minFont });
        for (let e = node.parentElement; e; e = e.parentElement) {
          const s = getComputedStyle(e);
          if (e.hidden || s.display === 'none' || s.visibility !== 'visible' || s.opacity === '0') fail(id, 'label is hidden');
          if (s.textOverflow === 'ellipsis' || !['none', '0', ''].includes(s.webkitLineClamp)) fail(id, 'label is ellipsized or line-clamped');
          if (e === button) break;
        }
        for (const line of ranges) {
          if (!inside(line, content)) fail(id, 'full text outside button content', { text: node.textContent.trim(), textRect: box(line), content });
          const caption = node.parentElement.closest('#mobile-nav span');
          if (caption && !inside(line, rect(caption))) fail(id, 'full text outside caption bounds', { textRect: box(line), caption: box(rect(caption)) });
          const icon = button.querySelector('svg');
          if (icon && line.top < rect(icon).bottom - 1) fail(id, 'caption overlaps icon');
        }
      }
      const icon = button.querySelector('svg');
      if (icon && (!inside(rect(icon), content) || rect(icon).width < 19.5 || rect(icon).height < 19.5)) fail(id, '20px icon does not fit');
    }
    return { failures, fonts, labels };
  }, { selector, minFont });
}

const modes = [
  ['normal', ''], ['large-text', 'mobile-large-text'],
  ['large-UI', 'mobile-large-ui'], ['both', 'mobile-large-text mobile-large-ui']
];
for (const [width, height] of [[320, 740], [390, 780], [844, 390]]) {
  for (const [name, classes] of modes) test(`complete menu/nav labels fit ${width}x${height}, ${name}, wide fallback`, async t => {
    const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
    t.after(() => page.close());
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>${style}</style><body class="touch ${classes}"><div id="hud" hidden>${nav}</div>${menu}</body>`);
    await page.evaluate(async () => {
      document.body.style.setProperty('--ui', '"Courier New", monospace');
      document.getElementById('menu').hidden = false;
      await document.fonts.ready;
    });
    const menuFit = await geometry(page, '#menu-tabs', 15);
    await page.evaluate(() => { document.getElementById('menu').hidden = true; document.getElementById('hud').hidden = false; });
    const navFit = await geometry(page, '#mobile-nav', name === 'normal' ? 12 : 13);
    assert.deepEqual(menuFit.labels, ['Character', 'Companion', 'Progress', 'Chronicle', 'Settings', 'How to play']);
    assert.deepEqual(navFit.labels, ['Items', 'Skills', 'Map', 'Notes', 'Menu']);
    assert([...menuFit.fonts, ...navFit.fonts].every(font => /monospace/i.test(font)), 'The wide local fallback must actually reach every control.');
    assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    assert.deepEqual([...menuFit.failures, ...navFit.failures], [], `${width}x${height} ${name}: full readable text, complete captions and 48px targets must fit.`);
  });
}

// DOM layout only: these cases do not boot WebGL or prove world movement, the
// live menu event route, note timing, or a physical touch device. The full game
// and interaction checks remain separate. Keep the twelve original cases above.
for (const [width, height] of [[320, 740], [390, 780], [844, 390]]) for (const hand of ['right', 'left']) {
  for (const large of [false, true]) test(`actual touch help first rows fit ${width}x${height}, ${hand} action hand, ${large ? 'large' : 'normal'} text`, async t => {
    const page = await browser.newPage({viewport: {width, height}, hasTouch: true, isMobile: true});
    t.after(() => page.close());
    const requests = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {requests.push(route.request().url()); return route.abort();});
    const classes = ['touch', hand === 'left' ? 'mobile-left-handed' : '', large ? 'mobile-large-text' : ''].join(' ');
    await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style><body class="${classes}">${menu}</body>`);
    await page.evaluate(async html => {
      document.body.style.setProperty('--ui', '"Courier New", monospace');
      document.getElementById('menu').hidden = false;
      for (const tab of document.querySelectorAll('#menu-tabs [data-tab]')) {
        const selected = tab.dataset.tab === 'help';tab.setAttribute('aria-selected', String(selected));tab.tabIndex = selected ? 0 : -1;
      }
      const body = document.getElementById('menu-body');body.setAttribute('aria-labelledby', 'menu-tab-help');body.innerHTML = html;
      await document.fonts.ready;
    }, firstTouchGuidance(hand));
    const result = await page.evaluate(() => {
      const body = document.getElementById('menu-body'), keys = body.querySelector('[data-guidance-fixture]');
      const r = body.getBoundingClientRect(), cs = getComputedStyle(body), left = r.left + parseFloat(cs.paddingLeft), right = r.right - parseFloat(cs.paddingRight);
      const failures = [], values = [], fonts = [];
      if (r.width <= 0 || r.height <= 0 || r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) failures.push('scroll container outside viewport');
      if (body.scrollWidth > body.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1) failures.push('horizontal overflow');
      for (const node of keys.children) {
        const style = getComputedStyle(node);values.push(node.textContent.trim());fonts.push(style.fontFamily);
        if (style.display === 'none' || style.visibility !== 'visible' || style.opacity === '0' || style.textOverflow === 'ellipsis' || !['none', '0', ''].includes(style.webkitLineClamp)) failures.push('hidden or truncated text');
        if (parseFloat(style.fontSize) < (node.tagName === 'KBD' ? 12 : 14) - .1) failures.push('source text font was reduced');
        const range = document.createRange();range.selectNodeContents(node);
        const lines = [...range.getClientRects()].filter(line => line.width > 0 && line.height > 0);
        if (!lines.length) failures.push('text is not rendered');
        if (lines.some(line => line.left < left - 1 || line.right > right + 1)) failures.push('text exceeds horizontal content bounds');
      }
      const last = keys.lastElementChild.getBoundingClientRect();
      return {values, fonts, failures, lastInside: last.top >= r.top - 1 && last.bottom <= r.bottom + 1, menuLabel: document.getElementById('menu-tab-help').textContent.trim(),
        scrollHeight: body.scrollHeight, clientHeight: body.clientHeight, box: {x: r.left, y: r.top, width: r.width, height: r.height}};
    });
    const walk = hand === 'left' ? 'right' : 'left', look = hand === 'left' ? 'left' : 'right', cap = value => value[0].toUpperCase() + value.slice(1);
    assert.deepEqual(result.values, [cap(walk) + ' thumb', `Drag on the lower ${walk} to walk; to the edge to run.`,
      cap(look) + ' thumb', `Drag on the ${look} to look around. Tap a creature, soldier or gate to target it.`,
      'Ability buttons', `Learned abilities stay on the ${look}. Tap Skills to read all eight, including what you unlock next.`]);
    assert.equal(result.menuLabel, 'How to play');
    assert(result.fonts.every(font => /monospace/i.test(font)), 'Wide local fallback reaches every guidance row');
    assert.deepEqual(result.failures, [], 'All three source rows remain complete and horizontally readable');
    if (result.scrollHeight > result.clientHeight + 1) {
      // Ordinary wheel input within the real scroll container, not a scrollTop
      // write or scrollIntoView that could mask an unreachable scroll region.
      const box = result.box;await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);await page.mouse.wheel(0, result.scrollHeight);
      await page.waitForFunction(() => {
        const body = document.getElementById('menu-body'), last = body.querySelector('[data-guidance-fixture] > span:last-child');
        const b = body.getBoundingClientRect(), r = last.getBoundingClientRect();return body.scrollTop > 0 && r.bottom <= b.bottom + 1 && r.top >= b.top - 1;
      }, undefined, {timeout: 5000});
    } else assert.equal(result.lastInside, true, 'A fitting body shows its final row without a forced scroll');
    assert.deepEqual(errors, []);assert.deepEqual(requests, []);
  });
}
