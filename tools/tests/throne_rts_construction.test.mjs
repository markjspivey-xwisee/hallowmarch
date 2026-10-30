import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../src/10q_throne_rts.js', import.meta.url), 'utf8');
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\nfunction ', start));
}
function fixture() {
  const ledger = { revision: 1, plots: [
    { id: 'enemy', owner: 0 }, { id: 'first', owner: 1 }, { id: 'second', owner: 1 },
  ], catalog: [{ id: 'mill', label: 'Mill', cost: { planks: 10 }, seconds: 45, workers: 2 }], buildings: [] };
  const state = { root: {}, tab: 'build', key: '', form: { plotId: 'first', buildKind: 'mill' }, selectedPlot: 'first', quoteForm: {} };
  const nodes = {
    'rts-content': { innerHTML: '', contains: () => false }, 'rts-title': {},
    'rts-tabs': { querySelectorAll: () => [] },
  };
  const commands = [], notices = [], blocked = new Map(), focused = [];
  const scope = vm.createContext({
    THRONE_RTS: { active: true }, THRONE_RTS_UI: state, UI: { modal: 'rts' },
    GAME: { player: { faction: 1 } }, REALMS: [{}, { name: 'Realm', town: { x: -378, z: 0 } }], HALL: { sit: { H: { S: { name: 'Keep' } } } },
    WAR: { keeps: [] }, throneRtsFocus: (x, z) => focused.push([x, z]),
    CWUI: {}, document: { activeElement: null }, $: id => nodes[id],
    hallThroneGrant: () => true, throneRtsView: () => ledger,
    REALM_RTS_SITE_CACHE: new Map(),
    realmRtsSiteStatus: plot => ({ eligible: !blocked.has(plot.id), reason: blocked.get(plot.id) || '' }),
    throneRtsNotice: value => notices.push(value),
    netRealmManagementCommand: action => {
      commands.push({ ...action });
      const plot = ledger.plots.find(p => p.id === action.plotId);
      assert.equal(plot?.owner, 1, 'commission must target a currently owned plot');
      assert.ok(!plot.buildingId, 'commission must target an empty plot');
      plot.buildingId = 'b:' + plot.id; ledger.revision++;
    },
  });
  vm.runInContext(['throneRtsEscape', 'throneRtsNumber', 'throneRtsForm', 'throneRtsCost', 'throneRtsOptions',
    'throneRtsBuildReason', 'throneRtsConstructionDetail', 'throneRtsUpdateOptions', 'throneRtsRefreshConstruction', 'throneRtsSelectPlot',
    'throneRtsConstructionChoice', 'throneRtsConstruction', 'throneRtsRenderPanel', 'throneRtsManage', 'throneRtsClick', 'throneRtsMarkerAction', 'throneRtsFormInput', 'throneRtsFocusBuilding']
    .map(extract).join('\n'), scope);
  const render = () => { scope.throneRtsRenderPanel(true); return nodes['rts-content'].innerHTML; };
  const displayedPlot = () => /<select name="plotId">([\s\S]*?)<\/select>/.exec(nodes['rts-content'].innerHTML)?.[1]
    .match(/<option value="([^"]*)" selected>/)?.[1] || '';
  const click = () => {
    const button = { dataset: { action: 'build' }, disabled: false, classList: { contains: () => false } };
    scope.throneRtsClick({ target: { closest: () => button } });
  };
  return { ledger, state, commands, notices, blocked, focused, render, displayedPlot, click,
    focusBuilding: id => scope.throneRtsFocusBuilding(id),
    marker: id => scope.throneRtsMarkerAction('plot', id), input: id => scope.throneRtsFormInput({ target: { name: 'plotId', value: id } }) };
}

test('two sequential commissions use the plot displayed after the previous plot becomes occupied', () => {
  const f = fixture(); f.render();
  assert.equal(f.displayedPlot(), 'first');
  f.click(); assert.equal(f.commands[0].plotId, 'first');
  f.render();
  assert.equal(f.displayedPlot(), 'second');
  f.click(); assert.equal(f.commands[1].plotId, 'second');
  assert.equal(f.notices.length, 0, 'the fresh displayed quote must not need another click');
  assert.match(f.render(), /data-action="build" disabled/);
  assert.equal(f.state.form.plotId, '', 'exhausted plots cannot retain an occupied selection');
});

test('a captured selected plot is replaced with the same empty owned plot shown in the selector', () => {
  const f = fixture(); f.render();
  f.ledger.plots.find(p => p.id === 'first').owner = 0; f.ledger.revision++;
  f.render(); const displayed = f.displayedPlot();
  assert.equal(displayed, 'second');
  f.click(); assert.equal(f.commands[0].plotId, displayed);
  assert.equal(f.notices.length, 0);
});

test('terrain or obstacles becoming unsuitable after a displayed quote cannot retarget or charge a commission', () => {
  const f = fixture(); f.render();
  f.blocked.set('first', 'An obstacle occupies this site.');
  f.click();
  assert.equal(f.commands.length, 0, 'a stale click cannot silently commission the next site');
  assert.match(f.notices.at(-1), /obstacle/);
  assert.equal(f.displayedPlot(), 'second');
  f.click(); assert.equal(f.commands.length, 1); assert.equal(f.commands[0].plotId, 'second');
});

test('occupied, enemy and obstructed markers do not change the selected plot', () => {
  const f = fixture(); f.render();
  f.marker('enemy'); assert.equal(f.state.selectedPlot, 'first');
  f.ledger.plots.find(p => p.id === 'second').buildingId = 'b:second';
  f.marker('second'); assert.equal(f.state.selectedPlot, 'first');
  delete f.ledger.plots.find(p => p.id === 'second').buildingId;
  f.blocked.set('second', 'This site needs dry ground.'); f.marker('second');
  assert.equal(f.state.selectedPlot, 'first'); assert.match(f.notices.at(-1), /dry ground/);
  assert.equal(f.commands.length, 0);
});

test('a fully obstructed settlement explains availability and disables commissioning', () => {
  const f = fixture(); f.blocked.set('first', '<steep>'); f.blocked.set('second', 'A road crosses the site.');
  const html = f.render();
  assert.match(html, /No clear building plots/); assert.match(html, /Unavailable sites · 2/);
  assert.match(html, /&lt;steep&gt;/); assert.doesNotMatch(html, /<steep>/);
  assert.match(html, /data-action="build" disabled/); assert.equal(f.state.selectedPlot, '');
  f.click(); assert.equal(f.commands.length, 0);
});

test('a focused plot selector updates the shared selection immediately, without relying on a panel redraw', () => {
  const f = fixture(); f.render(); f.input('second');
  assert.equal(f.state.form.plotId, 'second'); assert.equal(f.state.selectedPlot, 'second');
  f.input('enemy'); assert.equal(f.state.selectedPlot, '');
  f.blocked.set('second', 'A tree crown occupies this site.'); f.input('second');
  assert.equal(f.state.selectedPlot, ''); assert.equal(f.commands.length, 0);
});

test('existing town works focus their authored settlement while earned construction focuses its pinned site', () => {
  const f = fixture(), plot = f.ledger.plots.find(p => p.id === 'first');
  Object.assign(plot, { home: 1, site: 'town:1', x: -480, z: 63 });
  f.ledger.buildings.push({ id: 'b:first', plotId: 'first', adopted: true, x: -480, z: 63 });
  f.focusBuilding('b:first'); assert.deepEqual(f.focused.at(-1), [-378, 0]);
  Object.assign(f.ledger.buildings[0], { adopted: false, x: -301, z: 44 });
  f.focusBuilding('b:first'); assert.deepEqual(f.focused.at(-1), [-301, 44]);
  assert.equal(f.commands.length, 0, 'focusing never migrates or commissions a building');
});
