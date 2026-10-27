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
  const commands = [], notices = [];
  const scope = vm.createContext({
    THRONE_RTS: { active: true }, THRONE_RTS_UI: state, UI: { modal: 'rts' },
    GAME: { player: { faction: 1 } }, REALMS: [{}, { name: 'Realm' }], HALL: { sit: { H: { S: { name: 'Keep' } } } },
    CWUI: {}, document: { activeElement: null }, $: id => nodes[id],
    hallThroneGrant: () => true, throneRtsView: () => ledger,
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
    'throneRtsConstructionChoice', 'throneRtsConstruction', 'throneRtsRenderPanel', 'throneRtsManage', 'throneRtsClick']
    .map(extract).join('\n'), scope);
  const render = () => { scope.throneRtsRenderPanel(true); return nodes['rts-content'].innerHTML; };
  const displayedPlot = () => /<select name="plotId">([\s\S]*?)<\/select>/.exec(nodes['rts-content'].innerHTML)?.[1]
    .match(/<option value="([^"]*)" selected>/)?.[1] || '';
  const click = () => {
    const button = { dataset: { action: 'build' }, disabled: false, classList: { contains: () => false } };
    scope.throneRtsClick({ target: { closest: () => button } });
  };
  return { ledger, state, commands, notices, render, displayedPlot, click };
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
