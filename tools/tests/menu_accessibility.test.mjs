/** Real menu handlers, exercised with focusable DOM nodes and their delegated events. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../../src/10_ui.js', import.meta.url), 'utf8');
const menuSource = source.slice(source.indexOf('let menuReturnFocus = null;'), source.indexOf('function uiDeath('));
const shell = await fs.readFile(new URL('../../src/page.html', import.meta.url), 'utf8');
const tabNames = ['char', 'companion', 'progress', 'chronicle', 'settings', 'help'];

function fixture() {
  const elements = new Map(), document = { activeElement: null };
  class Node {
    constructor(id, tag = 'button') {
      this.id = id; this.tag = tag; this.dataset = {}; this.attributes = {}; this.listeners = new Map();
      this.parentElement = null; this.children = []; this.disabled = false; this.hidden = false; this.inert = false;
      this.tabIndex = 0; this.isConnected = true; this.style = {}; this.innerHTML = ''; this.textContent = '';
      elements.set(id, this);
    }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    addEventListener(type, run) { this.listeners.set(type, [...(this.listeners.get(type) || []), run]); }
    contains(node) { for (; node; node = node.parentElement) if (node === this) return true; return false; }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector === 'button' && node.tag === 'button') return node;
        if (selector === '[role="tab"]' && node.getAttribute('role') === 'tab') return node;
        if (selector === '[hidden], [inert]' && (node.hidden || node.inert)) return node;
      }
      return null;
    }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    querySelectorAll(selector) {
      const all = this.descendants();
      if (selector === '[role="tab"]') return all.filter(el => el.getAttribute('role') === 'tab');
      if (selector === 'button') return all.filter(el => el.tag === 'button');
      return all.filter(el => ['button', 'input', 'select', 'textarea', 'summary', 'a'].includes(el.tag));
    }
    querySelector(selector) {
      if (selector === '[aria-selected="true"]') return this.descendants().find(el => el.getAttribute('aria-selected') === 'true');
      return this.querySelectorAll(selector)[0];
    }
    getClientRects() { return !this.closest('[hidden], [inert]') && this.isConnected ? [{}] : []; }
    focus() { document.activeElement = this; }
  }
  const menu = new Node('menu', 'div'); menu.hidden = true;
  const close = new Node('menu-close'), tabs = new Node('menu-tabs', 'div'), body = new Node('menu-body', 'div');
  const buttons = tabNames.map(name => { const b = new Node('menu-tab-' + name); b.dataset.tab = name; b.setAttribute('role', 'tab'); return b; });
  tabs.append(...buttons);
  const input = new Node('menu-input', 'input'), hidden = new Node('hidden-menu-control'), disabled = new Node('disabled-menu-control');
  hidden.hidden = true; disabled.disabled = true; body.append(input, hidden, disabled);
  menu.append(close, tabs, body);
  const trigger = new Node('btn-menu'), mobileTrigger = new Node('mobile-menu-toggle');
  const external = new Node('external-trigger'); document.body = new Node('body', 'body'); document.activeElement = external;
  for (const id of ['set-q', 'set-t', 'set-w', 'set-m']) new Node(id, 'div');
  document.querySelectorAll = selector => selector === '#menu-tabs button' ? buttons : [];
  const context = vm.createContext({ document, $: id => elements.get(id), queueMicrotask: () => {},
    UI: { modal: null, menuTab: null }, GAME: { player: { name: 'Hero', cls: 'warrior', faction: 0 },
      prog: { rp: 0, played: 0, level: 1, kills: 0, realmKills: 0, deaths: 0 } },
    CLASSES: { warrior: { name: 'Warrior' } }, REALMS: [{ name: 'Logres' }], RANK_TITLES: ['Recruit'], REALM_RANKS: [0, 100],
    quality: { level: 'low' }, tod: { mode: 'cycle' }, WEATHER: { mode: 'auto' }, IS_TOUCH: false,
    QUALITY_PRESETS: { low: { label: 'Low' }, medium: { label: 'Medium' }, high: { label: 'High' } }, MUSIC_LEVELS: [['off', 'Off']],
    realmRank: () => 1, late2Named: () => 'Hero', fmtInt: String, esc: String, late2CharStats: () => '', gsCharHTML: () => '', gsCharWire() {},
    soundSettingsHTML: () => '', captureSettingsHTML: () => '', musicLevelKey: () => 'off', captureSettingsWire() {}, soundSettingsWire() {},
    guideHelpHTML: () => 'How to play', renderChronicle(el) { el.innerHTML = 'Chronicle'; }, bgClose() {}, newCharacter() {},
  });
  vm.runInContext(menuSource + '\nglobalThis.handlers = { openMenu, closeMenu, renderMenu };', context);
  function dispatch(node, type, options = {}) {
    const event = { target: node, prevented: false, stopped: false, ...options,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (let current = node; current; current = current.parentElement) {
      for (const run of current.listeners.get(type) || []) run(event);
      if (event.stopped) break;
    }
    return event;
  }
  const selected = () => buttons.filter(button => button.getAttribute('aria-selected') === 'true');
  return { ...context.handlers, UI: context.UI, document, menu, buttons, body, close, input, hidden, disabled, trigger, mobileTrigger, external, dispatch, selected };
}

test('menu markup exposes one labelled modal dialog, a tablist and a controlled panel', () => {
  const markup = shell.slice(shell.indexOf('<div class="overlay" id="menu"'), shell.indexOf('<div class="overlay" id="kit"'));
  assert.match(markup, /role="dialog" aria-modal="true" aria-labelledby="menu-title"/);
  assert.match(markup, /role="tablist" id="menu-tabs" aria-label="Game menu"/);
  for (const name of tabNames) assert.match(markup, new RegExp('role="tab" id="menu-tab-' + name + '" data-tab="' + name + '" aria-controls="menu-body" aria-selected="'));
  assert.match(markup, /id="menu-body" role="tabpanel" aria-labelledby="menu-tab-char"/);
  assert.doesNotMatch(markup, /aria-checked/);
});

test('open and real tab clicks keep selection, panel label and roving focus state together', () => {
  const f = fixture(); f.openMenu('char');
  assert.equal(f.menu.hidden, false); assert.equal(f.document.activeElement, f.buttons[0]);
  assert.equal(f.selected().length, 1); assert.equal(f.body.getAttribute('aria-labelledby'), 'menu-tab-char');
  f.dispatch(f.buttons[2], 'click');
  assert.equal(f.UI.menuTab, 'progress'); assert.deepEqual(f.selected(), [f.buttons[2]]);
  assert.equal(f.body.getAttribute('aria-labelledby'), 'menu-tab-progress');
  assert.deepEqual(f.buttons.map(button => button.tabIndex), [-1, -1, 0, -1, -1, -1]);
});

test('Arrow keys wrap through the actual tabs and Home/End select and focus their endpoints', () => {
  const f = fixture(); f.openMenu('char');
  for (const [key, index] of [['ArrowLeft', 5], ['ArrowRight', 0], ['End', 5], ['Home', 0], ['ArrowRight', 1], ['ArrowRight', 2]]) {
    const event = f.dispatch(f.document.activeElement, 'keydown', { key });
    assert.equal(event.prevented, true); assert.equal(event.stopped, true);
    assert.equal(f.UI.menuTab, tabNames[index]); assert.equal(f.document.activeElement, f.buttons[index]);
    assert.deepEqual(f.selected(), [f.buttons[index]]);
    assert.equal(f.body.getAttribute('aria-labelledby'), f.buttons[index].id);
  }
  const modified = f.dispatch(f.buttons[2], 'keydown', { key: 'ArrowLeft', altKey: true });
  assert.equal(modified.prevented, false); assert.equal(f.UI.menuTab, 'progress');
  const input = f.dispatch(f.input, 'keydown', { key: 'Home' }); assert.equal(input.prevented, false);
});

test('Tab stays inside the open menu while hidden, disabled and inactive tabs are skipped', () => {
  const f = fixture(); f.openMenu('progress');
  f.input.focus(); const forward = f.dispatch(f.input, 'keydown', { key: 'Tab' });
  assert.equal(forward.prevented, true); assert.equal(f.document.activeElement, f.close);
  const backward = f.dispatch(f.close, 'keydown', { key: 'Tab', shiftKey: true });
  assert.equal(backward.prevented, true); assert.equal(f.document.activeElement, f.input);
  f.buttons[2].focus(); const interior = f.dispatch(f.buttons[2], 'keydown', { key: 'Tab' }); assert.equal(interior.prevented, false);
  f.external.focus(); const escaped = f.dispatch(f.menu, 'keydown', { key: 'Tab' });
  assert.equal(escaped.prevented, true); assert.equal(f.document.activeElement, f.close);
});

test('closing returns focus to its opener, with a visible menu trigger if that opener disappeared', () => {
  const f = fixture(); f.openMenu('progress'); f.renderMenu('help'); f.closeMenu();
  assert.equal(f.menu.hidden, true); assert.equal(f.document.activeElement, f.external);
  f.openMenu('help'); f.external.isConnected = false; f.closeMenu(); assert.equal(f.document.activeElement, f.trigger);
  f.mobileTrigger.focus(); f.openMenu('progress'); f.mobileTrigger.hidden = true; f.trigger.hidden = true; f.closeMenu();
  assert.equal(f.menu.hidden, true, 'unavailable controls are never used to reopen or refocus the hidden menu');
});
