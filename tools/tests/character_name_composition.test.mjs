// Actual title input/click handlers with synthetic CPU event flags; no browser, OS IME or account operation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = readFileSync(new URL('../../src/10_ui.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const nodes = parse(source, { ecmaVersion: 'latest' }).body;
function actual(name) {
  const matches = nodes.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name);
  assert.equal(matches.length, 1, 'One actual function: ' + name);
  return source.slice(matches[0].start, matches[0].end);
}
const clone = value => JSON.parse(JSON.stringify(value));

function fixture({ career = null } = {}) {
  const effects = { clicks: [], audio: 0, random: 0, intents: [], requests: [], focus: 0 };
  class Element {
    constructor(id) { this.id = id; this.value = ''; this.disabled = false; this.listeners = {}; this.innerHTML = ''; }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    click() { effects.clicks.push(this.id); if (!this.disabled) this.onclick?.(); }
    focus() { effects.focus++; document.activeElement = this; }
  }
  const elements = Object.fromEntries(['realm-pick', 'class-pick', 'btn-dice', 'name-input', 'btn-begin', 'btn-continue']
    .map(id => [id, new Element(id)]));
  const field = elements['name-input']; field.value = 'Composing name';
  const document = { activeElement: field, getElementById: id => elements[id] };
  const UI = { realm: 0, cls: 'warrior', titleSave: career ? { char: career } : null, nameTouched: true };
  const GAME = { ready: true, started: false, player: null }, SAVE = { sentinel: 'unchanged save state' };
  const GRAPHICS_STARTUP = { stopped: false };
  const context = vm.createContext({ document, UI, GAME, SAVE, GRAPHICS_STARTUP, GRAPHICS_CONTEXT_LOST: false,
    $: id => elements[id], REALMS: [{ id: 0, name: 'Fixture realm', color: '#fff' }],
    CLASSES: { warrior: { name: 'Warrior', role: 'Fixture role', icon: 'fixture' } },
    emblemSvg: () => '', iconSvg: () => '',
    randomName: () => { effects.random++; return 'Generated fixture'; },
    audioUnlock: () => { effects.audio++; },
    loreRequestBegin: request => { effects.intents.push(request); },
    nativePlayerBegin: request => { effects.requests.push(request); } });
  vm.runInContext(['titleEntryBlocked', 'menuRadioKey', 'bindTitle'].map(actual).join('\n'), context, { timeout: 1000 });
  context.bindTitle();
  const snapshot = () => JSON.stringify({ UI, GAME, SAVE, value: field.value, focus: document.activeElement.id, effects });
  return { effects, elements, field, document, UI, GAME, SAVE, GRAPHICS_STARTUP, context, snapshot,
    key(properties) {
      const cancellation = { prevented: 0, stopped: 0 };
      field.listeners.keydown({ ...properties,
        preventDefault() { cancellation.prevented++; }, stopPropagation() { cancellation.stopped++; } });
      return cancellation;
    } };
}

test('the complete actual bindTitle body has only the exact composition guard added to 9414', () => {
  const body = actual('bindTitle');
  const guarded = "  $('name-input').addEventListener('keydown', (e) => {\n"
    + "    if (e.isComposing || e.keyCode === 229) return;\n"
    + "    if (e.key === 'Enter') $('btn-begin').click();\n  });";
  const original = "  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-begin').click(); });";
  assert.equal(body.split(guarded).length, 2, 'One exact approved listener, including its formatting');
  const before = body.replace(guarded, original);
  assert.equal(createHash('sha256').update(before).digest('hex'), '1a81faa8b7ca7a6ab478de1da10151fe1acb374a402c69373324ef6e563f2ddc');
  assert.notEqual(body, before);
});

test('composition Enter after Ready and eligibility cannot click Play or cause any additional effect', () => {
  for (const flags of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }, { isComposing: true, keyCode: 229 }]) {
    const f = fixture(); assert.equal(f.GAME.ready, true); assert.equal(f.context.titleEntryBlocked(), false);
    const before = f.snapshot();
    assert.deepEqual(f.key({ key: 'Enter', ...flags }), { prevented: 0, stopped: 0 });
    assert.equal(f.snapshot(), before, 'Composition keeps name/focus/UI/save/request/audio/RNG state intact');
    assert.equal(f.document.activeElement, f.field); assert.deepEqual(f.effects.clicks, []);
    assert.deepEqual(f.effects.requests, []); assert.deepEqual(f.effects.intents, []);
  }
});

test('after composition, ordinary and legacy Enter still use the original Play click exactly once', () => {
  for (const ordinary of [{ key: 'Enter', isComposing: false, keyCode: 13 }, { key: 'Enter' }]) {
    const f = fixture();
    f.key({ key: 'Enter', isComposing: true, keyCode: 229 });
    f.field.value = '  Aki   Nomura  ';
    assert.deepEqual(f.key(ordinary), { prevented: 0, stopped: 0 });
    assert.deepEqual(f.effects.clicks, ['btn-begin']); assert.equal(f.effects.audio, 1); assert.equal(f.effects.random, 0);
    assert.equal(f.effects.intents.length, 1); assert.equal(f.effects.requests.length, 1);
    assert.equal(f.effects.intents[0], f.effects.requests[0], 'The original exact request reaches the native entry function');
    assert.deepEqual(clone(f.effects.requests[0]), { v: 1, name: 'Aki Nomura', realm: 0, cls: 'warrior', level: 1, xp: 0, rp: 0, fresh: true });
    assert.equal(f.field.value, '  Aki   Nomura  '); assert.equal(f.document.activeElement, f.field); assert.equal(f.effects.focus, 0);
    assert.equal(f.SAVE.sentinel, 'unchanged save state'); assert.equal(f.GAME.started, false, 'This fixture records entry requests, not a real game start');
  }
});

test('non-Enter keys and composition defaults stay untouched, and ordinary button clicks still work', () => {
  const f = fixture(), before = f.snapshot();
  for (const key of ['a', 'Escape', 'Tab', 'Process']) {
    assert.deepEqual(f.key({ key }), { prevented: 0, stopped: 0 });
    assert.deepEqual(f.key({ key, isComposing: true, keyCode: 229 }), { prevented: 0, stopped: 0 });
  }
  assert.equal(f.snapshot(), before);
  f.elements['btn-begin'].click();
  assert.deepEqual(f.effects.clicks, ['btn-begin']); assert.equal(f.effects.requests.length, 1); assert.equal(f.effects.audio, 1);
  assert.equal(f.document.activeElement, f.field); assert.equal(f.effects.focus, 0);
});

test('ordinary Enter still reaches the original graphics and started-state fences', () => {
  for (const block of ['not-ready', 'started', 'context-lost', 'graphics-stopped']) {
    const f = fixture();
    if (block === 'not-ready') f.GAME.ready = false;
    if (block === 'started') f.GAME.started = true;
    if (block === 'context-lost') f.context.GRAPHICS_CONTEXT_LOST = true;
    if (block === 'graphics-stopped') f.GRAPHICS_STARTUP.stopped = true;
    assert.deepEqual(f.key({ key: 'Enter', isComposing: false, keyCode: 13 }), { prevented: 0, stopped: 0 });
    assert.deepEqual(f.effects.clicks, ['btn-begin']);
    assert.deepEqual(f.effects.requests, []); assert.deepEqual(f.effects.intents, []);
    assert.equal(f.effects.audio, 0); assert.equal(f.effects.random, 0); assert.equal(f.effects.focus, 0);
  }
});

test('the unchanged returning-character branch ignores hidden creation text and retains the career', () => {
  const career = { name: 'Kept hero', realm: 2, cls: 'priest', level: 37, xp: 1234, gold: 900, fresh: true };
  const before = clone(career), f = fixture({ career });
  f.key({ key: 'Enter', isComposing: false, keyCode: 13 });
  assert.deepEqual(clone(f.effects.requests), [{ ...career, fresh: false }]); assert.deepEqual(career, before);
  assert.deepEqual(f.effects.clicks, ['btn-begin']); assert.deepEqual(f.effects.intents, []);
  assert.equal(f.effects.audio, 1); assert.equal(f.effects.random, 0); assert.equal(f.effects.focus, 0);
});
