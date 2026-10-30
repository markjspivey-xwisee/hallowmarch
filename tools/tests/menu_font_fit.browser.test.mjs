/** Real shell geometry with a wide local font; no game, identity or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shell = await readFile(new URL('../../src/page.html', import.meta.url), 'utf8');
const style = [...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const menu = shell.slice(shell.indexOf('<div class="overlay" id="menu"'), shell.indexOf('<div class="overlay" id="kit"'));
const nav = shell.match(/<nav id="mobile-nav"[\s\S]*?<\/nav>/)?.[0];
assert(style && menu && nav, 'Use the actual shell styles and complete menu/navigation markup.');
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
