import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = file => readFileSync(new URL('../../src/' + file, import.meta.url), 'utf8');
function fixture() {
  const ids = ['realm-pick', 'class-pick', 'realm-blurb', 'class-blurb', 'btn-dice', 'name-input', 'btn-begin', 'btn-continue',
    'character-create-fields', 'continue', 'continue-desc', 'season-title', 'save-note', 'title'];
  const nodes = Object.fromEntries(ids.map(id => [id, { value: '', hidden: false, innerHTML: '', textContent: '',
    addEventListener() {}, querySelectorAll: () => [], click() { this.onclick?.(); } }]));
  const saves = [];
  const c = vm.createContext({ document: { getElementById: id => nodes[id] || null }, GAME: { started: false, ready: true },
    CLASSES: Object.fromEntries(['warrior', 'archer', 'mage', 'priest'].map(name => [name, { name, blurb: name, icon: name }])),
    REALMS: ['Logres', 'Eriu', 'Thule'].map((name, id) => ({ name, id, color: '#fff' })),
    emblemSvg: () => '', iconSvg: () => '', audioUnlock() {}, randomName: () => 'Aldric', sfx() {},
    nativePlayerBegin: save => saves.push(save), nativePlayerRender() {}, nativePlayerSaveMessage: () => 'Saved',
    realmRank: () => 1, seasonTitleText: () => '' });
  const ui = read('10_ui.js');
  const radio = ui.slice(ui.indexOf('function menuRadioKey('), ui.indexOf('function menuReplacementBlocked('));
  vm.runInContext(radio + ui.split('/* HUD construction')[0], c);
  return { c, nodes, saves, run: code => vm.runInContext(code, c) };
}

test('all realms and callings begin fresh characters at level1 without a veteran bypass', () => {
  const f = fixture(); f.run('setupTitle(null)');
  for (const realm of [0, 1, 2]) for (const cls of ['warrior', 'archer', 'mage', 'priest']) {
    f.c.realm = realm; f.c.cls = cls;
    f.run('UI.realm=realm;UI.cls=cls;UI.start="veteran";syncTitle()');
    f.nodes['name-input'].value = '  New Recruit  ';
    f.nodes['btn-begin'].click();
    const save = f.saves.at(-1);
    assert.equal(save.level, 1); assert.equal(save.xp, 0); assert.equal(save.rp, 0); assert.equal(save.fresh, true);
    assert.equal(save.realm, realm); assert.equal(save.cls, cls); assert.equal(save.name, 'New Recruit');
  }
  assert.equal(f.saves.length, 12);
});

test('return and play-now both preserve an existing career level, experience and inventory', () => {
  for (const action of ['btn-begin', 'btn-continue']) {
    const f = fixture(), career = { v: 1, name: 'Veteran', realm: 2, cls: 'priest', level: 37, xp: 1234, rp: 9000,
      gold: 900, eq: { weapon: { id: 'earned-mace' } }, bag: [{ id: 'earned-loot' }], fresh: true };
    f.c.saved = { char: career }; f.run('setupTitle(saved)');
    f.nodes['name-input'].value = 'Replacement'; f.nodes[action].click();
    assert.deepEqual({ ...f.saves[0] }, { ...career, fresh: false });
    assert.equal(career.level, 37); assert.equal(career.xp, 1234);
    assert.equal(f.nodes['character-create-fields'].hidden, true);
  }
});

test('creation shell describes the common starting point and offers no starting-level selector', () => {
  const html = read('page.html');
  assert.match(html, /Every new character starts at level 1 in their home realm/);
  assert.doesNotMatch(html, /id="opt-(?:veteran|recruit)"|aria-label="Starting level"/);
});
