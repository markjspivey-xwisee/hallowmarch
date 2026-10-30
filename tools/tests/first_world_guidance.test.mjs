// Actual-source copy, navigation and note-lifecycle checks. No browser or game simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'acorn';

const root = new URL('../../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8').replace(/\r\n/g, '\n');
const sha = text => createHash('sha256').update(text).digest('hex');
const oracle = JSON.parse(read('tools/tests/fixtures/first_world_guidance_6aa.json'));
const files = Object.fromEntries(['10c_lore.js', '10e_guide.js', '10q_mobile.js', '10_ui.js', '09_player.js', 'page.html']
  .map(name => [name, read('src/' + name)]));
const tree = text => parse(text, {ecmaVersion: 'latest', sourceType: 'script'});
const trees = Object.fromEntries(Object.entries(files).filter(([name]) => name.endsWith('.js')).map(([name, text]) => [name, tree(text)]));
function walk(node, predicate, rows = []) {
  if (!node || typeof node !== 'object') return rows;
  if (predicate(node)) rows.push(node);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(child => walk(child, predicate, rows));
  else if (value && typeof value === 'object') walk(value, predicate, rows);
  return rows;
}
const text = (file, node) => files[file].slice(node.start, node.end);
function actual(file, name) {
  const found = trees[file].body.filter(node => node.type === 'FunctionDeclaration' && node.id.name === name
    || node.type === 'VariableDeclaration' && node.declarations.some(declaration => declaration.id.name === name));
  assert.equal(found.length, 1, name);
  return text(file, found[0]);
}
function original(file) {
  let result = files[file];
  if (file === '10c_lore.js') {
    const guard = "  // Holding a page key must not run through the book or dismiss its last page.\n"
      + "  if (e.repeat === true && (k === 'ArrowRight' || k === 'PageDown' || k === 'ArrowLeft' || k === 'PageUp')) {\n"
      + "    e.preventDefault();\n    e.stopPropagation();\n    return;\n  }\n";
    assert.equal(result.split(guard).length, 2, 'Unique approved prologue repeat guard inverse');
    result = result.replace(guard, '');
  }
  for (const edit of oracle.approvedEdits[file].slice().reverse()) {
    assert.equal(result.split(edit.after).length, 2, 'Unique approved inverse: ' + file);
    result = result.replace(edit.after, () => edit.before);
  }
  assert.equal(sha(result), oracle.sources[file].lfSha256, 'Complete release6aa inverse: ' + file);
  return result;
}
const originalFiles = Object.fromEntries(Object.keys(oracle.sources).map(name => [name, original(name)]));
const context = values => vm.createContext({IS_TOUCH: false, MOBILE_PREFS: Object.freeze({hand: 'right'}),
  classHelpKeys: () => '<kbd>Class controls</kbd><span>unchanged</span>', ...values});
function help(touch, hand, sources = files) {
  const source = sources['10e_guide.js'];
  const node = tree(source).body.find(row => row.type === 'FunctionDeclaration' && row.id.name === 'guideKeysHTML');
  const c = context({IS_TOUCH: touch, MOBILE_PREFS: Object.freeze({hand})});
  vm.runInContext(actual('10_ui.js', 'capFirst') + '\n' + source.slice(node.start, node.end)
    + '\nglobalThis.html = guideKeysHTML();', c, {timeout: 1000});
  return c.html;
}
function noteText(touch, hand, id = 'start') {
  const c = context({IS_TOUCH: touch, MOBILE_PREFS: Object.freeze({hand})});
  vm.runInContext(actual('10c_lore.js', 'loreLowHpRelevant') + '\n' + actual('10c_lore.js', 'FIELD_NOTES') + '\n'
    + (id === 'needs' ? needsAssignment() + ';\n' : '')
    + `globalThis.note = FIELD_NOTES[${JSON.stringify(id)}].x({});`, c, {timeout: 1000});
  return c.note;
}
function needsAssignment() {
  const found = trees['10e_guide.js'].body.filter(node => node.type === 'ExpressionStatement'
    && node.expression.type === 'CallExpression' && node.expression.callee.object?.name === 'Object'
    && node.expression.callee.property?.name === 'assign' && node.expression.arguments[0]?.name === 'FIELD_NOTES'
    && node.expression.arguments[1]?.properties.some(property => property.key.name === 'needs'));
  assert.equal(found.length, 1);
  return text('10e_guide.js', found[0]);
}
const visible = html => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
const rows = html => [...html.matchAll(/<kbd>([\s\S]*?)<\/kbd><span>([\s\S]*?)<\/span>/g)]
  .map(row => [visible(row[1]), visible(row[2])]);
function buttonLabel(id) {
  const match = new RegExp('<button\\b[^>]*\\bid="' + id + '"[^>]*>[\\s\\S]*?<\\/button>').exec(files['page.html']);
  assert(match, id); return visible(match[0]);
}

test('only approved text and touch-local selection differ from the release6aa modules', () => {
  assert.equal(oracle.revision, '6aa103a0ce5c3e71a4954c19b4fca31c5f529b59');
  for (const name of Object.keys(oracle.sources)) assert.equal(sha(originalFiles[name]), oracle.sources[name].lfSha256);
  for (const name of ['loreFinishNote', 'loreUpdateNote', 'showNextNote', 'loreSaveData', 'loreSanitize', 'updateLore']) {
    const node = tree(originalFiles['10c_lore.js']).body.find(row => row.type === 'FunctionDeclaration' && row.id.name === name);
    assert.equal(actual('10c_lore.js', name), originalFiles['10c_lore.js'].slice(node.start, node.end));
  }
});

test('desktop opener is a short control primer, with no quest/minimap or premature attack instruction', () => {
  for (const hand of ['right', 'left']) assert.equal(noteText(false, hand), 'WASD to walk. Drag to look around. Press H for all controls.');
  assert(!/creature|press 1|Your path|minimap/.test(noteText(false, 'right')));
});

test('touch opener follows both actual handed movement zones and names the real full-help path', () => {
  for (const [hand, move, look] of [['right', 'left', 'right'], ['left', 'right', 'left']]) {
    assert.equal(noteText(true, hand), `Drag on the lower ${move} to walk and on the ${look} to look around. Open Menu → Options → How to play for all controls.`);
    assert(!/WASD|Press H|creature|ability|Your path|minimap/.test(noteText(true, hand)));
    const c = context({MOBILE_PREFS: Object.freeze({hand}), view: {w: 1000, h: 800}});
    vm.runInContext(actual('10q_mobile.js', 'mobileMovementZone') + '\nglobalThis.zone = mobileMovementZone;', c);
    assert.equal(c.zone(move === 'left' ? 100 : 900, 700), true);
    assert.equal(c.zone(move === 'left' ? 100 : 900, 100), false);
    assert.equal(c.zone(500, 700), false);
  }
});

test('first three touch help rows match the selected walk/look/action side', () => {
  for (const [hand, move, look] of [['right', 'left', 'right'], ['left', 'right', 'left']]) {
    const result = rows(help(true, hand));
    assert.deepEqual(result.slice(0, 3), [
      [move[0].toUpperCase() + move.slice(1) + ' thumb', `Drag on the lower ${move} to walk; to the edge to run.`],
      [look[0].toUpperCase() + look.slice(1) + ' thumb', `Drag on the ${look} to look around. Tap a creature, soldier or gate to target it.`],
      ['Ability buttons', `Learned abilities stay on the ${look}. Tap Skills to read all eight, including what you unlock next.`],
    ]);
  }
  const priorLeftHand = rows(help(true, 'left', {...files, ...originalFiles}));
  assert.equal(priorLeftHand[0][0], 'Left thumb', 'The release fixture retains the observed stale direction');
  assert.notEqual(priorLeftHand[0][0], rows(help(true, 'left'))[0][0], 'The new contract fixes left-handed guidance');
});

test('desktop full-help output and template are byte-identical and do not read touch preferences', () => {
  assert.equal(help(false, 'right'), help(false, 'right', {...files, ...originalFiles}));
  assert.equal(help(false, 'left'), help(false, 'right'));
  const c = context({MOBILE_PREFS: new Proxy({}, {get() { throw Error('Desktop read touch preferences'); }})});
  vm.runInContext(actual('10_ui.js', 'capFirst') + '\n' + actual('10e_guide.js', 'guideKeysHTML') + '\nglobalThis.html=guideKeysHTML();', c);
  assert.equal(c.html, help(false, 'right'));
  const templates = source => walk(tree(source), node => node.type === 'TemplateLiteral').map(node => source.slice(node.start, node.end));
  const before = templates(originalFiles['10e_guide.js']).find(row => row.includes('<kbd>W A S D</kbd>'));
  const after = templates(files['10e_guide.js']).find(row => row.includes('<kbd>W A S D</kbd>'));
  assert.equal(after, before);
});

test('touch directions use actual Items/Skills/Menu section labels and keep all eight descriptions reachable', () => {
  for (const [id, label] of [['mobile-inventory', 'Items'], ['mobile-skills', 'Skills'], ['mobile-menu-toggle', 'Menu'],
    ['mobile-tab-world', 'Explore'], ['mobile-tab-character', 'Skills'], ['mobile-tab-social', 'Social'], ['mobile-tab-options', 'Options'], ['menu-tab-help', 'How to play']]) assert.equal(buttonLabel(id), label);
  const h = new Map(rows(help(true, 'right')));
  assert.equal(h.get('Potion · Items'), 'Potion stays in the dock. Tap Items for gear, crafting and goods.');
  assert(h.get('Target · Jump · Ride').includes('Menu → Explore → Ride'));
  assert(h.get('Food and water').startsWith('Open Menu → Explore'));
  assert(h.get('Menu').includes('Social: Players & chat. Options: Graphics & sound, How to play and touch controls.'));
  assert(!/\bMore\b|Kit & bags/.test(help(true, 'right')));
  const bind = trees['10q_mobile.js'].body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'mobileBind');
  const assignments = walk(bind, node => node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression'
    && node.left.property.name === 'onclick' && node.left.object.callee?.name === '$');
  const calls = [], buttons = new Map();
  const c = context({UI: {modal: null}, $: id => { if (!buttons.has(id)) buttons.set(id, {}); return buttons.get(id); },
    mobileTray: (...args) => calls.push(['tray', ...args]), openKit: tab => calls.push(['kit', tab])});
  for (const id of ['mobile-menu-toggle', 'mobile-skills', 'mobile-inventory']) {
    const assignment = assignments.find(node => node.left.object.arguments[0].value === id); assert(assignment);
    vm.runInContext(text('10q_mobile.js', assignment) + ';', c); buttons.get(id).onclick();
  }
  assert.deepEqual(calls, [['tray'], ['tray', true, true, 'character'], ['kit', 'kit']]);
  const sync = actual('10q_mobile.js', 'mobileSync');
  assert(sync.includes("CLASSES[P.cls].abilities.map((id, i) =>"));
  assert(sync.includes("'Level ' + A.level : 'Learned'"));
  const build = actual('10q_mobile.js', 'mobileBuild');
  assert(build.includes("b.onclick = () => toggleMount(); b.dataset.mobileSection = 'world'"));
  assert(sync.includes("id === 'cls' ? 'character' : ['netparty', 'war', 'bounty'].includes(id) ? 'social' : 'world'"));
});

test('actual Options help callback opens the existing help destination without a new control or action', () => {
  const bind = trees['10q_mobile.js'].body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'mobileBind');
  const handlers = walk(bind, node => node.type === 'CallExpression' && node.callee.object?.name === 'tray'
    && node.callee.property?.name === 'addEventListener' && node.arguments[0]?.value === 'click');
  const handler = handlers.find(node => text('10q_mobile.js', node).includes("b.dataset.mobileAction === 'help'")); assert(handler);
  const calls = [], c = context({tray: {}, openMenu: tab => calls.push(tab),
    mobileTray() { throw Error('Unexpected backdrop close'); }, mobileSection() { throw Error('Unexpected section action'); }});
  vm.runInContext('globalThis.click=' + text('10q_mobile.js', handler.arguments[1]) + ';', c);
  c.click({target: {closest: selector => selector === '[data-mobile-action]' ? {dataset: {mobileAction: 'help'}} : null}});
  assert.deepEqual(calls, ['help']);
});

test('needs note only changes its touch navigation prefix; unrelated notes and desktop needs remain literal', () => {
  assert(noteText(true, 'right', 'needs').startsWith('Open Menu → Explore to find the food and water bars. Tap them'));
  const old = originalFiles['10e_guide.js'], current = files['10e_guide.js'];
  const object = source => walk(tree(source), node => node.type === 'Property' && node.key.name === 'needs'
    && node.value.type === 'ObjectExpression').map(node => source.slice(node.start, node.end));
  assert.equal(object(old).length, 1);assert.equal(object(current).length, 1);
  assert.equal(object(current)[0].replace('Open Menu → Explore to find the food and water bars. Tap them', 'Open More to find the food and water bars. Tap them'), object(old)[0]);
  assert.equal(actual('10c_lore.js', 'FIELD_NOTES').replace(noteText(false, 'right'), 'short control primer').includes('frontier:'), true);
  assert(files['page.html'].includes("content: 'More'"), 'Chronicle More expansion remains a legitimate separate caption');
});

test('actual hunger/thirst warning branch keeps its conditions and priority with the real Menu caption', () => {
  const fn = trees['10q_mobile.js'].body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'mobileHUD');
  const block = walk(fn, node => node.type === 'IfStatement' && node.test.name === 'alert');assert.equal(block.length, 1);
  for (const [thirst, hunger, expected] of [[.39, .8, 'Thirsty · Menu → Explore'], [.8, .39, 'Hungry · Menu → Explore'], [.39, .39, 'Thirsty · Menu → Explore'], [.4, .4, '']]) {
    const alert = {}, c = context({SURV: {thirst, hunger}, alert});
    vm.runInContext(actual('10_ui.js', 'setT') + '\n' + text('10q_mobile.js', block[0]), c);
    assert.equal(alert.textContent, expected);assert.equal(alert.hidden, !expected);
  }
});

function lifecycle({touch = false, hand = 'right'} = {}) {
  class Element {
    constructor() { this.children = []; this.parent = null; this.listeners = {}; this.attrs = {}; this.classes = new Set(); }
    get isConnected() { return !!(this.root || this.parent); }
    get childNodes() { return this.children; } get firstChild() { return this.children[0]; }
    get classList() { return {contains: name => this.classes.has(name)}; }
    setAttribute(name, value) { this.attrs[name] = value; } addEventListener(name, fn) { this.listeners[name] = fn; }
    appendChild(child) { this.children.push(child); child.parent = this; } removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; }
    remove() { this.parent?.removeChild(this); }
  }
  const host = new Element();host.root = true;const log = new Element();log.root = true;
  const prog = {lore: {seen: []}}, GAME = {t: 1, prog, player: {alive: true, faction: 0, combatUntil: 0}};
  const LORE = {queue: ['start'], noteReplay: new Set(), noteActive: null, noteOwner: prog, noteUntil: 0};
  let saves = 0;const timers = new Map(), c = context({IS_TOUCH: touch, MOBILE_PREFS: Object.freeze({hand}), GAME, LORE,
    GUIDE: {stats: {notesShown: 0}}, UI: {modal: null}, HUDL: {k: 1}, REALMS: [{}], guideNoteIndex: () => 0,
    performance: {now: () => 100}, document: {createElement: () => new Element()}, $: id => id === 'log' ? log : host,
    setTimeout: (fn, ms) => { const id = timers.size + 1;timers.set(id, {fn, ms});return id; }, clearTimeout: id => timers.delete(id),
    saveSoon: () => saves++, G2: {}, openChronicle() { throw Error('A full note must only dismiss'); }});
  const code = ['FIELD_NOTES', 'loreLowHpRelevant', 'loreFinishNote', 'loreUpdateNote', 'showNextNote'].map(name => actual('10c_lore.js', name)).join('\n');
  vm.runInContext(actual('10_ui.js', 'uiLog') + '\n' + code + '\nglobalThis.show=showNextNote;', c);
  return {c, GAME, LORE, host, log, timers, saves: () => saves};
}

test('desktop card and log share actual short copy while seen/save/timer/dismiss behavior stays unchanged', () => {
  const f = lifecycle();f.c.show();
  assert.deepEqual(f.GAME.prog.lore.seen, ['start']);assert.equal(f.saves(), 1);assert.equal(f.LORE.noteUntil, 11600);
  assert.equal(f.host.children.length, 1);assert.equal(f.host.children[0].attrs.role, 'status');
  assert(f.host.children[0].innerHTML.includes('WASD to walk. Drag to look around. Press H for all controls.'));
  assert.equal(f.log.children[0].textContent, 'First steps: WASD to walk. Drag to look around. Press H for all controls.');
  assert.equal([...f.timers.values()][0].ms, 11000);
  f.host.children[0].listeners.click();assert.equal(f.host.children.length, 0);assert.equal(f.LORE.noteUntil, 11600);
  assert.deepEqual(f.GAME.prog.lore.seen, ['start']);assert.equal(f.saves(), 1);assert.equal(f.c.UI.modal, null);
});

test('ordinary touch still collects silently and explicit note rendering uses handed copy only', () => {
  for (const hand of ['left', 'right']) {
    const quiet = lifecycle({touch: true, hand});quiet.c.show();
    assert.deepEqual(quiet.GAME.prog.lore.seen, ['start']);assert.equal(quiet.saves(), 1);
    assert.equal(quiet.host.children.length, 0);assert.equal(quiet.log.children.length, 0);assert.equal(quiet.timers.size, 0);
    const explicit = lifecycle({touch: true, hand});explicit.c.show(true);
    assert(explicit.host.children[0].innerHTML.includes(noteText(true, hand)));
    assert.equal(explicit.log.children[0].textContent, 'First steps: ' + noteText(true, hand));
  }
});
